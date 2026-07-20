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
--     an order that already carries a lazywait_ref (Create Order has no
--     idempotency key).
--   * duplicate concurrent processing  — claim_lazywait_sync_batch claims with
--     FOR UPDATE SKIP LOCKED and flips rows to 'syncing', so two overlapping
--     runs can never process the same order.
--   * retry / backoff / dead-letter    — record_lazywait_sync + computeBackoffMs
--     (30s,60s,120s… capped 1h; dead_letter at MAX_SYNC_ATTEMPTS=8).
--   * stale-claim recovery             — reap_stale_lazywait_syncs runs at the
--     start of every worker invocation (10-min lease).
--
-- SECRET HANDLING — mirrors the account-deletion scheduler exactly. A SECURITY
-- DEFINER function reads the project URL + the worker's shared trigger secret
-- from Supabase Vault at execution time and passes the secret ONLY in the
-- x-sync-secret request header. The secret is NEVER stored in cron.job, in an
-- Edge Function env var, or in logs. lazywait-sync is verify_jwt=false and gated
-- solely by that header (constant-time compare), so the caller needs no JWT and
-- no service-role key. cron.job stores only the bare function call.
--
-- VAULT ENTRIES REQUIRED (operational; created separately under the owner-
-- approved apply workflow — NOT in this migration, so no secret is committed):
--   * lazywait_sync_project_url    = https://<project-ref>.supabase.co
--   * lazywait_sync_trigger_secret = the SAME value as
--       integration_settings.secret_config ->> 'sync_trigger_secret'
-- COUPLING NOTE: the worker compares x-sync-secret against
-- integration_settings.secret_config.sync_trigger_secret. If that secret is ever
-- rotated (Admin UI), the Vault entry lazywait_sync_trigger_secret MUST be
-- updated to match, or the worker will answer 401 and sync will silently stop.
-- Until BOTH Vault entries exist the job no-ops safely (raises 'Vault
-- configuration is incomplete'; no HTTP request is made).
--
-- ROLLBACK / DISABLE (safe, immediate — never affects order intake or payments;
-- the worker simply stops being auto-invoked, exactly as before this migration):
--   select cron.unschedule('lazywait-sync');
--   drop view    if exists public.lazywait_sync_cron_health;
--   drop function if exists public.invoke_lazywait_sync_processor();
--
-- SELF-VERIFYING: refuses to apply if a 'lazywait-sync' cron job already exists,
-- so a pre-existing or external driver is reviewed before a second one is added.
-- ============================================================================

-- pg_net (async HTTP) + pg_cron (scheduler). Both are already required by the
-- account-deletion scheduler; `if not exists` keeps this idempotent.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Guard: never create a SECOND lazywait-sync driver. Abort the migration if a
-- job with this name already exists so it is reviewed/removed first.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lazywait-sync') then
    raise exception
      'a cron job named "lazywait-sync" already exists (jobid %); verify/remove it before enabling this driver',
      (select jobid from cron.job where jobname = 'lazywait-sync' limit 1);
  end if;
end $$;

-- The driver. SECURITY DEFINER so it can read Vault; service-role-only EXECUTE.
create or replace function public.invoke_lazywait_sync_processor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $$
declare
  v_project_url    text;
  v_trigger_secret text;
  v_request_id     bigint;
begin
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'lazywait_sync_project_url';

  select decrypted_secret
    into v_trigger_secret
    from vault.decrypted_secrets
   where name = 'lazywait_sync_trigger_secret';

  if v_project_url is null or v_trigger_secret is null then
    raise exception 'lazywait sync scheduler Vault configuration is incomplete';
  end if;

  -- Fire-and-forget async POST. The worker does the real work (claim → Create
  -- Order → record) and returns its own summary; pg_net stores the HTTP response
  -- in net._http_response keyed by this request id. A BOUNDED batch (limit:5)
  -- caps work per tick; overlapping ticks are safe (SKIP LOCKED claim).
  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/lazywait-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_trigger_secret
    ),
    body := jsonb_build_object('limit', 5),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_lazywait_sync_processor()
  from public, anon, authenticated;
grant execute on function public.invoke_lazywait_sync_processor()
  to service_role;

comment on function public.invoke_lazywait_sync_processor() is
  'Vault-backed pg_cron driver for the lazywait-sync worker. Reads lazywait_sync_project_url + lazywait_sync_trigger_secret from Supabase Vault at run time and POSTs {"limit":5} to /functions/v1/lazywait-sync with the x-sync-secret header. The secret is never stored in cron.job, Edge env, or logs. Adds no change to payment, order-intake, Create Order payload mapping, delivery, or POS logic.';

-- Read-only observability over the driver's OWN firing history: whether each
-- cron tick's command succeeded and the async request id it queued. (Sync
-- OUTCOMES — synced/failed/blocked/dead_letter/reaped — live in
-- integration_sync_logs and the orders sync columns, surfaced by the Admin
-- "Lazywait Sync Monitor".) service-role only.
create or replace view public.lazywait_sync_cron_health as
  select
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    d.runid,
    d.status         as run_status,
    d.return_message,
    d.start_time,
    d.end_time
  from cron.job j
  left join cron.job_run_details d on d.jobid = j.jobid
  where j.jobname = 'lazywait-sync';

revoke all on public.lazywait_sync_cron_health from public, anon, authenticated;
grant select on public.lazywait_sync_cron_health to service_role;

comment on view public.lazywait_sync_cron_health is
  'Recent lazywait-sync cron ticks (command status + queued pg_net request id). Sync outcomes live in integration_sync_logs / the orders sync columns.';

-- Schedule: every minute (pg_cron's finest granularity; satisfies the "every
-- 1-2 minutes" cadence and matches the account-deletion processor). cron.job
-- stores ONLY the bare function call — no secret, no URL.
select cron.schedule(
  'lazywait-sync',
  '* * * * *',
  'select public.invoke_lazywait_sync_processor();'
);
