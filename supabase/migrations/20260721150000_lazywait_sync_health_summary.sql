-- ============================================================================
-- Lazywait sync scheduler — service-role-only aggregate HEALTH SUMMARY.
--
-- OBSERVABILITY ONLY. Adds one read-only SECURITY DEFINER function that
-- aggregates the existing durable per-tick ledger (public.lazywait_sync_requests,
-- migration 20260720120000), the single cron.job registration, and the orders
-- sync-state columns into the health signals an operator/alerting probe needs
-- in one call:
--
--   * cron_active                — the 'lazywait-sync' cron job exists and is
--                                  active (false when missing or inactive)
--   * latest_run / latest_cron_tick_at — latest durable scheduler run
--   * latest_response            — latest OBSERVED HTTP outcome
--   * latest_success (+ latest_success_age_seconds) — latest observed HTTP 2xx
--   * latest_failure             — latest observed/preflight/driver failure
--   * consecutive_http_401       — strict-401 streak (secret mismatch signature)
--   * consecutive_5xx_or_timeout — worker/platform outage streak
--   * due_pending_failed_orders / due_without_success_since /
--     oldest_due_at / oldest_due_without_success_at — stuck-queue signals
--   * overall_state              — deterministic roll-up (rules below)
--
-- IMPORTANT SEMANTICS: an observed HTTP 2xx proves the WORKER INVOCATION
-- completed successfully. It does NOT by itself prove that every due order
-- synced successfully — per-order outcomes remain authoritative in
-- public.orders (lazywait_sync_state and related columns) and
-- public.integration_sync_logs. The due_* fields bridge the two: they surface
-- orders the worker should be draining.
--
-- OVERALL_STATE — deterministic, first-match-wins cascade with fixed
-- thresholds chosen for the one-minute cron:
--   TICK_STALE    = 3 minutes  (3 missed ticks; also treats a never-ticked
--                               ledger as not-recent — conservative: a freshly
--                               applied migration reads 'degraded' for up to
--                               one tick rather than reporting green unproven)
--   SUCCESS_STALE = 5 minutes  (only consulted while due orders exist)
--
--   configuration_error : the latest AUTHORITATIVE (terminal, i.e. not
--                         starting/pending) scheduler result is
--                         preflight_failed or driver_error.
--   failing             : cron missing/inactive; OR consecutive_http_401 >= 2;
--                         OR consecutive_5xx_or_timeout >= 3; OR due orders
--                         with no success since due exist while NO successful
--                         invocation has ever been observed.
--   degraded            : any current failure streak (one 401, or one/two
--                         5xx/timeouts, or the latest observed response is any
--                         non-2xx); OR the latest terminal result is
--                         expired_unknown (a queued request never produced a
--                         response that could be durably reconciled within the
--                         15-minute window — an operational problem that must
--                         never read healthy or idle); OR
--                         due_without_success_since > 0; OR due orders exist
--                         while the latest success is stale (> SUCCESS_STALE);
--                         OR the latest tick is stale (> TICK_STALE) / no tick
--                         recorded.
--   idle                : cron active, tick recent, no failure streak, and no
--                         observed HTTP response yet (scheduler armed, nothing
--                         observed, nothing stuck — reachable only with no
--                         stuck due orders, since any due-order staleness
--                         routes to degraded/failing above).
--   healthy             : cron active, tick recent, latest observed response
--                         is 2xx, no failure streak, and no due order is
--                         waiting without a successful invocation since it
--                         became due.
--
-- SCOPE NOTES (verified before authoring):
--   * The trigger secret is ALREADY single-sourced: invoke_lazywait_sync_processor
--     reads integration_settings.secret_config.sync_trigger_secret live per tick
--     and Vault stores only the NON-secret project URL. No secret change is made
--     or needed here, and this function never reads or exposes secret_config.
--   * Per-tick HTTP-outcome detection ALREADY exists (the ledger is reconciled
--     from net._http_response). This adds the missing AGGREGATE view of it.
--   * No change to invoke_lazywait_sync_processor, the cron schedule/frequency,
--     the lazywait-sync worker, payment, order intake, payload mapping, POS
--     logic, Vault, or integration settings. Read-only over cron.job.
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
  c_tick_stale    constant interval := interval '3 minutes';
  c_success_stale constant interval := interval '5 minutes';

  v_cron_active            boolean := false;
  v_latest_run             jsonb;
  v_latest_tick_at         timestamptz;
  v_latest_response        jsonb;
  v_latest_response_outcome text;
  v_latest_terminal        text;
  v_latest_success         jsonb;
  v_latest_success_started timestamptz;
  v_latest_success_at      timestamptz;
  v_latest_failure         jsonb;
  v_consec_401             integer := 0;
  v_consec_5xx_timeout     integer := 0;
  v_due_total              integer := 0;
  v_due_no_success         integer := 0;
  v_oldest_due_at          timestamptz;
  v_oldest_due_no_success  timestamptz;
  v_tick_recent            boolean;
  v_success_recent         boolean;
  v_state                  text;
begin
  -- Cron registration state (read-only; single job by the no-second-scheduler
  -- guard in 20260720120000). false when the job is missing or inactive; also
  -- false if the cron schema/table is unavailable in a stripped environment.
  begin
    select coalesce(bool_and(active), false) into v_cron_active
      from cron.job where jobname = 'lazywait-sync'
    having count(*) > 0;
    v_cron_active := coalesce(v_cron_active, false);
  exception when undefined_table or insufficient_privilege then
    v_cron_active := false;
  end;

  -- Latest scheduler run of any kind (covers "latest request ID" and the
  -- latest durable cron tick; http_status is null until reconciled).
  select started_at,
         jsonb_build_object(
           'run_id', id, 'request_id', request_id, 'started_at', started_at,
           'outcome', outcome, 'http_status', http_status)
    into v_latest_tick_at, v_latest_run
    from public.lazywait_sync_requests
   order by started_at desc, id desc
   limit 1;

  -- Latest AUTHORITATIVE (terminal) scheduler result — an in-flight
  -- starting/pending row never masks a persisted preflight/driver failure.
  select outcome into v_latest_terminal
    from public.lazywait_sync_requests
   where outcome not in ('starting', 'pending')
   order by coalesce(completed_at, started_at) desc, id desc
   limit 1;

  -- Latest OBSERVED transport outcome (covers "latest HTTP status"): a row the
  -- reconciler stamped from net._http_response — an HTTP status, a timeout, or
  -- a transport error. starting/pending/expired_unknown/preflight/driver rows
  -- carry no observed response and are excluded.
  select jsonb_build_object(
           'request_id', request_id, 'http_status', http_status,
           'timed_out', timed_out, 'responded_at', responded_at,
           'outcome', outcome),
         outcome
    into v_latest_response, v_latest_response_outcome
    from public.lazywait_sync_requests
   where outcome in ('success_2xx','auth_failed','rate_limited',
                     'client_error_4xx','server_error_5xx','timeout','transport_error')
   order by coalesce(responded_at, completed_at, started_at) desc, id desc
   limit 1;

  -- Latest successful worker invocation (observed HTTP 2xx only — the ledger
  -- never marks success from queueing alone). NOTE: proves the INVOCATION
  -- succeeded, not that every due order synced (see header).
  select started_at,
         coalesce(responded_at, completed_at, started_at),
         jsonb_build_object(
           'request_id', request_id, 'started_at', started_at,
           'responded_at', responded_at, 'http_status', http_status)
    into v_latest_success_started, v_latest_success_at, v_latest_success
    from public.lazywait_sync_requests
   where outcome = 'success_2xx'
   order by started_at desc, id desc
   limit 1;

  -- Latest failure of any kind: observed HTTP failure, timeout, transport
  -- error, preflight_failed (config incomplete), driver_error, or
  -- expired_unknown (queued but never durably reconciled — surfaced here with
  -- its request_id, timestamp and a null HTTP status so operators can see it,
  -- while latest_response stays restricted to actually OBSERVED responses).
  select jsonb_build_object(
           'request_id', request_id,
           'at', coalesce(completed_at, started_at),
           'outcome', outcome, 'error_code', error_code,
           'http_status', http_status)
    into v_latest_failure
    from public.lazywait_sync_requests
   where outcome in ('auth_failed','rate_limited','client_error_4xx',
                     'server_error_5xx','timeout','transport_error',
                     'preflight_failed','driver_error','expired_unknown')
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
  -- Per-order sync outcomes remain in orders/integration_sync_logs.
  select count(*),
         count(*) filter (where v_latest_success_started is null
                             or coalesce(sync_next_attempt_at, updated_at) > v_latest_success_started),
         min(coalesce(sync_next_attempt_at, updated_at)),
         min(coalesce(sync_next_attempt_at, updated_at))
           filter (where v_latest_success_started is null
                      or coalesce(sync_next_attempt_at, updated_at) > v_latest_success_started)
    into v_due_total, v_due_no_success, v_oldest_due_at, v_oldest_due_no_success
    from public.orders
   where lazywait_sync_state in ('pending','failed')
     and (sync_next_attempt_at is null or sync_next_attempt_at <= now());

  -- Deterministic overall_state (rules + thresholds documented in the header).
  v_tick_recent    := v_latest_tick_at    is not null and now() - v_latest_tick_at    <= c_tick_stale;
  v_success_recent := v_latest_success_at is not null and now() - v_latest_success_at <= c_success_stale;

  v_state := case
    when v_latest_terminal in ('preflight_failed', 'driver_error')
      then 'configuration_error'
    when (not v_cron_active)
      or v_consec_401 >= 2
      or v_consec_5xx_timeout >= 3
      or (v_due_no_success > 0 and v_latest_success_at is null)
      then 'failing'
    when v_consec_401 >= 1
      or v_consec_5xx_timeout >= 1
      or (v_latest_response_outcome is not null and v_latest_response_outcome <> 'success_2xx')
      -- expired_unknown as the latest AUTHORITATIVE result: the last queued
      -- request never produced a durably reconcilable response — never report
      -- healthy or idle on top of it. It is NOT an observed HTTP response, so
      -- it deliberately does not enter latest_response or either streak.
      or v_latest_terminal = 'expired_unknown'
      or v_due_no_success > 0
      or (v_due_total > 0 and not v_success_recent)
      or not v_tick_recent
      then 'degraded'
    when v_latest_response_outcome is null
      then 'idle'
    else 'healthy'
  end;

  return jsonb_build_object(
    'generated_at',                 now(),
    'overall_state',                v_state,
    'cron_active',                  v_cron_active,
    'latest_cron_tick_at',          v_latest_tick_at,
    'latest_run',                   v_latest_run,
    'latest_response',              v_latest_response,
    'latest_success',               v_latest_success,
    'latest_success_age_seconds',   case when v_latest_success_at is null then null
                                         else floor(extract(epoch from (now() - v_latest_success_at)))::bigint end,
    'latest_failure',               v_latest_failure,
    'consecutive_http_401',         v_consec_401,
    'consecutive_5xx_or_timeout',   v_consec_5xx_timeout,
    'due_pending_failed_orders',    v_due_total,
    'due_without_success_since',    v_due_no_success,
    'oldest_due_at',                v_oldest_due_at,
    'oldest_due_without_success_at', v_oldest_due_no_success
  );
end $$;

revoke all on function public.lazywait_sync_health_summary() from public, anon, authenticated;
grant execute on function public.lazywait_sync_health_summary() to service_role;

comment on function public.lazywait_sync_health_summary() is
  'Service-role-only aggregate health for the lazywait-sync pg_cron driver, read from the durable lazywait_sync_requests ledger + cron.job + orders sync state: overall_state (healthy/degraded/failing/idle/configuration_error via the documented deterministic cascade; tick stale >3m, success stale >5m with due orders), cron_active, latest tick/run/request id, latest observed HTTP status, latest 2xx success + age, latest failure (incl. expired_unknown, which always degrades and never reads healthy/idle), consecutive observed 401s (secret mismatch signature), consecutive 5xx/timeouts, and due pending/failed orders (incl. those with no successful worker invocation since due). An HTTP 2xx proves the worker invocation completed, not that every due order synced — per-order outcomes stay in orders/integration_sync_logs. Exposes no secret, header, response body, or customer data. Observability only — no scheduler/worker/payment/POS behavior change.';
