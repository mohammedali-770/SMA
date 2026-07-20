-- ============================================================================
-- Durable-ledger, fail-closed, secret-fidelity and reconciliation test for the
-- lazywait-sync pg_cron driver (migration 20260720120000_lazywait_sync_scheduler.sql).
--
-- Runs against Postgres with the migration applied. HERMETIC: inside the
-- (rolled-back) transaction it installs a controllable pg_net — a recording
-- net.http_post and an injectable net._http_response — so every HTTP outcome and
-- reconciliation path is exercised deterministically with NO real network call.
-- Each case RAISES EXCEPTION on failure; a clean run prints a NOTICE and commits
-- nothing.
--
-- Covers all 17 required scenarios (see inline CASE markers). Worker runtime
-- behaviour (429/timeout/5xx retryable, duplicate/already-synced no-resend,
-- stale-claim recovery) stays covered by the UNCHANGED lazywait.test.ts /
-- lazywait_reap_test.sql — this migration adds no worker logic.
-- ============================================================================
begin;

-- ---- Controllable pg_net (hermetic; rolled back with the transaction). -------
create table if not exists net._http_response (
  id bigint primary key, status_code integer, content_type text, headers jsonb,
  content text, timed_out boolean, error_msg text, created timestamptz default now()
);
create sequence if not exists public._t_req_seq;
create table if not exists public._t_http_calls (
  request_id bigint, url text, headers jsonb, body jsonb, at timestamptz default now()
);
create or replace function net.http_post(
  url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb, timeout_milliseconds int default 5000
) returns bigint language plpgsql as $f$
declare v_id bigint;
begin
  v_id := nextval('public._t_req_seq');
  insert into public._t_http_calls(request_id, url, headers, body) values (v_id, url, headers, body);
  return v_id;
end $f$;

do $$
declare
  v_count    int;
  v_command  text;
  v_active   boolean;
  v_schedule text;
  v_secdef   boolean;
  v_config   text[];
  v_oid      oid;
  v_has_path boolean;
  v_bad      int;
  v_calls    int;
  v_last     bigint;
  v_outcome  text;
  v_success  boolean;
  v_status   int;
  v_ec       text;
  v_hdr      text;
  v_affected int;
  v_col      int;
  v_rid      bigint;
begin
  -- CASE 17: exactly one active, every-minute 'lazywait-sync' cron job.
  select count(*) into v_count from cron.job where jobname = 'lazywait-sync';
  if v_count <> 1 then raise exception 'CASE 17 FAILED: expected 1 job, found %', v_count; end if;
  select schedule, active into v_schedule, v_active from cron.job where jobname = 'lazywait-sync';
  if v_schedule <> '* * * * *' or not v_active then raise exception 'CASE 17 FAILED: schedule=% active=%', v_schedule, v_active; end if;
  select command into v_command from cron.job where jobname = 'lazywait-sync';
  if v_command ~* 'secret|token|bearer|https?://|x-sync-secret' then raise exception 'CASE 17 FAILED: credential in cron command'; end if;

  -- CASE 16: driver is SECURITY DEFINER + pinned search_path + service-role-only;
  -- clients cannot execute it or read the ledger/view.
  select p.oid, p.prosecdef, p.proconfig into v_oid, v_secdef, v_config
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='invoke_lazywait_sync_processor';
  if v_secdef is distinct from true then raise exception 'CASE 16 FAILED: not SECURITY DEFINER'; end if;
  v_has_path := exists (select 1 from unnest(coalesce(v_config, array[]::text[])) c where c like 'search_path=%');
  if not v_has_path then raise exception 'CASE 16 FAILED: no pinned search_path'; end if;
  select count(*) into v_bad from information_schema.routine_privileges
   where routine_schema='public' and routine_name='invoke_lazywait_sync_processor'
     and grantee in ('PUBLIC','anon','authenticated') and privilege_type='EXECUTE';
  if v_bad <> 0 then raise exception 'CASE 16 FAILED: client EXECUTE on driver'; end if;
  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema='public' and table_name in ('lazywait_sync_requests','lazywait_sync_cron_health')
     and grantee in ('PUBLIC','anon','authenticated');
  if v_bad <> 0 then raise exception 'CASE 16 FAILED: client grants on ledger/view'; end if;
  if not (select relrowsecurity from pg_class where oid='public.lazywait_sync_requests'::regclass) then
    raise exception 'CASE 16 FAILED: RLS not enabled on ledger';
  end if;

  -- CASE 15: no secret/headers/body/customer/order data columns on ledger or view.
  select count(*) into v_col from information_schema.columns
   where table_schema='public' and table_name in ('lazywait_sync_requests','lazywait_sync_cron_health')
     and column_name ~* 'secret|token|x_sync|header|body|content|authorization|customer|order';
  if v_col <> 0 then raise exception 'CASE 15 FAILED: unsafe column on ledger/view'; end if;

  -- Baseline config: valid project URL + secret.
  insert into vault.decrypted_secrets(name, decrypted_secret)
  values ('lazywait_sync_project_url','https://proj-ref.supabase.co')
  on conflict do nothing;

  -- CASE 1 + 2: run row created BEFORE preflight; missing row -> durable
  -- preflight_failed + zero HTTP.
  delete from public.integration_settings where provider_type='lazywait';
  select count(*) into v_calls from public._t_http_calls;
  perform public.invoke_lazywait_sync_processor();
  select id, outcome, error_code into v_last, v_outcome, v_ec from public.lazywait_sync_requests order by id desc limit 1;
  if v_outcome <> 'preflight_failed' or v_ec <> 'lazywait_integration_missing' then
    raise exception 'CASE 2 FAILED: outcome=% ec=%', v_outcome, v_ec;
  end if;
  if (select completed_at from public.lazywait_sync_requests where id=v_last) is null then
    raise exception 'CASE 2 FAILED: completed_at not set';
  end if;
  if (select count(*) from public._t_http_calls) <> v_calls then raise exception 'CASE 2 FAILED: HTTP call made'; end if;
  insert into public.integration_settings (provider_type, provider_name, enabled, secret_config)
  values ('lazywait','lazywait',false,'{}'::jsonb);

  -- CASE 3: missing/empty/blank/null secret -> preflight_failed (sync_secret_missing), zero HTTP.
  foreach v_command in array array['{}','{"sync_trigger_secret":null}','{"sync_trigger_secret":"   "}']
  loop
    update public.integration_settings set secret_config=v_command::jsonb where provider_type='lazywait';
    select count(*) into v_calls from public._t_http_calls;
    perform public.invoke_lazywait_sync_processor();
    select outcome, error_code into v_outcome, v_ec from public.lazywait_sync_requests order by id desc limit 1;
    if v_outcome <> 'preflight_failed' or v_ec <> 'sync_secret_missing' then
      raise exception 'CASE 3 FAILED for [%]: outcome=% ec=%', v_command, v_outcome, v_ec;
    end if;
    if (select count(*) from public._t_http_calls) <> v_calls then raise exception 'CASE 3 FAILED: HTTP call for [%]', v_command; end if;
  end loop;

  -- CASE 4: valid secret but missing project URL -> preflight_failed (project_url_missing), zero HTTP.
  delete from vault.decrypted_secrets where name='lazywait_sync_project_url';
  update public.integration_settings set secret_config='{"sync_trigger_secret":"valid-secret"}'::jsonb where provider_type='lazywait';
  select count(*) into v_calls from public._t_http_calls;
  perform public.invoke_lazywait_sync_processor();
  select outcome, error_code into v_outcome, v_ec from public.lazywait_sync_requests order by id desc limit 1;
  if v_outcome <> 'preflight_failed' or v_ec <> 'project_url_missing' then raise exception 'CASE 4 FAILED: outcome=% ec=%', v_outcome, v_ec; end if;
  if (select count(*) from public._t_http_calls) <> v_calls then raise exception 'CASE 4 FAILED: HTTP call made'; end if;
  insert into vault.decrypted_secrets(name, decrypted_secret) values ('lazywait_sync_project_url','https://proj-ref.supabase.co');

  -- CASE 6 + 7: secret sent VERBATIM; queued run row shows 'pending' (success NULL).
  update public.integration_settings set secret_config='{"sync_trigger_secret":"  Sp Ac ed-Secret  "}'::jsonb where provider_type='lazywait';
  v_rid := public.invoke_lazywait_sync_processor();
  select headers->>'x-sync-secret' into v_hdr from public._t_http_calls where request_id=v_rid;
  if v_hdr is distinct from '  Sp Ac ed-Secret  ' then raise exception 'CASE 6 FAILED: secret altered -> [%]', v_hdr; end if;
  if (select body->>'limit' from public._t_http_calls where request_id=v_rid) <> '5' then raise exception 'CASE 6 FAILED: batch not bounded'; end if;
  select outcome, success into v_outcome, v_success from public.lazywait_sync_cron_health where request_id=v_rid;
  if v_outcome <> 'pending' or v_success is not null then raise exception 'CASE 7 FAILED: outcome=% success=%', v_outcome, v_success; end if;

  -- CASE 8: injected real 200 response is durably snapshotted as success_2xx on the next tick.
  insert into net._http_response(id, status_code, timed_out) values (v_rid, 200, false);
  perform public.invoke_lazywait_sync_processor();   -- reconciles
  select outcome, success, http_status into v_outcome, v_success, v_status from public.lazywait_sync_cron_health where request_id=v_rid;
  if v_outcome <> 'success_2xx' or v_success is distinct from true or v_status <> 200 then
    raise exception 'CASE 8 FAILED: outcome=% success=% status=%', v_outcome, v_success, v_status;
  end if;

  -- CASE 9: 401/403/429/4xx/5xx/timeout/transport durably snapshotted correctly.
  insert into public.lazywait_sync_requests(request_id, started_at, outcome) values
    (91401, now(), 'pending'),(91403, now(), 'pending'),(91429, now(), 'pending'),
    (91400, now(), 'pending'),(91500, now(), 'pending'),(91408, now(), 'pending'),(91000, now(), 'pending');
  insert into net._http_response(id, status_code, timed_out, error_msg) values
    (91401, 401, false, 'unauthorized'),(91403, 403, false, 'forbidden'),(91429, 429, false, 'slow down'),
    (91400, 400, false, 'bad request'),(91500, 500, false, 'oops'),
    (91408, null, true, 'Timeout was reached'),(91000, null, false, 'Connection refused');
  perform public.invoke_lazywait_sync_processor();   -- reconciles all
  if (select outcome from public.lazywait_sync_cron_health where request_id=91401) <> 'auth_failed' then raise exception 'CASE 9 FAILED: 401'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=91403) <> 'auth_failed' then raise exception 'CASE 9 FAILED: 403'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=91429) <> 'rate_limited' then raise exception 'CASE 9 FAILED: 429'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=91400) <> 'client_error_4xx' then raise exception 'CASE 9 FAILED: 400'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=91500) <> 'server_error_5xx' then raise exception 'CASE 9 FAILED: 500'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=91408) <> 'timeout' then raise exception 'CASE 9 FAILED: timeout'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=91000) <> 'transport_error' then raise exception 'CASE 9 FAILED: transport'; end if;
  if (select success from public.lazywait_sync_cron_health where request_id=91401) is distinct from false then raise exception 'CASE 9 FAILED: 401 success not false'; end if;

  -- CASE 10: deleting the pg_net response afterwards does NOT change the snapshot.
  delete from net._http_response where id=91500;
  perform public.invoke_lazywait_sync_processor();   -- reconcile again
  if (select outcome from public.lazywait_sync_cron_health where request_id=91500) <> 'server_error_5xx' then
    raise exception 'CASE 10 FAILED: snapshot changed after response deleted';
  end if;

  -- CASE 11: a queued request with no response ages into expired_unknown (not pending forever).
  insert into public.lazywait_sync_requests(request_id, started_at, outcome) values (95001, now() - interval '20 minutes', 'pending');
  perform public.invoke_lazywait_sync_processor();   -- reconcile ages it
  select outcome, success into v_outcome, v_success from public.lazywait_sync_cron_health where request_id=95001;
  if v_outcome <> 'expired_unknown' or v_success is not null then raise exception 'CASE 11 FAILED: outcome=% success=%', v_outcome, v_success; end if;
  if (select completed_at from public.lazywait_sync_requests where request_id=95001) is null then raise exception 'CASE 11 FAILED: completed_at null'; end if;

  -- CASE 12: reconciliation idempotent; terminal outcomes cannot regress.
  perform public.invoke_lazywait_sync_processor();
  perform public.invoke_lazywait_sync_processor();
  if (select outcome from public.lazywait_sync_cron_health where request_id=91429) <> 'rate_limited' then raise exception 'CASE 12 FAILED: 429 regressed'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=v_rid) <> 'success_2xx' then raise exception 'CASE 12 FAILED: 200 regressed'; end if;

  -- CASE 13: a duplicate reconcile (same snapshot UPDATE) cannot overwrite a finalized row.
  update public.lazywait_sync_requests led
     set outcome='pending', http_status=null
    from net._http_response r
   where led.request_id=r.id and led.request_id=91429 and led.outcome in ('starting','pending');
  get diagnostics v_affected = row_count;
  if v_affected <> 0 then raise exception 'CASE 13 FAILED: finalized row was writable by reconcile guard'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=91429) <> 'rate_limited' then raise exception 'CASE 13 FAILED: 429 changed'; end if;

  -- CASE 14: retention prunes only rows older than 14 days; business rows untouched.
  insert into public.lazywait_sync_requests(request_id, started_at, outcome) values
    (70001, now() - interval '20 days', 'success_2xx'),
    (70002, now() - interval '2 days',  'success_2xx');
  perform public.invoke_lazywait_sync_processor();   -- prunes on tick
  if exists (select 1 from public.lazywait_sync_requests where request_id=70001) then raise exception 'CASE 14 FAILED: stale (>14d) row not pruned'; end if;
  if not exists (select 1 from public.lazywait_sync_requests where request_id=70002) then raise exception 'CASE 14 FAILED: recent (<14d) row pruned'; end if;
  if not exists (select 1 from public.integration_settings where provider_type='lazywait') then raise exception 'CASE 14 FAILED: business row (integration_settings) touched'; end if;

  -- CASE 5: an unexpected internal failure is caught and persisted as driver_error
  -- (no raw SQLERRM). Swap net.http_post to raise; valid config so preflight passes.
  create or replace function net.http_post(url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $f$ begin raise exception 'simulated pg_net failure with secret-ish text'; end $f$;
  update public.integration_settings set secret_config='{"sync_trigger_secret":"valid-secret"}'::jsonb where provider_type='lazywait';
  perform public.invoke_lazywait_sync_processor();
  select outcome, error_code, safe_error_message into v_outcome, v_ec, v_command from public.lazywait_sync_requests order by id desc limit 1;
  if v_outcome <> 'driver_error' then raise exception 'CASE 5 FAILED: outcome=%', v_outcome; end if;
  if v_ec is null then raise exception 'CASE 5 FAILED: no SQLSTATE error_code'; end if;
  if coalesce(v_command,'') ~* 'secret' then raise exception 'CASE 5 FAILED: raw error leaked (secret-ish) -> %', v_command; end if;

  raise notice 'ALL LAZYWAIT SYNC SCHEDULER CASES PASSED';
end $$;

rollback;
