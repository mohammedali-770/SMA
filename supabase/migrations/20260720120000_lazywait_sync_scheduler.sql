-- ============================================================================
-- Lazywait POS sync scheduler (pg_cron driver) + durable run ledger
--
-- Adds the MISSING recurring driver for the lazywait-sync worker. Until now the
-- worker was invoked only opportunistically: synchronously by order-intake at
-- checkout, and once by paymentSync after a verified online payment flips an
-- order to 'pending'. There was NO time-based driver, so retry/backoff,
-- dead-letter promotion and the stale-'syncing' reaper only advanced when the
-- NEXT order happened to trigger a run (or an admin pressed Retry). This job
-- closes that gap and records durable, safe operational observability.
--
-- SCOPE — pure infrastructure. This migration does NOT change payment
-- verification, order intake, the Lazywait Create Order payload mapping,
-- delivery behaviour, or any POS logic. The worker
-- (supabase/functions/lazywait-sync) and every RPC it uses are UNCHANGED. All
-- safety properties (idempotent no-resend, FOR UPDATE SKIP LOCKED claim,
-- retry/backoff/dead-letter, stale-claim reaper) stay in the worker.
--
-- SECRET HANDLING — single source of truth, sent VERBATIM. A SECURITY DEFINER
-- function reads sync_trigger_secret LIVE from the authoritative
-- integration_settings row (provider_type='lazywait') and passes it byte-for-
-- byte in the x-sync-secret header. btrim() is used ONLY to reject a
-- null/empty/blank value, never to transform what is sent (the worker compares
-- it exactly). Rotating it in the Admin UI takes effect on the next tick with NO
-- migration, NO Vault change and NO redeploy. Only the NON-secret project URL
-- lives in Vault (lazywait_sync_project_url). The secret is NEVER copied into
-- Vault, cron.job, Edge env, the ledger, the health view, or logs.
--
-- DURABLE OBSERVABILITY (lazywait_sync_requests + lazywait_sync_cron_health) —
--   * Every tick inserts a run row (outcome 'starting') BEFORE any validation,
--     so preflight/driver failures are always visible even though they make no
--     HTTP request.
--   * Transaction-safe failure persistence: the 'starting' INSERT is in the
--     OUTER block; preflight/send run in an inner handled sub-block. Expected
--     preflight failures UPDATE the run row to 'preflight_failed' and RETURN
--     (never re-raise — re-raising would roll the run row back and recreate the
--     observability gap). An unexpected internal exception is caught and the row
--     is updated to 'driver_error' (SQLSTATE only; raw SQLERRM is never stored,
--     so configuration cannot leak). It is EXPECTED that cron.job_run_details
--     reports the wrapper command as completed while the ledger authoritatively
--     records 'preflight_failed'/'driver_error' — the ledger, not cron status,
--     is the source of truth for tick health.
--   * FIX 1 — durable snapshot: at the start of each tick the driver reconciles
--     prior non-terminal rows by joining net._http_response on request_id and
--     SNAPSHOTS responded_at/completed_at/http_status/timed_out/outcome/
--     error_code into the ledger. Once snapshotted, a terminal outcome is
--     immutable and survives pg_net pruning the response row. The health view
--     reads ONLY the durable ledger — it never reclassifies a completed row as
--     'pending' because the pg_net response expired.
--   * A queued row shows 'pending' only within a conservative window; a row with
--     no observed response older than 15 minutes is reconciled to
--     'expired_unknown' (never fabricated as success/failure). 15 min is safely
--     longer than the 140s HTTP timeout (see net.http_post below — sized for the
--     worker's ~115s worst-case sequential batch) and far shorter than pg_net's
--     ~6h default response retention, so a real response is always snapshotted
--     first. The 15-min threshold is intentionally left well above the timeout.
--   * Reconciliation is idempotent: it only touches rows still in
--     ('starting','pending'), so terminal rows can never regress and overlapping
--     ticks cannot corrupt state. One request id maps to one run row (unique
--     partial index). Retention runs at the START of every tick (before any
--     preflight validation / early return, in the outer block) so ledger rows
--     older than 14 days are pruned by started_at on EVERY path —
--     preflight_failed, driver_error, pending and success alike — never leaving
--     the ledger to grow during prolonged configuration failures.
--     integration_sync_logs, orders, payment/business/audit records are NEVER
--     touched.
--   * success = TRUE only for observed HTTP 2xx; FALSE for observed failures and
--     preflight/driver failures; NULL for 'pending'/'starting'/'expired_unknown'
--     (final HTTP result unknown).
--
-- FAIL CLOSED — no HTTP request, no claim, no worker invocation occurs with
-- incomplete configuration (missing/duplicate row, null secret_config,
-- null/empty/blank secret, or missing project URL).
--
-- ROLLBACK / DISABLE (safe, immediate — never affects order intake or payments):
--   select cron.unschedule('lazywait-sync');
--   drop view     if exists public.lazywait_sync_cron_health;
--   drop function if exists public.invoke_lazywait_sync_processor();
--   drop table    if exists public.lazywait_sync_requests;
--
-- SELF-VERIFYING: refuses to apply if a 'lazywait-sync' cron job already exists.
-- ============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lazywait-sync') then
    raise exception
      'a cron job named "lazywait-sync" already exists (jobid %); verify/remove it before enabling this driver',
      (select jobid from cron.job where jobname = 'lazywait-sync' limit 1);
  end if;
end $$;

-- ---- Durable scheduler-run ledger. Safe operational fields only. -------------
create table if not exists public.lazywait_sync_requests (
  id                 bigint generated always as identity primary key,
  request_id         bigint,
  started_at         timestamptz not null default now(),
  queued_at          timestamptz,
  responded_at       timestamptz,
  completed_at       timestamptz,
  outcome            text not null default 'starting'
    check (outcome in (
      'starting','pending','success_2xx','auth_failed','rate_limited',
      'client_error_4xx','server_error_5xx','timeout','transport_error',
      'expired_unknown','preflight_failed','driver_error')),
  http_status        integer,
  timed_out          boolean not null default false,
  error_code         text,
  safe_error_message text
);
-- One pg_net request id maps to exactly one run row.
create unique index if not exists lazywait_sync_requests_request_id_key
  on public.lazywait_sync_requests (request_id) where request_id is not null;
-- Retention + reconciliation scans.
create index if not exists lazywait_sync_requests_started_at_idx
  on public.lazywait_sync_requests (started_at);
create index if not exists lazywait_sync_requests_open_idx
  on public.lazywait_sync_requests (outcome) where outcome in ('starting','pending');

alter table public.lazywait_sync_requests enable row level security;
revoke all on public.lazywait_sync_requests from public, anon, authenticated;
grant select on public.lazywait_sync_requests to service_role;

comment on table public.lazywait_sync_requests is
  'Durable per-tick scheduler run ledger for lazywait-sync: outcome + HTTP result snapshot (no secret, headers, response body, or customer/order data). Reconciled from net._http_response before pg_net retention; pruned after 14 days.';

-- ---- The driver. SECURITY DEFINER; service-role-only EXECUTE. ----------------
create or replace function public.invoke_lazywait_sync_processor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $$
declare
  v_run_id         bigint;
  v_row_count      integer;
  v_secret_config  jsonb;
  v_trigger_secret text;
  v_project_url    text;
  v_request_id     bigint;
begin
  -- FIX 2 (transaction-safe): persist the run row BEFORE any validation, in the
  -- OUTER block, so the inner handler's rollback-to-savepoint cannot erase it.
  insert into public.lazywait_sync_requests (outcome, started_at)
  values ('starting', now())
  returning id into v_run_id;

  -- Retention runs FIRST, in the OUTER block, so it executes on EVERY path
  -- (preflight_failed / driver_error / pending / success) — even prolonged
  -- configuration failures — and is never rolled back by the inner handler's
  -- savepoint. Idempotent + concurrency-safe: a plain indexed DELETE of rows
  -- older than 14 days by started_at. The just-inserted run row (started_at =
  -- now()) and anything newer are excluded, so the current run and recent rows
  -- are never deleted. Never touches integration_sync_logs, orders, payment
  -- records, or any business/audit record.
  delete from public.lazywait_sync_requests
   where started_at < now() - interval '14 days';

  begin
    -- FIX 1: reconcile prior non-terminal rows into a DURABLE snapshot. Best
    -- effort: a reconcile hiccup must never abort the tick.
    begin
      -- (a) snapshot rows that now have an OBSERVED pg_net response.
      update public.lazywait_sync_requests led
         set responded_at = r.created,
             completed_at = r.created,
             http_status  = r.status_code,
             timed_out    = coalesce(r.timed_out, false),
             safe_error_message = left(r.error_msg, 200),
             error_code = case
               when coalesce(r.timed_out, false)      then 'timeout'
               when r.status_code is null             then 'transport_error'
               when r.status_code between 200 and 299 then null
               else 'http_' || r.status_code::text
             end,
             outcome = case
               when coalesce(r.timed_out, false)      then 'timeout'
               when r.status_code is null             then 'transport_error'
               when r.status_code between 200 and 299 then 'success_2xx'
               when r.status_code in (401, 403)       then 'auth_failed'
               when r.status_code = 429               then 'rate_limited'
               when r.status_code >= 500              then 'server_error_5xx'
               when r.status_code >= 400              then 'client_error_4xx'
               else 'transport_error'
             end
        from net._http_response r
       where led.request_id = r.id
         and led.outcome in ('starting', 'pending');   -- terminal rows immutable

      -- (b) age out rows with no observed response beyond the conservative
      -- window (15 min >> the 140s HTTP timeout, << pg_net's ~6h response retention).
      update public.lazywait_sync_requests led
         set outcome = 'expired_unknown', completed_at = now()
       where led.outcome in ('starting', 'pending')
         and led.id <> v_run_id
         and led.started_at < now() - interval '15 minutes'
         and not exists (select 1 from net._http_response r where r.id = led.request_id);
    exception when others then
      null;  -- reconciliation is best-effort
    end;

    -- FIX 2 preflight: expected failures UPDATE the run row and RETURN (no
    -- re-raise). No HTTP request, no claim, no worker invocation.
    select count(*) into v_row_count
      from public.integration_settings where provider_type = 'lazywait';
    if v_row_count = 0 then
      update public.lazywait_sync_requests
         set outcome='preflight_failed', error_code='lazywait_integration_missing', completed_at=now()
       where id = v_run_id;
      return null;
    elsif v_row_count > 1 then
      update public.lazywait_sync_requests
         set outcome='preflight_failed', error_code='lazywait_integration_duplicate', completed_at=now()
       where id = v_run_id;
      return null;
    end if;

    select secret_config into v_secret_config
      from public.integration_settings where provider_type = 'lazywait';
    -- RAW value: btrim only decides blankness; the value SENT is unchanged.
    v_trigger_secret := v_secret_config ->> 'sync_trigger_secret';
    if v_secret_config is null or v_trigger_secret is null or btrim(v_trigger_secret) = '' then
      update public.lazywait_sync_requests
         set outcome='preflight_failed', error_code='sync_secret_missing', completed_at=now()
       where id = v_run_id;
      return null;
    end if;

    select decrypted_secret into v_project_url
      from vault.decrypted_secrets where name = 'lazywait_sync_project_url';
    if v_project_url is null then
      update public.lazywait_sync_requests
         set outcome='preflight_failed', error_code='project_url_missing', completed_at=now()
       where id = v_run_id;
      return null;
    end if;

    -- Send. Secret passed VERBATIM. Bounded batch. Async fire-and-forget.
    -- Timeout must cover the worker's worst-case SEQUENTIAL batch: up to 5 orders
    -- (claim_lazywait_sync_batch p_limit=5), each up to 8s CRM lookup
    -- (lazywaitFetch timeoutMs 8000) + 15s Create Order (timeoutMs 15000) = 23s,
    -- so ~115s, plus reaper/claim/record overhead. 140s safely covers that and
    -- stays below Supabase's 150s HTTP request idle timeout, while still
    -- surfacing a genuinely stalled request. The worker itself is UNCHANGED.
    select net.http_post(
      url := rtrim(v_project_url, '/') || '/functions/v1/lazywait-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_trigger_secret),
      body := jsonb_build_object('limit', 5),
      timeout_milliseconds := 140000
    ) into v_request_id;

    update public.lazywait_sync_requests
       set request_id = v_request_id, queued_at = now(), outcome = 'pending'
     where id = v_run_id;

    return v_request_id;

  exception when others then
    -- Unexpected internal error: record a DURABLE driver_error with only the
    -- SQLSTATE (never raw SQLERRM, which could disclose configuration). The
    -- 'starting' insert survives the savepoint rollback (it is in the outer block).
    update public.lazywait_sync_requests
       set outcome='driver_error', error_code = nullif(sqlstate, ''),
           safe_error_message = 'internal error', completed_at = now()
     where id = v_run_id;
    return null;
  end;
end;
$$;

revoke all on function public.invoke_lazywait_sync_processor()
  from public, anon, authenticated;
grant execute on function public.invoke_lazywait_sync_processor()
  to service_role;

comment on function public.invoke_lazywait_sync_processor() is
  'pg_cron driver for lazywait-sync. Inserts a durable run row before validation; reconciles prior ticks from net._http_response into an immutable snapshot; reads sync_trigger_secret live from integration_settings (provider_type=lazywait) and sends it VERBATIM in x-sync-secret; reads the non-secret project URL from Vault; POSTs {"limit":5}. Persists preflight_failed/driver_error without re-raising (no rollback). Secret never stored in cron.job/Vault/ledger/view/logs. No change to payment, order-intake, payload mapping, delivery, or POS logic.';

-- ---- Health view: reads ONLY the durable ledger (never net._http_response). --
create or replace view public.lazywait_sync_cron_health as
  select
    id           as run_id,
    request_id,
    started_at,
    queued_at,
    responded_at,
    completed_at,
    outcome,
    case
      when outcome = 'success_2xx'                              then true
      when outcome in ('starting', 'pending', 'expired_unknown') then null
      else false
    end          as success,
    http_status,
    timed_out,
    error_code,
    left(safe_error_message, 200) as error_message
  from public.lazywait_sync_requests;

revoke all on public.lazywait_sync_cron_health from public, anon, authenticated;
grant select on public.lazywait_sync_cron_health to service_role;

comment on view public.lazywait_sync_cron_health is
  'Durable per-tick lazywait-sync health from lazywait_sync_requests. outcome: starting/pending/success_2xx/auth_failed/rate_limited/client_error_4xx/server_error_5xx/timeout/transport_error/expired_unknown/preflight_failed/driver_error. success=true only for observed HTTP 2xx, false for observed/preflight/driver failures, null when unknown. Exposes no secret, headers, response body, or customer/order data.';

-- Schedule: every minute. cron.job stores ONLY the bare function call.
select cron.schedule(
  'lazywait-sync',
  '* * * * *',
  'select public.invoke_lazywait_sync_processor();'
);
