-- ============================================================================
-- Lazywait sync scheduler — service-role-only aggregate HEALTH SUMMARY.
--
-- OBSERVABILITY ONLY. Adds one read-only SECURITY DEFINER function that
-- aggregates the existing durable per-tick ledger (public.lazywait_sync_requests,
-- migration 20260720120000) and the orders sync-state columns into the health
-- signals an operator/alerting probe needs in one call:
--
--   * latest run (request id, outcome, HTTP status when observed)
--   * latest OBSERVED HTTP response (status / timeout / transport)
--   * latest successful worker invocation (HTTP 2xx)
--   * latest failure (observed HTTP failure, preflight_failed or driver_error)
--   * consecutive observed HTTP 401 responses  (secret mismatch signature)
--   * consecutive observed 5xx / timeout responses (worker or platform outage)
--   * due pending/failed Lazywait orders, and how many of them have had NO
--     successful worker invocation since they became due (stuck-queue signal)
--
-- SCOPE NOTES (verified before authoring):
--   * The trigger secret is ALREADY single-sourced: invoke_lazywait_sync_processor
--     reads integration_settings.secret_config.sync_trigger_secret live per tick
--     and Vault stores only the NON-secret project URL. No secret change is made
--     or needed here, and this function never reads or exposes secret_config.
--   * Per-tick HTTP-outcome detection ALREADY exists (the ledger is reconciled
--     from net._http_response). This adds the missing AGGREGATE view of it.
--   * No change to invoke_lazywait_sync_processor, the lazywait-sync worker,
--     payment, order intake, payload mapping, or POS logic. No cron change.
--   * Output contains only ids, timestamps, outcomes, HTTP statuses and counts —
--     no secret, header, response body, or customer/PII data.
--
-- Idempotent: create-or-replace + re-runnable grants.
-- ============================================================================

create or replace function public.lazywait_sync_health_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_latest_run             jsonb;
  v_latest_response        jsonb;
  v_latest_success         jsonb;
  v_latest_success_started timestamptz;
  v_latest_failure         jsonb;
  v_consec_401             integer := 0;
  v_consec_5xx_timeout     integer := 0;
  v_due_total              integer := 0;
  v_due_no_success         integer := 0;
  v_oldest_due_at          timestamptz;
begin
  -- Latest scheduler run of any kind (covers "latest request ID"; http_status
  -- is null until the response is reconciled into the durable snapshot).
  select jsonb_build_object(
           'run_id', id, 'request_id', request_id, 'started_at', started_at,
           'outcome', outcome, 'http_status', http_status)
    into v_latest_run
    from public.lazywait_sync_requests
   order by started_at desc, id desc
   limit 1;

  -- Latest OBSERVED transport outcome (covers "latest HTTP status"): a row the
  -- reconciler stamped from net._http_response — an HTTP status, a timeout, or
  -- a transport error. starting/pending/expired_unknown/preflight/driver rows
  -- carry no observed response and are excluded.
  select jsonb_build_object(
           'request_id', request_id, 'http_status', http_status,
           'timed_out', timed_out, 'responded_at', responded_at,
           'outcome', outcome)
    into v_latest_response
    from public.lazywait_sync_requests
   where outcome in ('success_2xx','auth_failed','rate_limited',
                     'client_error_4xx','server_error_5xx','timeout','transport_error')
   order by coalesce(responded_at, completed_at, started_at) desc, id desc
   limit 1;

  -- Latest successful worker invocation (observed HTTP 2xx only — the ledger
  -- never marks success from queueing alone).
  select started_at,
         jsonb_build_object(
           'request_id', request_id, 'started_at', started_at,
           'responded_at', responded_at, 'http_status', http_status)
    into v_latest_success_started, v_latest_success
    from public.lazywait_sync_requests
   where outcome = 'success_2xx'
   order by started_at desc, id desc
   limit 1;

  -- Latest failure of any kind: observed HTTP failure, timeout, transport
  -- error, preflight_failed (config incomplete) or driver_error.
  select jsonb_build_object(
           'request_id', request_id,
           'at', coalesce(completed_at, started_at),
           'outcome', outcome, 'error_code', error_code,
           'http_status', http_status)
    into v_latest_failure
    from public.lazywait_sync_requests
   where outcome in ('auth_failed','rate_limited','client_error_4xx',
                     'server_error_5xx','timeout','transport_error',
                     'preflight_failed','driver_error')
   order by coalesce(completed_at, started_at) desc, id desc
   limit 1;

  -- Consecutive-failure streaks over OBSERVED responses only, newest first.
  -- consecutive_http_401 counts strictly HTTP 401 (the repeated-401 signature of
  -- a rotated/mismatched x-sync-secret — 403 is auth_failed too but is a
  -- different misconfiguration, so it intentionally breaks the 401 streak).
  -- consecutive_5xx_or_timeout counts server_error_5xx and timeout outcomes.
  -- Any other observed response (e.g. a 2xx) resets the respective streak.
  with observed as (
    select http_status, outcome,
           row_number() over (
             order by coalesce(responded_at, completed_at, started_at) desc, id desc
           ) as rn
      from public.lazywait_sync_requests
     where outcome in ('success_2xx','auth_failed','rate_limited',
                       'client_error_4xx','server_error_5xx','timeout','transport_error')
  )
  select
    coalesce((select min(rn) - 1 from observed where http_status is distinct from 401),
             (select count(*) from observed)),
    coalesce((select min(rn) - 1 from observed where outcome not in ('server_error_5xx','timeout')),
             (select count(*) from observed))
    into v_consec_401, v_consec_5xx_timeout;

  -- Stuck-queue signal: orders currently claimable by the worker
  -- (state pending/failed and due now). due_without_success_since counts those
  -- with NO successful worker invocation after they became due — the exact
  -- signature of "cron rows look fine but the worker never actually ran".
  -- An order due BEFORE the latest success is excluded (a successful run has
  -- happened since; it may simply be beyond the batch limit this tick).
  select count(*),
         count(*) filter (where v_latest_success_started is null
                             or coalesce(sync_next_attempt_at, updated_at) > v_latest_success_started),
         min(coalesce(sync_next_attempt_at, updated_at))
    into v_due_total, v_due_no_success, v_oldest_due_at
    from public.orders
   where lazywait_sync_state in ('pending','failed')
     and (sync_next_attempt_at is null or sync_next_attempt_at <= now());

  return jsonb_build_object(
    'generated_at',               now(),
    'latest_run',                 v_latest_run,
    'latest_response',            v_latest_response,
    'latest_success',             v_latest_success,
    'latest_failure',             v_latest_failure,
    'consecutive_http_401',       v_consec_401,
    'consecutive_5xx_or_timeout', v_consec_5xx_timeout,
    'due_pending_failed_orders',  v_due_total,
    'due_without_success_since',  v_due_no_success,
    'oldest_due_at',              v_oldest_due_at
  );
end $$;

revoke all on function public.lazywait_sync_health_summary() from public, anon, authenticated;
grant execute on function public.lazywait_sync_health_summary() to service_role;

comment on function public.lazywait_sync_health_summary() is
  'Service-role-only aggregate health for the lazywait-sync pg_cron driver, read from the durable lazywait_sync_requests ledger + orders sync state: latest run/request id, latest observed HTTP status, latest 2xx success, latest failure, consecutive observed 401s (secret mismatch signature), consecutive 5xx/timeouts, and due pending/failed orders with no successful worker invocation since they became due. Exposes no secret, header, response body, or customer data. Observability only — no scheduler/worker/payment/POS behavior change.';
