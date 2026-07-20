-- ============================================================================
-- Structural, fail-closed, secret-fidelity and HTTP-observability test for the
-- lazywait-sync pg_cron driver (migration 20260720120000_lazywait_sync_scheduler.sql).
--
-- Runs against a Postgres with the migration applied. It is HERMETIC: inside the
-- (rolled-back) transaction it installs a controllable pg_net — a recording
-- net.http_post and an injectable net._http_response — so every HTTP outcome is
-- exercised deterministically with NO real network call. Each case RAISES
-- EXCEPTION on failure; a clean run prints a NOTICE and commits nothing.
--
-- The trigger secret is the single source of truth in integration_settings
-- (provider_type='lazywait'), never in Vault; only the non-secret
-- lazywait_sync_project_url lives in Vault. The value is sent VERBATIM.
--
-- Worker runtime behaviour (429/timeout/5xx retryable, duplicate/already-synced
-- no-resend, stale-claim recovery) is covered by the UNCHANGED tests
-- supabase/functions/_shared/lazywait.test.ts and
-- supabase/tests/lazywait_reap_test.sql — this migration adds no worker logic.
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
  url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint language plpgsql as $f$
declare v_id bigint;
begin
  v_id := nextval('public._t_req_seq');
  insert into public._t_http_calls(request_id, url, headers, body) values (v_id, url, headers, body);
  return v_id;
end $f$;

do $$
declare
  v_count     int;
  v_command   text;
  v_active    boolean;
  v_schedule  text;
  v_secdef    boolean;
  v_config    text[];
  v_oid       oid;
  v_has_path  boolean;
  v_bad       int;
  v_def       text;
  v_raised    boolean;
  v_req       bigint;
  v_req2      bigint;
  v_hdr       text;
  v_calls     int;
  v_outcome   text;
  v_success   boolean;
  v_status    int;
  v_completed boolean;
  v_tmo       boolean;
  v_err       text;
  v_col       int;
begin
  -- Case 1: exactly one active, every-minute 'lazywait-sync' cron job.
  select count(*) into v_count from cron.job where jobname = 'lazywait-sync';
  if v_count <> 1 then raise exception 'CASE 1 FAILED: expected 1 job, found %', v_count; end if;
  select schedule, active, command into v_schedule, v_active, v_command
    from cron.job where jobname = 'lazywait-sync';
  if v_schedule <> '* * * * *' then raise exception 'CASE 1 FAILED: schedule % ', v_schedule; end if;
  if not v_active then raise exception 'CASE 1 FAILED: not active'; end if;

  -- Case 2: cron command has NO secret/URL — just the call.
  if v_command !~ 'invoke_lazywait_sync_processor' then
    raise exception 'CASE 2 FAILED: command does not call the driver -> %', v_command;
  end if;
  if v_command ~* 'secret|token|bearer|https?://|x-sync-secret' then
    raise exception 'CASE 2 FAILED: command embeds a credential/URL -> %', v_command;
  end if;

  -- Case 3: SECURITY DEFINER + pinned search_path + service-role-only EXECUTE.
  select p.oid, p.prosecdef, p.proconfig into v_oid, v_secdef, v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoke_lazywait_sync_processor';
  if v_secdef is distinct from true then raise exception 'CASE 3 FAILED: not SECURITY DEFINER'; end if;
  v_has_path := exists (select 1 from unnest(coalesce(v_config, array[]::text[])) c where c like 'search_path=%');
  if not v_has_path then raise exception 'CASE 3 FAILED: no pinned search_path'; end if;
  select count(*) into v_bad from information_schema.routine_privileges
   where routine_schema='public' and routine_name='invoke_lazywait_sync_processor'
     and grantee in ('PUBLIC','anon','authenticated') and privilege_type='EXECUTE';
  if v_bad <> 0 then raise exception 'CASE 3 FAILED: client EXECUTE on driver (%)', v_bad; end if;

  -- Case 4: reads the authoritative setting; secret NOT from Vault; keyed on provider_type.
  v_def := pg_get_functiondef(v_oid);
  if v_def !~ 'integration_settings' or v_def !~ 'sync_trigger_secret' then
    raise exception 'CASE 4 FAILED: does not read sync_trigger_secret from integration_settings';
  end if;
  if v_def ~ 'lazywait_sync_trigger_secret' then
    raise exception 'CASE 4 FAILED: still references a Vault trigger secret';
  end if;
  if v_def !~ 'provider_type' then raise exception 'CASE 4 FAILED: not keyed on provider_type'; end if;

  -- ---- Fail-closed cases: each must raise BEFORE any HTTP call. -------------
  -- Case 5a: empty secret_config '{}'.
  update public.integration_settings set secret_config = '{}'::jsonb where provider_type='lazywait';
  select count(*) into v_calls from public._t_http_calls;
  v_raised := false;
  begin perform public.invoke_lazywait_sync_processor();
  exception when others then v_raised := true;
    if sqlerrm !~ 'sync_trigger_secret' then raise exception 'CASE 5a FAILED: % ', sqlerrm; end if;
  end;
  if not v_raised then raise exception 'CASE 5a FAILED: empty secret did not fail closed'; end if;
  if (select count(*) from public._t_http_calls) <> v_calls then raise exception 'CASE 5a FAILED: HTTP call made'; end if;

  -- Case 5b: JSON null secret.
  update public.integration_settings set secret_config = '{"sync_trigger_secret": null}'::jsonb where provider_type='lazywait';
  v_raised := false;
  begin perform public.invoke_lazywait_sync_processor();
  exception when others then v_raised := true;
    if sqlerrm !~ 'sync_trigger_secret' then raise exception 'CASE 5b FAILED: % ', sqlerrm; end if;
  end;
  if not v_raised then raise exception 'CASE 5b FAILED: null secret did not fail closed'; end if;

  -- Case 5c: whitespace-only secret.
  update public.integration_settings set secret_config = '{"sync_trigger_secret":"   "}'::jsonb where provider_type='lazywait';
  select count(*) into v_calls from public._t_http_calls;
  v_raised := false;
  begin perform public.invoke_lazywait_sync_processor();
  exception when others then v_raised := true;
    if sqlerrm !~ 'sync_trigger_secret' then raise exception 'CASE 5c FAILED: % ', sqlerrm; end if;
  end;
  if not v_raised then raise exception 'CASE 5c FAILED: blank secret did not fail closed'; end if;
  if (select count(*) from public._t_http_calls) <> v_calls then raise exception 'CASE 5c FAILED: HTTP call made'; end if;

  -- Case 6: missing integration row.
  delete from public.integration_settings where provider_type='lazywait';
  v_raised := false;
  begin perform public.invoke_lazywait_sync_processor();
  exception when others then v_raised := true;
    if sqlerrm !~ 'integration_settings row is missing' then raise exception 'CASE 6 FAILED: % ', sqlerrm; end if;
  end;
  if not v_raised then raise exception 'CASE 6 FAILED: missing row did not fail closed'; end if;
  -- restore the row
  insert into public.integration_settings (provider_type, provider_name, enabled, secret_config)
  values ('lazywait','lazywait',false,'{}'::jsonb);

  -- Case 7: valid secret but NO project URL in Vault -> fail closed at the URL,
  -- proving the secret was read live first.
  delete from vault.decrypted_secrets where name = 'lazywait_sync_project_url';
  update public.integration_settings set secret_config = '{"sync_trigger_secret":"valid-secret"}'::jsonb where provider_type='lazywait';
  select count(*) into v_calls from public._t_http_calls;
  v_raised := false;
  begin perform public.invoke_lazywait_sync_processor();
  exception when others then v_raised := true;
    if sqlerrm !~ 'lazywait_sync_project_url' then raise exception 'CASE 7 FAILED: % ', sqlerrm; end if;
  end;
  if not v_raised then raise exception 'CASE 7 FAILED: missing URL did not fail closed'; end if;
  if (select count(*) from public._t_http_calls) <> v_calls then raise exception 'CASE 7 FAILED: HTTP call made'; end if;

  -- ---- Success path: secret sent VERBATIM + rotation + ledger correlation. --
  insert into vault.decrypted_secrets(name, decrypted_secret)
  values ('lazywait_sync_project_url', 'https://proj-ref.supabase.co');

  -- Case 8: a secret with leading/trailing (and internal) whitespace is sent EXACTLY unchanged.
  update public.integration_settings set secret_config = '{"sync_trigger_secret":"  Sp Ac ed-Secret  "}'::jsonb where provider_type='lazywait';
  v_req := public.invoke_lazywait_sync_processor();
  select headers->>'x-sync-secret' into v_hdr from public._t_http_calls where request_id = v_req;
  if v_hdr is distinct from '  Sp Ac ed-Secret  ' then
    raise exception 'CASE 8 FAILED: secret altered in header -> [%]', v_hdr;
  end if;
  -- body bounded to limit 5; no secret leaks into url/body
  if (select body->>'limit' from public._t_http_calls where request_id = v_req) <> '5' then
    raise exception 'CASE 8 FAILED: batch not bounded to 5';
  end if;
  if exists (select 1 from public._t_http_calls where request_id = v_req and (url ~* 'secret' or body::text ~* 'secret')) then
    raise exception 'CASE 8 FAILED: secret leaked into url/body';
  end if;
  -- ledger recorded the request id (correlation)
  if not exists (select 1 from public.lazywait_sync_requests where request_id = v_req) then
    raise exception 'CASE 8 FAILED: request id not recorded in ledger';
  end if;

  -- Case 8b: rotation is a pure UPDATE — the new value is read live and sent.
  update public.integration_settings set secret_config = '{"sync_trigger_secret":"Rotated-Value-2"}'::jsonb where provider_type='lazywait';
  v_req2 := public.invoke_lazywait_sync_processor();
  select headers->>'x-sync-secret' into v_hdr from public._t_http_calls where request_id = v_req2;
  if v_hdr <> 'Rotated-Value-2' then
    raise exception 'CASE 8b FAILED: rotated secret not sent live -> [%]', v_hdr;
  end if;

  -- ---- HTTP observability: the health view reflects the ACTUAL pg_net response.
  -- Inject one ledger + response pair per scenario and assert the view's outcome.
  insert into public.lazywait_sync_requests(request_id, queued_at) values
    (900200, now()),(900401, now()),(900403, now()),(900429, now()),
    (900500, now()),(900408, now()),(900000, now()),(900999, now());
  insert into net._http_response(id, status_code, timed_out, error_msg) values
    (900200, 200,  false, null),
    (900401, 401,  false, 'unauthorized'),
    (900403, 403,  false, 'forbidden'),
    (900429, 429,  false, 'rate limited'),
    (900500, 500,  false, 'server error'),
    (900408, null, true,  'Timeout was reached'),
    (900000, null, false, 'Connection refused');
  -- 900999 has NO response row (pending)

  -- Case 9: outcome classification.
  select outcome, success, http_status, completed, timed_out
    into v_outcome, v_success, v_status, v_completed, v_tmo
    from public.lazywait_sync_cron_health where request_id = 900200;
  if v_outcome <> 'success_2xx' or v_success is distinct from true or v_status <> 200 or not v_completed then
    raise exception 'CASE 9 FAILED: 200 -> outcome=% success=% status=%', v_outcome, v_success, v_status;
  end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=900401) <> 'auth_failed' then raise exception 'CASE 9 FAILED: 401'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=900403) <> 'auth_failed' then raise exception 'CASE 9 FAILED: 403'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=900429) <> 'rate_limited' then raise exception 'CASE 9 FAILED: 429'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=900500) <> 'server_error_5xx' then raise exception 'CASE 9 FAILED: 500'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=900408) <> 'timeout' then raise exception 'CASE 9 FAILED: timeout'; end if;
  if (select outcome from public.lazywait_sync_cron_health where request_id=900000) <> 'transport_error' then raise exception 'CASE 9 FAILED: transport'; end if;
  select outcome, success, completed from public.lazywait_sync_cron_health where request_id=900999
    into v_outcome, v_success, v_completed;
  if v_outcome <> 'pending' or v_success is not null or v_completed then
    raise exception 'CASE 9 FAILED: pending -> outcome=% success=% completed=%', v_outcome, v_success, v_completed;
  end if;
  -- success boolean is false for a 401 (never inferred from cron status)
  if (select success from public.lazywait_sync_cron_health where request_id=900401) is distinct from false then
    raise exception 'CASE 9 FAILED: 401 success should be false';
  end if;

  -- Case 10: access control + no secret exposed.
  if not (select relrowsecurity from pg_class where oid = 'public.lazywait_sync_requests'::regclass) then
    raise exception 'CASE 10 FAILED: RLS not enabled on ledger';
  end if;
  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema='public' and table_name in ('lazywait_sync_requests','lazywait_sync_cron_health')
     and grantee in ('PUBLIC','anon','authenticated');
  if v_bad <> 0 then raise exception 'CASE 10 FAILED: client grants on ledger/view (%)', v_bad; end if;
  select count(*) into v_col from information_schema.columns
   where table_schema='public' and table_name in ('lazywait_sync_requests','lazywait_sync_cron_health')
     and column_name ~* 'secret|token|x_sync|header|body|content|authorization';
  if v_col <> 0 then raise exception 'CASE 10 FAILED: secret-like column on ledger/view'; end if;

  -- Case 11: retention prune (~14 days), never touching business records.
  insert into public.lazywait_sync_requests(request_id, queued_at) values
    (800001, now() - interval '20 days'),   -- stale
    (800002, now() - interval '2 days');    -- recent
  update public.integration_settings set secret_config = '{"sync_trigger_secret":"valid-secret"}'::jsonb where provider_type='lazywait';
  perform public.invoke_lazywait_sync_processor();  -- prunes on each tick
  if exists (select 1 from public.lazywait_sync_requests where request_id = 800001) then
    raise exception 'CASE 11 FAILED: stale ledger row (>14d) not pruned';
  end if;
  if not exists (select 1 from public.lazywait_sync_requests where request_id = 800002) then
    raise exception 'CASE 11 FAILED: recent ledger row (<14d) was pruned';
  end if;

  raise notice 'ALL LAZYWAIT SYNC SCHEDULER CASES PASSED';
end $$;

rollback;
