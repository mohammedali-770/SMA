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
-- SECRET HANDLING — single source of truth. A SECURITY DEFINER function reads
-- the worker's shared trigger secret LIVE from the authoritative
-- integration_settings row (provider_type = 'lazywait') at execution time, and
-- passes it ONLY in the x-sync-secret request header. That is the exact same
-- secret the worker compares against (secret_config.sync_trigger_secret), so
-- rotating it in the Admin UI takes effect on the very next tick with NO
-- migration, NO Vault change and NO redeploy. The secret is NEVER copied into
-- Vault, stored in cron.job, placed in an Edge Function env var, exposed by the
-- observability view, or logged. lazywait-sync is verify_jwt=false and gated
-- solely by that header (constant-time compare), so the caller needs no JWT and
-- no service-role key; cron.job stores only the bare function call.
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

-- The driver. SECURITY DEFINER so it can read the (client-revoked)
-- integration_settings row and Vault; service-role-only EXECUTE.
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
  -- ---- Trigger secret: read LIVE from the authoritative integration row. -----
  -- Canonical key = provider_type ('lazywait'), which is UNIQUE. We still assert
  -- exactly one row (defence in depth) and fail closed otherwise. The secret is
  -- held only in a local variable and used solely as a request header below.
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

  v_trigger_secret := nullif(btrim(coalesce(v_secret_config ->> 'sync_trigger_secret', '')), '');
  if v_trigger_secret is null then
    raise exception 'lazywait sync_trigger_secret is not configured';
  end if;

  -- ---- Project URL: NON-secret, from Vault. ---------------------------------
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'lazywait_sync_project_url';
  if v_project_url is null then
    raise exception 'lazywait_sync_project_url Vault entry is missing';
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
  'Vault-URL + live-secret pg_cron driver for the lazywait-sync worker. Reads sync_trigger_secret at run time from the authoritative integration_settings row (provider_type=lazywait) — never from Vault — and the non-secret project URL from Vault (lazywait_sync_project_url), then POSTs {"limit":5} to /functions/v1/lazywait-sync with the x-sync-secret header. The secret is never stored in cron.job, Vault, Edge env, the health view, or logs; rotating it in the Admin UI needs no migration/redeploy. No change to payment, order-intake, Create Order payload mapping, delivery, or POS logic.';

-- Read-only observability over the driver's OWN firing history: whether each
-- cron tick's command succeeded and the async request id it queued. It carries
-- NO secret (only job metadata + run status/message/timing). Sync OUTCOMES —
-- synced/failed/blocked/dead_letter/reaped — live in integration_sync_logs and
-- the orders sync columns, surfaced by the Admin "Lazywait Sync Monitor".
-- service-role only.
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
  'Recent lazywait-sync cron ticks (command status + queued pg_net request id). Contains no secret. Sync outcomes live in integration_sync_logs / the orders sync columns.';

-- Schedule: every minute (pg_cron's finest granularity; satisfies the "every
-- 1-2 minutes" cadence and matches the account-deletion processor). cron.job
-- stores ONLY the bare function call — no secret, no URL.
select cron.schedule(
  'lazywait-sync',
  '* * * * *',
  'select public.invoke_lazywait_sync_processor();'
);
