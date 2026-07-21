-- ============================================================================
-- Tests for public.lazywait_sync_health_summary() (migration 20260721150000).
--
-- Runs against a throwaway Postgres with all migrations applied. Transactional
-- (begin … rollback); each case RAISES on failure. Seeds the durable ledger
-- (lazywait_sync_requests) directly — the driver itself is not invoked, so no
-- HTTP request is ever made and no scheduler/worker behavior is exercised.
--
-- Invariants under test: the summary reports the HTTP OUTCOME (from the durable
-- reconciled snapshot), not merely that a request was queued; consecutive-401
-- and consecutive-5xx/timeout streaks walk only OBSERVED responses newest-first
-- and reset on any other observed response; due pending/failed orders with no
-- successful worker invocation since they became due are surfaced; the function
-- is service-role-only and exposes no secret material.
-- ============================================================================
begin;

-- ---- Phase 1: empty state ---------------------------------------------------
do $$
declare s jsonb;
begin
  s := public.lazywait_sync_health_summary();
  if s->'latest_run'      is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_run not null -> %', s->'latest_run'; end if;
  if s->'latest_response' is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_response not null'; end if;
  if s->'latest_success'  is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_success not null'; end if;
  if s->'latest_failure'  is distinct from 'null'::jsonb then raise exception 'EMPTY: latest_failure not null'; end if;
  if (s->>'consecutive_http_401')::int <> 0 or (s->>'consecutive_5xx_or_timeout')::int <> 0 then
    raise exception 'EMPTY: streaks not zero -> %', s; end if;
  if (s->>'due_pending_failed_orders')::int <> 0 or (s->>'due_without_success_since')::int <> 0 then
    raise exception 'EMPTY: due counts not zero -> %', s; end if;
  raise notice 'HEALTH EMPTY OK';
end $$;

-- ---- Phase 2: success then two 401s ----------------------------------------
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
  if (s->'latest_response'->>'http_status')::int <> 401 then
    raise exception '401s: latest_response status wrong -> %', s->'latest_response'; end if;
  if (s->'latest_success'->>'request_id')::bigint <> 101 then
    raise exception '401s: latest_success wrong -> %', s->'latest_success'; end if;
  if s->'latest_failure'->>'outcome' <> 'auth_failed' or (s->'latest_failure'->>'request_id')::bigint <> 103 then
    raise exception '401s: latest_failure wrong -> %', s->'latest_failure'; end if;
  -- Two consecutive observed 401s; the older 200 breaks the streak at 2.
  if (s->>'consecutive_http_401')::int <> 2 then
    raise exception '401s: expected streak 2 -> %', s->>'consecutive_http_401'; end if;
  if (s->>'consecutive_5xx_or_timeout')::int <> 0 then
    raise exception '401s: 5xx streak should be 0'; end if;
  raise notice 'HEALTH 401 STREAK OK';
end $$;

-- ---- Phase 3: newer 5xx + timeout reset the 401 streak ----------------------
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
  raise notice 'HEALTH 5XX/TIMEOUT STREAK OK';
end $$;

-- ---- Phase 4: non-observed rows (preflight/starting) ------------------------
-- They surface as latest_run / latest_failure but never disturb the OBSERVED
-- response streaks or latest_response.
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
  raise notice 'HEALTH NON-OBSERVED ROWS OK';
end $$;

-- ---- Phase 5: recovery 2xx clears both streaks ------------------------------
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
  raise notice 'HEALTH RECOVERY OK';
end $$;

-- ---- Phase 6: due pending/failed orders vs the latest success ---------------
-- Latest success started at now()-5m (row 108). An order due AFTER that (O1)
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
  if (select count(*) from jsonb_object_keys(s)) <> 10 then
    raise exception 'SHAPE: unexpected key count -> %', (select string_agg(k, ',') from jsonb_object_keys(s) k); end if;
  if position('SENTINEL_TRIGGER_9X7Q' in s::text) > 0 then
    raise exception 'SHAPE: trigger secret leaked into health output'; end if;
  if s::text ilike '%x-sync-secret%' then
    raise exception 'SHAPE: header material in health output'; end if;
  raise notice 'HEALTH GRANTS/SHAPE OK';
end $$;

rollback;
