-- ============================================================================
-- Tests for public.lazywait_sync_health_summary() (migration 20260721150000).
--
-- Runs against a throwaway Postgres with all migrations applied. Transactional
-- (begin … rollback); each case RAISES on failure. Seeds the durable ledger
-- (lazywait_sync_requests), cron.job, and orders directly — the driver itself
-- is not invoked, so no HTTP request is ever made and no scheduler/worker
-- behavior is exercised. The cron.job row is only touched INSIDE this
-- rolled-back transaction.
--
-- Invariants under test: the summary reports the HTTP OUTCOME (from the durable
-- reconciled snapshot), not merely that a request was queued; consecutive-401
-- and consecutive-5xx/timeout streaks walk only OBSERVED responses newest-first
-- and reset on any other observed response; due pending/failed orders with no
-- successful worker invocation since they became due are surfaced; overall_state
-- follows the documented deterministic cascade (config_error > failing >
-- degraded > idle > healthy; tick stale >3m, success stale >5m with due
-- orders); the function is service-role-only and exposes no secret material.
-- ============================================================================
begin;

-- ---- Phase 1: empty ledger --------------------------------------------------
-- The migration chain scheduled the cron job, so cron_active is true; with NO
-- durable tick yet the state is conservatively 'degraded' (never 'healthy'
-- unproven — documented in the migration header).
do $$
declare s jsonb;
begin
  s := public.lazywait_sync_health_summary();
  if (s->>'cron_active')::boolean is not true then raise exception 'EMPTY: cron_active not true'; end if;
  if s->'latest_run'      is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_run not null -> %', s->'latest_run'; end if;
  if s->'latest_response' is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_response not null'; end if;
  if s->'latest_success'  is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_success not null'; end if;
  if s->'latest_failure'  is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_failure not null'; end if;
  if s->'latest_cron_tick_at' is distinct from 'null'::jsonb then raise exception 'EMPTY: tick not null'; end if;
  if s->'latest_success_age_seconds' is distinct from 'null'::jsonb then raise exception 'EMPTY: success age not null'; end if;
  if (s->>'consecutive_http_401')::int <> 0 or (s->>'consecutive_5xx_or_timeout')::int <> 0 then
    raise exception 'EMPTY: streaks not zero -> %', s; end if;
  if (s->>'due_pending_failed_orders')::int <> 0 or (s->>'due_without_success_since')::int <> 0 then
    raise exception 'EMPTY: due counts not zero -> %', s; end if;
  if s->>'overall_state' <> 'degraded' then
    raise exception 'EMPTY: expected degraded (no tick ever) -> %', s->>'overall_state'; end if;
  raise notice 'HEALTH EMPTY OK';
end $$;

-- ---- Phase 2: success then two 401s -> failing ------------------------------
do $$
declare s jsonb;
begin
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status, timed_out, error_code) values
    (101, now()-interval '60m', now()-interval '60m', now()-interval '60m', now()-interval '60m', 'success_2xx', 200, false, null),
    (102, now()-interval '50m', now()-interval '50m', now()-interval '50m', now()-interval '50m', 'auth_failed', 401, false, 'http_401'),
    (103, now()-interval '40m', now()-interval '40m', now()-interval '40m', now()-interval '40m', 'auth_failed', 401, false, 'http_401');

  s := public.lazywait_sync_health_summary();
  if (s->'latest_run'->>'request_id')::bigint <> 103 then
    raise exception '401s: latest_run wrong -> %', s->'latest_run'; end if;
  if (s->>'latest_cron_tick_at')::timestamptz is distinct from null and
     abs(extract(epoch from ((s->>'latest_cron_tick_at')::timestamptz - (now()-interval '40m')))) > 5 then
    raise exception '401s: latest_cron_tick_at wrong -> %', s->>'latest_cron_tick_at'; end if;
  if (s->'latest_response'->>'http_status')::int <> 401 then
    raise exception '401s: latest_response status wrong -> %', s->'latest_response'; end if;
  if (s->'latest_success'->>'request_id')::bigint <> 101 then
    raise exception '401s: latest_success wrong -> %', s->'latest_success'; end if;
  -- success at -60m -> age ~3600s
  if (s->>'latest_success_age_seconds')::bigint not between 3590 and 3610 then
    raise exception '401s: success age wrong -> %', s->>'latest_success_age_seconds'; end if;
  if s->'latest_failure'->>'outcome' <> 'auth_failed' or (s->'latest_failure'->>'request_id')::bigint <> 103 then
    raise exception '401s: latest_failure wrong -> %', s->'latest_failure'; end if;
  -- Two consecutive observed 401s; the older 200 breaks the streak at 2.
  if (s->>'consecutive_http_401')::int <> 2 then
    raise exception '401s: expected streak 2 -> %', s->>'consecutive_http_401'; end if;
  if (s->>'consecutive_5xx_or_timeout')::int <> 0 then
    raise exception '401s: 5xx streak should be 0'; end if;
  -- Boundary: consecutive_http_401 >= 2 -> failing (secret-mismatch signature).
  if s->>'overall_state' <> 'failing' then
    raise exception '401s: expected failing -> %', s->>'overall_state'; end if;
  raise notice 'HEALTH 401 STREAK OK';
end $$;

-- ---- Phase 3: newer 5xx + timeout reset the 401 streak -> degraded ----------
do $$
declare s jsonb;
begin
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status, timed_out, error_code) values
    (104, now()-interval '30m', now()-interval '30m', now()-interval '30m', now()-interval '30m', 'server_error_5xx', 500, false, 'http_500'),
    (105, now()-interval '20m', now()-interval '20m', null,                 now()-interval '20m', 'timeout',          null, true,  'timeout');

  s := public.lazywait_sync_health_summary();
  if (s->>'consecutive_http_401')::int <> 0 then
    raise exception '5XX: 401 streak not reset -> %', s->>'consecutive_http_401'; end if;
  if (s->>'consecutive_5xx_or_timeout')::int <> 2 then
    raise exception '5XX: expected 5xx/timeout streak 2 -> %', s->>'consecutive_5xx_or_timeout'; end if;
  if s->'latest_response'->>'outcome' <> 'timeout' or (s->'latest_response'->>'timed_out')::boolean is not true then
    raise exception '5XX: latest_response should be the timeout -> %', s->'latest_response'; end if;
  if (s->'latest_failure'->>'request_id')::bigint <> 105 then
    raise exception '5XX: latest_failure wrong -> %', s->'latest_failure'; end if;
  -- Boundary: a 2-long 5xx/timeout streak is degraded, NOT yet failing (>=3).
  if s->>'overall_state' <> 'degraded' then
    raise exception '5XX: expected degraded -> %', s->>'overall_state'; end if;
  raise notice 'HEALTH 5XX/TIMEOUT STREAK OK';
end $$;

-- ---- Phase 4: non-observed rows (preflight/starting) -> configuration_error --
-- They surface as latest_run / latest_failure / latest TERMINAL result but
-- never disturb the OBSERVED response streaks or latest_response. A newer
-- in-flight 'starting' row must NOT mask the persisted preflight failure.
do $$
declare s jsonb;
begin
  insert into public.lazywait_sync_requests
    (request_id, started_at, completed_at, outcome, error_code) values
    (null, now()-interval '10m', now()-interval '10m', 'preflight_failed', 'sync_secret_missing');
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, outcome) values
    (107, now()-interval '1m', now()-interval '1m', 'starting');

  s := public.lazywait_sync_health_summary();
  if (s->'latest_run'->>'request_id')::bigint <> 107 or s->'latest_run'->>'outcome' <> 'starting' then
    raise exception 'NONOBS: latest_run wrong -> %', s->'latest_run'; end if;
  if (s->'latest_response'->>'request_id')::bigint <> 105 then
    raise exception 'NONOBS: latest_response disturbed -> %', s->'latest_response'; end if;
  if (s->>'consecutive_5xx_or_timeout')::int <> 2 or (s->>'consecutive_http_401')::int <> 0 then
    raise exception 'NONOBS: streaks disturbed'; end if;
  if s->'latest_failure'->>'outcome' <> 'preflight_failed'
     or s->'latest_failure'->>'error_code' <> 'sync_secret_missing' then
    raise exception 'NONOBS: latest_failure should be the newer preflight -> %', s->'latest_failure'; end if;
  -- Latest TERMINAL result is preflight_failed -> configuration_error
  -- (takes precedence over the degraded 5xx streak).
  if s->>'overall_state' <> 'configuration_error' then
    raise exception 'NONOBS: expected configuration_error -> %', s->>'overall_state'; end if;
  raise notice 'HEALTH NON-OBSERVED ROWS OK';
end $$;

-- ---- Phase 5: recovery 2xx clears streaks + config error -> healthy ---------
do $$
declare s jsonb;
begin
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status) values
    (108, now()-interval '5m', now()-interval '5m', now()-interval '4m', now()-interval '4m', 'success_2xx', 200);

  s := public.lazywait_sync_health_summary();
  if (s->>'consecutive_http_401')::int <> 0 or (s->>'consecutive_5xx_or_timeout')::int <> 0 then
    raise exception 'RECOVERY: streaks not cleared -> %', s; end if;
  if (s->'latest_success'->>'request_id')::bigint <> 108 then
    raise exception 'RECOVERY: latest_success wrong -> %', s->'latest_success'; end if;
  if (s->'latest_response'->>'http_status')::int <> 200 then
    raise exception 'RECOVERY: latest_response wrong -> %', s->'latest_response'; end if;
  -- success responded at -4m -> age ~240s
  if (s->>'latest_success_age_seconds')::bigint not between 230 and 250 then
    raise exception 'RECOVERY: success age wrong -> %', s->>'latest_success_age_seconds'; end if;
  -- cron active, tick -1m recent, latest response 2xx, no streaks, no due
  -- orders -> healthy (latest terminal is now the success, not the preflight).
  if s->>'overall_state' <> 'healthy' then
    raise exception 'RECOVERY: expected healthy -> %', s->>'overall_state'; end if;
  raise notice 'HEALTH RECOVERY OK';
end $$;

-- ---- Phase 6: due pending/failed orders vs the latest success -> degraded ---
-- Latest success STARTED at now()-5m (row 108). An order due AFTER that (O1)
-- has had no successful invocation since it became due; an order due BEFORE it
-- (O2) has. Future-scheduled (O3) and synced (O4) orders are excluded.
do $$
declare s jsonb;
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, sync_next_attempt_at, updated_at) values
    (gen_random_uuid(), 'HS-1', gen_random_uuid(), 'pickup', 10, 10, 'pending', null,                  now()-interval '2m'),
    (gen_random_uuid(), 'HS-2', gen_random_uuid(), 'pickup', 10, 10, 'failed',  now()-interval '30m',  now()-interval '30m'),
    (gen_random_uuid(), 'HS-3', gen_random_uuid(), 'pickup', 10, 10, 'failed',  now()+interval '10m',  now()),
    (gen_random_uuid(), 'HS-4', gen_random_uuid(), 'pickup', 10, 10, 'synced',  null,                  now());
  set local session_replication_role = origin;

  s := public.lazywait_sync_health_summary();
  if (s->>'due_pending_failed_orders')::int <> 2 then
    raise exception 'DUE: expected 2 due orders -> %', s->>'due_pending_failed_orders'; end if;
  if (s->>'due_without_success_since')::int <> 1 then
    raise exception 'DUE: expected 1 order with no success since due -> %', s->>'due_without_success_since'; end if;
  if (s->>'oldest_due_at')::timestamptz > now() - interval '29m' then
    raise exception 'DUE: oldest_due_at should be ~30m ago -> %', s->>'oldest_due_at'; end if;
  -- oldest_due_without_success_at counts ONLY the no-success-since orders (O1
  -- at ~-2m), not the overall oldest due order (O2 at ~-30m).
  if abs(extract(epoch from ((s->>'oldest_due_without_success_at')::timestamptz - (now()-interval '2m')))) > 5 then
    raise exception 'DUE: oldest_due_without_success_at wrong -> %', s->>'oldest_due_without_success_at'; end if;
  -- due_without_success_since > 0 (with a success existing) -> degraded.
  if s->>'overall_state' <> 'degraded' then
    raise exception 'DUE: expected degraded -> %', s->>'overall_state'; end if;
  raise notice 'HEALTH DUE ORDERS OK';
end $$;

-- ---- Phase 7: service-role-only + no secret material ------------------------
do $$
declare s jsonb;
begin
  if has_function_privilege('anon', 'public.lazywait_sync_health_summary()', 'execute') then
    raise exception 'GRANTS: anon can execute'; end if;
  if has_function_privilege('authenticated', 'public.lazywait_sync_health_summary()', 'execute') then
    raise exception 'GRANTS: authenticated can execute'; end if;
  if not has_function_privilege('service_role', 'public.lazywait_sync_health_summary()', 'execute') then
    raise exception 'GRANTS: service_role cannot execute'; end if;

  -- Output surface: exactly the documented keys, and NO secret material.
  -- Seed a sentinel trigger secret in the authoritative integration_settings row
  -- and prove the summary never reads/exposes it (error CODES like
  -- 'sync_secret_missing' are non-sensitive status strings and are allowed).
  update public.integration_settings
     set secret_config = coalesce(secret_config, '{}'::jsonb)
                         || jsonb_build_object('sync_trigger_secret', 'SENTINEL_TRIGGER_9X7Q')
   where provider_type = 'lazywait';
  s := public.lazywait_sync_health_summary();
  if (select count(*) from jsonb_object_keys(s)) <> 15 then
    raise exception 'SHAPE: unexpected key count -> %', (select string_agg(k, ',') from jsonb_object_keys(s) k); end if;
  if position('SENTINEL_TRIGGER_9X7Q' in s::text) > 0 then
    raise exception 'SHAPE: trigger secret leaked into health output'; end if;
  if s::text ilike '%x-sync-secret%' then
    raise exception 'SHAPE: header material in health output'; end if;
  raise notice 'HEALTH GRANTS/SHAPE OK';
end $$;

-- ---- Phase 8: overall_state matrix ------------------------------------------
-- Each sub-case rebuilds a minimal scenario from a clean slate (still inside
-- the rolled-back transaction) and asserts one state/boundary.
create function pg_temp.reset_health_fixtures() returns void language plpgsql as $$
begin
  delete from public.lazywait_sync_requests;
  delete from public.orders where order_number like 'HS-%';
end $$;

do $$
declare
  s jsonb;
  v_sched text; v_cmd text;
begin
  -- (a) idle: cron active, tick recent, NO observed response, nothing due.
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests (request_id, started_at, queued_at, outcome)
    values (201, now()-interval '30 seconds', now()-interval '30 seconds', 'starting');
  s := public.lazywait_sync_health_summary();
  if s->>'overall_state' <> 'idle' then
    raise exception 'STATE(a): expected idle -> %', s->>'overall_state'; end if;

  -- (b) cron INACTIVE -> failing regardless of a healthy-looking ledger.
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status)
    values (202, now()-interval '1m', now()-interval '1m', now()-interval '1m', now()-interval '1m', 'success_2xx', 200);
  update cron.job set active = false where jobname = 'lazywait-sync';
  s := public.lazywait_sync_health_summary();
  if (s->>'cron_active')::boolean is not false or s->>'overall_state' <> 'failing' then
    raise exception 'STATE(b): expected inactive+failing -> % / %', s->>'cron_active', s->>'overall_state'; end if;
  update cron.job set active = true where jobname = 'lazywait-sync';

  -- (c) cron MISSING -> cron_active=false + failing; then restore.
  select schedule, command into v_sched, v_cmd from cron.job where jobname = 'lazywait-sync';
  delete from cron.job where jobname = 'lazywait-sync';
  s := public.lazywait_sync_health_summary();
  if (s->>'cron_active')::boolean is not false or s->>'overall_state' <> 'failing' then
    raise exception 'STATE(c): expected missing+failing -> % / %', s->>'cron_active', s->>'overall_state'; end if;
  insert into cron.job (schedule, command, jobname, active) values (v_sched, v_cmd, 'lazywait-sync', true);

  -- (d) boundary: a SINGLE observed 401 is degraded, not failing.
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status, error_code) values
    (203, now()-interval '10m', now()-interval '10m', now()-interval '10m', now()-interval '10m', 'success_2xx', 200, null),
    (204, now()-interval '1m',  now()-interval '1m',  now()-interval '1m',  now()-interval '1m',  'auth_failed', 401, 'http_401');
  s := public.lazywait_sync_health_summary();
  if (s->>'consecutive_http_401')::int <> 1 or s->>'overall_state' <> 'degraded' then
    raise exception 'STATE(d): expected 1x401 degraded -> % / %', s->>'consecutive_http_401', s->>'overall_state'; end if;

  -- (e) boundary: THREE consecutive 5xx/timeouts -> failing.
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status, timed_out, error_code) values
    (205, now()-interval '10m', now()-interval '10m', now()-interval '10m', now()-interval '10m', 'success_2xx',      200,  false, null),
    (206, now()-interval '3m',  now()-interval '3m',  now()-interval '3m',  now()-interval '3m',  'server_error_5xx', 500,  false, 'http_500'),
    (207, now()-interval '2m',  now()-interval '2m',  now()-interval '2m',  now()-interval '2m',  'server_error_5xx', 502,  false, 'http_502'),
    (208, now()-interval '1m',  now()-interval '1m',  null,                 now()-interval '1m',  'timeout',          null, true,  'timeout');
  s := public.lazywait_sync_health_summary();
  if (s->>'consecutive_5xx_or_timeout')::int <> 3 or s->>'overall_state' <> 'failing' then
    raise exception 'STATE(e): expected 3x5xx failing -> % / %', s->>'consecutive_5xx_or_timeout', s->>'overall_state'; end if;

  -- (f) due order with NO successful invocation EVER -> failing.
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests (request_id, started_at, queued_at, outcome)
    values (209, now()-interval '30 seconds', now()-interval '30 seconds', 'starting');
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, sync_next_attempt_at, updated_at)
    values (gen_random_uuid(), 'HS-8f', gen_random_uuid(), 'pickup', 10, 10, 'pending', null, now()-interval '5m');
  set local session_replication_role = origin;
  s := public.lazywait_sync_health_summary();
  if (s->>'due_without_success_since')::int <> 1 or s->>'overall_state' <> 'failing' then
    raise exception 'STATE(f): expected no-success-ever failing -> %', s->>'overall_state'; end if;

  -- (g) STALE success (>5m) while a due order exists -> degraded (the due order
  --     became due BEFORE the success, so due_without_success_since = 0).
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status) values
    (210, now()-interval '10m', now()-interval '10m', now()-interval '10m', now()-interval '10m', 'success_2xx', 200);
  insert into public.lazywait_sync_requests (request_id, started_at, queued_at, outcome)
    values (211, now()-interval '30 seconds', now()-interval '30 seconds', 'starting');
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, sync_next_attempt_at, updated_at)
    values (gen_random_uuid(), 'HS-8g', gen_random_uuid(), 'pickup', 10, 10, 'failed', now()-interval '20m', now()-interval '20m');
  set local session_replication_role = origin;
  s := public.lazywait_sync_health_summary();
  if (s->>'due_without_success_since')::int <> 0 or s->>'overall_state' <> 'degraded' then
    raise exception 'STATE(g): expected stale-success degraded -> % / %', s->>'due_without_success_since', s->>'overall_state'; end if;

  -- (h) RECENT success (<5m) with the same due order -> healthy (worker is
  --     running; the order is simply beyond this tick''s batch).
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status) values
    (212, now()-interval '2m', now()-interval '2m', now()-interval '2m', now()-interval '2m', 'success_2xx', 200);
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, sync_next_attempt_at, updated_at)
    values (gen_random_uuid(), 'HS-8h', gen_random_uuid(), 'pickup', 10, 10, 'failed', now()-interval '20m', now()-interval '20m');
  set local session_replication_role = origin;
  s := public.lazywait_sync_health_summary();
  if s->>'overall_state' <> 'healthy' then
    raise exception 'STATE(h): expected healthy -> %', s->>'overall_state'; end if;

  -- (i) tick STALE (>3m), everything else clean -> degraded.
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status) values
    (213, now()-interval '10m', now()-interval '10m', now()-interval '10m', now()-interval '10m', 'success_2xx', 200);
  s := public.lazywait_sync_health_summary();
  if s->>'overall_state' <> 'degraded' then
    raise exception 'STATE(i): expected stale-tick degraded -> %', s->>'overall_state'; end if;

  -- (j) latest terminal driver_error -> configuration_error.
  perform pg_temp.reset_health_fixtures();
  insert into public.lazywait_sync_requests
    (request_id, started_at, queued_at, responded_at, completed_at, outcome, http_status) values
    (214, now()-interval '10m', now()-interval '10m', now()-interval '10m', now()-interval '10m', 'success_2xx', 200);
  insert into public.lazywait_sync_requests (request_id, started_at, completed_at, outcome, error_code)
    values (null, now()-interval '1m', now()-interval '1m', 'driver_error', '58000');
  s := public.lazywait_sync_health_summary();
  if s->>'overall_state' <> 'configuration_error' then
    raise exception 'STATE(j): expected driver_error configuration_error -> %', s->>'overall_state'; end if;

  raise notice 'HEALTH STATE MATRIX OK';
end $$;

rollback;
