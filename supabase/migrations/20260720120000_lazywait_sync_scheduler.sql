-- ============================================================================
-- Lazywait POS sync scheduler (pg_cron driver)
--
-- Adds the MISSING recurring driver for the lazywait-sync worker. Until now the
-- worker was invoked only opportunistically: synchronously by order-intake at
-- checkout, and once by paymentSync after a verified online payment flips an
-- order to 'pending'. There was NO time-based driver, so retry/backoff,
-- dead-letter promotion and the stale-'syncing' reaper only advanced when the
-- NEXT order happened to trigger a run (or an admin pressed Retry). During a
-- quiet period — or for the last order of a session — a 'failed' or stale
-- 'syncing' row could sit un-advanced indefinitely. This job closes that gap.
--
-- SCOPE — pure infrastructure. This migration does NOT change payment
-- verification, order intake, the Lazywait Create Order payload mapping,
-- delivery behaviour, or any POS logic. The worker
-- (supabase/functions/lazywait-sync) and every RPC it uses
-- (claim_lazywait_sync_batch, record_lazywait_sync, reap_stale_lazywait_syncs)
-- are UNCHANGED. This migration only invokes the existing worker on a fixed
-- cadence. All safety properties stay where they already live, in the worker:
--   * idempotency / no duplicate send  — shouldResendCreateOrder never re-POSTs
--     an order that already carries a lazywait_ref.
--   * duplicate concurrent processing  — claim_lazywait_sync_batch claims with
--     FOR UPDATE SKIP LOCKED and flips rows to 'syncing'.
--   * retry / backoff / dead-letter    — record_lazywait_sync + computeBackoffMs.
--   * stale-claim recovery             — reap_stale_lazywait_syncs (10-min lease).
--
-- SECRET HANDLING — single source of truth. A SECURITY DEFINER function reads
-- the worker's shared trigger secret LIVE from the authoritative
-- integration_settings row (provider_type = 'lazywait') at execution time and
-- passes it VERBATIM in the x-sync-secret request header. The stored value is
-- used EXACTLY as stored — btrim() is used ONLY to decide whether it is
-- blank/unconfigured, never to transform what is sent — because the worker
-- compares the header against secret_config.sync_trigger_secret byte-for-byte.
-- Rotating it in the Admin UI takes effect on the next tick with NO migration,
-- NO Vault change and NO redeploy. The secret is NEVER copied into Vault, stored
-- in cron.job, placed in an Edge Function env var, exposed by the request ledger
-- or the health view, or logged. lazywait-sync is verify_jwt=false and gated
-- solely by that header, so the caller needs no JWT and no service-role key;
-- cron.job stores only the bare function call.
--
-- OBSERVABILITY — the request ledger (lazywait_sync_requests) records the pg_net
-- request id of each queued tick; the health view (lazywait_sync_cron_health)
-- joins that ledger to the real pg_net response so operators can see the ACTUAL
-- HTTP outcome per tick — pending, HTTP 2xx success, 401/403 auth failure, 429,
-- 5xx, timeout, or transport error — NOT merely that the cron command queued a
-- request. Both are service-role-only and expose no secret, headers, response
-- body, or customer/order data. The ledger is bounded by a 14-day retention
-- prune (business audit / integration_sync_logs are never touched).
--
-- VAULT ENTRY REQUIRED (operational; created separately under the owner-approved
-- apply workflow — NOT in this migration). Only the NON-secret project URL:
--   * lazywait_sync_project_url = https://<project-ref>.supabase.co
-- The trigger secret is NOT in Vault; it lives only in integration_settings.
--
-- FAIL CLOSED — before any HTTP request, the driver raises (and sends nothing)
-- when: the lazywait integration_settings row is missing; more than one such row
-- exists; secret_config is null; sync_trigger_secret is null/empty/blank; or the
-- lazywait_sync_project_url Vault entry is missing.
--
-- ROLLBACK / DISABLE (safe, immediate — never affects order intake or payments):
--   select cron.unschedule('lazywait-sync');
--   drop view     if exists public.lazywait_sync_cron_health;
--   drop function if exists public.invoke_lazywait_sync_processor();
--   drop table    if exists public.lazywait_sync_requests;
--
-- SELF-VERIFYING: refuses to apply if a 'lazywait-sync' cron job already exists.
-- ============================================================================

-- pg_net (async HTTP) + pg_cron (scheduler). Both already required by the
-- account-deletion scheduler; `if not exists` keeps this idempotent.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Guard: never create a SECOND lazywait-sync driver.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lazywait-sync') then
    raise exception
      'a cron job named "lazywait-sync" already exists (jobid %); verify/remove it before enabling this driver',
      (select jobid from cron.job where jobname = 'lazywait-sync' limit 1);
  end if;
end $$;

-- ---- Request ledger: correlates each queued tick with its pg_net response. ---
-- Holds ONLY the pg_net request id + when it was queued. No secret, no headers,
-- no customer/order data. Service-role-only; RLS enabled; growth bounded by the
-- 14-day prune inside the driver.
create table if not exists public.lazywait_sync_requests (
  request_id bigint primary key,
  queued_at  timestamptz not null default now()
);
create index if not exists lazywait_sync_requests_queued_at_idx
  on public.lazywait_sync_requests (queued_at);

alter table public.lazywait_sync_requests enable row level security;
revoke all on public.lazywait_sync_requests from public, anon, authenticated;
grant select on public.lazywait_sync_requests to service_role;

comment on table public.lazywait_sync_requests is
  'One row per lazywait-sync cron tick: the pg_net request id + queued_at, used to correlate the tick with its actual HTTP response in lazywait_sync_cron_health. Contains no secret or customer data; pruned after 14 days.';

-- ---- The driver. SECURITY DEFINER; service-role-only EXECUTE. ----------------
create or replace function public.invoke_lazywait_sync_processor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $$
declare
  v_row_count      integer;
  v_secret_config  jsonb;
  v_trigger_secret text;
  v_project_url    text;
  v_request_id     bigint;
begin
  -- Trigger secret: read LIVE from the authoritative integration row. Canonical
  -- key = provider_type ('lazywait'), which is UNIQUE. Assert exactly one row
  -- (defence in depth) and fail closed otherwise.
  select count(*)
    into v_row_count
    from public.integration_settings
   where provider_type = 'lazywait';
  if v_row_count = 0 then
    raise exception 'lazywait integration_settings row is missing';
  elsif v_row_count > 1 then
    raise exception 'multiple lazywait integration_settings rows found (expected exactly one)';
  end if;

  select secret_config
    into v_secret_config
    from public.integration_settings
   where provider_type = 'lazywait';
  if v_secret_config is null then
    raise exception 'lazywait secret_config is null';
  end if;

  -- Load the RAW stored secret. btrim() is used ONLY to reject a blank/empty
  -- value; the value SENT is v_trigger_secret unchanged (the worker compares it
  -- byte-for-byte, so trimming here would break a secret with surrounding
  -- whitespace).
  v_trigger_secret := v_secret_config ->> 'sync_trigger_secret';
  if v_trigger_secret is null or btrim(v_trigger_secret) = '' then
    raise exception 'lazywait sync_trigger_secret is not configured';
  end if;

  -- Project URL: NON-secret, from Vault.
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'lazywait_sync_project_url';
  if v_project_url is null then
    raise exception 'lazywait_sync_project_url Vault entry is missing';
  end if;

  -- Fire-and-forget async POST (bounded batch). The worker does the real work
  -- and returns its own summary; pg_net stores the HTTP response in
  -- net._http_response keyed by this request id.
  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/lazywait-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_trigger_secret
    ),
    body := jsonb_build_object('limit', 5),
    timeout_milliseconds := 10000
  ) into v_request_id;

  -- Record the request id so the health view can correlate the ACTUAL response.
  if v_request_id is not null then
    insert into public.lazywait_sync_requests (request_id)
    values (v_request_id)
    on conflict (request_id) do nothing;
  end if;

  -- Conservative retention: keep ~14 days of correlation rows. Never touches
  -- integration_sync_logs or any business/audit record.
  delete from public.lazywait_sync_requests
   where queued_at < now() - interval '14 days';

  return v_request_id;
end;
$$;

revoke all on function public.invoke_lazywait_sync_processor()
  from public, anon, authenticated;
grant execute on function public.invoke_lazywait_sync_processor()
  to service_role;

comment on function public.invoke_lazywait_sync_processor() is
  'Vault-URL + live-secret pg_cron driver for the lazywait-sync worker. Reads sync_trigger_secret at run time from the authoritative integration_settings row (provider_type=lazywait) and sends it VERBATIM in x-sync-secret; reads the non-secret project URL from Vault (lazywait_sync_project_url); POSTs {"limit":5} to /functions/v1/lazywait-sync; records the pg_net request id in lazywait_sync_requests and prunes rows older than 14 days. The secret is never stored in cron.job, Vault, Edge env, the ledger, the health view, or logs. No change to payment, order-intake, Create Order payload mapping, delivery, or POS logic.';

-- ---- Health view: ACTUAL per-tick HTTP outcome (not just cron status). -------
-- Joins the request ledger to the real pg_net response. Exposes only safe
-- operational fields: request id, queued/response times, completion state, HTTP
-- status, timed_out, a truncated transport-error string, a 2xx success boolean
-- and a coarse outcome label. NEVER exposes the secret, request headers, the
-- response body, or customer/order data. Service-role-only.
create or replace view public.lazywait_sync_cron_health as
  select
    led.request_id,
    led.queued_at,
    r.created                                    as responded_at,
    (r.id is not null)                           as completed,
    case when r.id is null then null
         else (r.status_code between 200 and 299) end as success,
    r.status_code                                as http_status,
    coalesce(r.timed_out, false)                 as timed_out,
    case
      when r.id is null                       then 'pending'
      when coalesce(r.timed_out, false)       then 'timeout'
      when r.status_code is null              then 'transport_error'
      when r.status_code between 200 and 299  then 'success_2xx'
      when r.status_code in (401, 403)        then 'auth_failed'
      when r.status_code = 429                then 'rate_limited'
      when r.status_code >= 500               then 'server_error_5xx'
      when r.status_code >= 400               then 'client_error_4xx'
      else 'other'
    end                                          as outcome,
    left(r.error_msg, 200)                       as error_message
  from public.lazywait_sync_requests led
  left join net._http_response r on r.id = led.request_id;

revoke all on public.lazywait_sync_cron_health from public, anon, authenticated;
grant select on public.lazywait_sync_cron_health to service_role;

comment on view public.lazywait_sync_cron_health is
  'Per-tick lazywait-sync HTTP outcome: joins lazywait_sync_requests to the pg_net response (net._http_response). Distinguishes pending / success_2xx / auth_failed (401,403) / rate_limited (429) / server_error_5xx / client_error_4xx / timeout / transport_error. Exposes no secret, headers, response body, or customer data.';

-- Schedule: every minute. cron.job stores ONLY the bare function call.
select cron.schedule(
  'lazywait-sync',
  '* * * * *',
  'select public.invoke_lazywait_sync_processor();'
);
