-- ============================================================================
-- Spicy Meal — pg_cron driver for the automatic refund worker (payment-refund),
-- plus stale-lease escalation.
--
-- THE GAP THIS CLOSES
-- 20260724120000 created the automatic-refund lifecycle: the order_refund_due()
-- predicate, the enrollment triggers, the public.order_refunds ledger and the
-- claim/finalize RPCs. It deliberately scheduled NOTHING. The consumer
-- (supabase/functions/payment-refund) therefore had no time-based driver, so an
-- enrolled refund would remain at status='pending' indefinitely while
-- customer_order_state() showed the customer 'final_failure_refund_pending'
-- ("refund in progress") — a promise the system could not keep.
--
-- This migration adds ONLY the driver, the stale-lease reaper, and the schedule.
-- It changes no refund decision, no enrollment rule, no payment business logic,
-- no Tap contract and no existing RPC. Whether a refund is owed remains decided
-- exclusively in Postgres by order_refund_due(); this driver just makes the
-- queue drain, and makes an abandoned lease visible instead of invisible.
--
-- ---------------------------------------------------------------------------
-- STALE LEASES — WHY THEY ESCALATE TO A HUMAN AND ARE NEVER AUTO-RETRIED
--
-- claim_order_refund() moves a row to 'processing' and stamps a claim_token;
-- finalize_order_refund() is token-fenced and resolves it. If the worker
-- terminates BETWEEN those two steps — an abnormal exit, a container kill, or a
-- finalize RPC error (which the worker does not currently inspect) — the row
-- stays 'processing' forever: claim_order_refund() selects only
-- status = 'pending', so no later tick can ever see it again. The order would
-- remain refund_state='processing' and the customer would be shown "refund in
-- progress" indefinitely.
--
-- The tempting fix is to return the row to 'pending' after a lease timeout. That
-- is NOT safe here. We cannot distinguish "died before calling Tap" from "died
-- after Tap accepted the refund but before we recorded it", and Tap's
-- reference.merchant is a reconciliation aid, NOT a guaranteed idempotency key —
-- 20260724120000 states plainly that our own DB claim is what prevents a double
-- refund. Re-queueing could therefore refund a customer twice.
--
-- So a stale lease is resolved to status='failed' with failure_code
-- 'lease_expired', which:
--   * frees the one-active-refund slot (the partial unique index excludes
--     'failed'), so an operator CAN deliberately open a fresh attempt after
--     verifying with the provider;
--   * surfaces the refund in list_failed_order_refunds() — the existing
--     admin manual-review feed;
--   * moves the customer from a permanent "refund in progress" to
--     'final_failure_refund_failed', which is the honest state.
-- 'processing' -> 'failed' is an allowed transition in
-- enforce_refund_state_transition(), so no guard is weakened.
--
-- The window is 30 minutes: far beyond any healthy run (the worker is bounded to
-- 5 refunds x 15s = 75s, and this driver's HTTP timeout is 100s), so a live
-- in-flight refund can never be escalated out from under a working worker.
--
-- Note this is only reachable on ABNORMAL termination. The worker's own
-- timeout/unknown path already finalizes as 'pending', which RELEASES the claim
-- properly and is retried on the next tick — that path is unchanged.
-- ---------------------------------------------------------------------------
--
-- WHY NO NEW RUN LEDGER (unlike 20260720120000)
-- The lazywait scheduler needed lazywait_sync_requests because nothing else
-- recorded a per-tick outcome. Refunds already have a durable per-REFUND record:
-- public.order_refunds carries status, attempt_count, failure_code,
-- last_error_safe, completed_at and provider_ref, and the worker additionally
-- writes an operational row to integration_sync_logs per processed refund. A
-- second ledger would duplicate that without adding a fact.
--
-- SECRET HANDLING — identical contract to the lazywait driver. The
-- refund_trigger_secret is read LIVE from the authoritative integration_settings
-- row (provider_type='payment') and passed byte-for-byte in the x-refund-secret
-- header (the worker compares it with a constant-time comparison). btrim() is
-- used ONLY to reject a null/empty/blank value, never to transform what is sent.
-- Rotating the secret takes effect on the next tick with no migration and no
-- redeploy. The secret is NEVER copied into cron.job, Vault, logs or any table.
--
-- Only the NON-secret project URL comes from Vault. It reuses the existing
-- `lazywait_sync_project_url` secret rather than requiring the owner to create a
-- new one: it is the same project origin, and duplicating it would create two
-- values that could silently diverge.
--
-- FAIL CLOSED — no HTTP request is made with incomplete configuration: a
-- missing/duplicate payment integration row, a disabled provider, a non-Tap
-- provider, a null/blank trigger secret, or a missing project URL all return
-- NULL without invoking the worker. The worker itself fails closed a second time
-- (it re-checks provider + secret and returns 503/401 rather than running
-- unauthenticated), so money can never move on a misconfigured tick.
--
-- CADENCE — every 5 minutes. A refund is not latency-critical (it follows a
-- terminal POS failure and three exhausted customer resends), and the worker is
-- bounded to MAX_PER_RUN = 5 refunds per invocation, so this cannot fan out
-- against Tap. Each refund is additionally protected by FOR UPDATE SKIP LOCKED
-- claiming, a token-fenced finalize, a deterministic idempotency key and a
-- partial unique index allowing at most one live-or-succeeded refund per order —
-- so overlapping ticks can never double-refund a customer.
--
-- OBSERVABILITY FOLLOW-UP (deliberately NOT in this migration)
-- operations_health_snapshot_internal() allowlists five cron jobs. Adding a
-- sixth means re-emitting that function, which is a separate reviewed change.
-- Until then, refund health is visible through public.order_refunds and
-- list_failed_order_refunds().
--
-- SELF-VERIFYING: refuses to apply if a 'payment-refund-worker' cron job already
-- exists, so a re-apply can never create a duplicate schedule.
--
-- ROLLBACK (safe, immediate — never affects payments, orders or the queue):
--   select cron.unschedule('payment-refund-worker');
--   drop function if exists public.invoke_payment_refund_processor();
--   drop function if exists public.expire_stale_order_refund_claims(interval);
-- Enrolled refunds simply stop draining; no refund state is lost or altered.
-- ============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'payment-refund-worker') then
    raise exception
      'a cron job named "payment-refund-worker" already exists (jobid %); verify/remove it before enabling this driver',
      (select jobid from cron.job where jobname = 'payment-refund-worker' limit 1);
  end if;
end $$;

-- ---- Stale-lease escalation (see the header for why this never auto-retries).
create or replace function public.expire_stale_order_refund_claims(
  p_stale_after interval default interval '30 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row   record;
begin
  -- Guard against an accidentally tiny window being passed in: never escalate a
  -- lease younger than 10 minutes, which is already >> any healthy run.
  if p_stale_after is null or p_stale_after < interval '10 minutes' then
    p_stale_after := interval '10 minutes';
  end if;

  for v_row in
    select id, order_id
      from public.order_refunds
     where status = 'processing'
       and updated_at < now() - p_stale_after
     order by updated_at
     for update skip locked
  loop
    update public.order_refunds
       set status          = 'failed',
           failure_code    = 'lease_expired',
           last_error_safe = 'The refund worker did not report an outcome. Verify with the provider before retrying.',
           claim_token     = null,
           updated_at      = now()
     where id = v_row.id
       and status = 'processing';          -- re-check under the lock

    if found then
      -- 'processing' -> 'failed' is an allowed transition; the guard is intact.
      update public.orders
         set refund_state        = 'failed',
             refund_failure_code = 'lease_expired',
             updated_at          = now()
       where id = v_row.order_id
         and refund_state = 'processing';

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_order_refund_claims(interval)
  from public, anon, authenticated;
grant execute on function public.expire_stale_order_refund_claims(interval)
  to service_role;

comment on function public.expire_stale_order_refund_claims(interval) is
  'Escalates refund leases abandoned by a crashed worker (status=processing, untouched for longer than the window) to status=failed / failure_code=lease_expired, so they appear in list_failed_order_refunds() instead of being unreachable forever. Deliberately does NOT re-queue: we cannot know whether the dead worker already sent the refund to Tap, and an automatic re-send could double-refund. Minimum window 10 minutes.';

-- ---- The driver. SECURITY DEFINER; service-role-only EXECUTE. ---------------
create or replace function public.invoke_payment_refund_processor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $$
declare
  v_row_count      integer;
  v_enabled        boolean;
  v_provider       text;
  v_secret_config  jsonb;
  v_trigger_secret text;
  v_project_url    text;
  v_request_id     bigint;
begin
  -- Reclaim first, so an abandoned lease is escalated even on ticks that later
  -- fail preflight. Best effort: a reaper hiccup must never abort the tick.
  begin
    perform public.expire_stale_order_refund_claims();
  exception when others then
    null;
  end;

  -- ---- Preflight, fail closed. Every branch returns NULL without sending. ----
  select count(*) into v_row_count
    from public.integration_settings where provider_type = 'payment';
  if v_row_count <> 1 then
    return null;                                    -- missing or duplicate row
  end if;

  select enabled, provider_name, secret_config
    into v_enabled, v_provider, v_secret_config
    from public.integration_settings where provider_type = 'payment';

  if not coalesce(v_enabled, false) then
    return null;                                    -- provider disabled
  end if;
  if lower(coalesce(v_provider, '')) <> 'tap' then
    return null;                                    -- not the Tap provider
  end if;

  -- RAW value: btrim only decides blankness; the value SENT is unchanged.
  v_trigger_secret := v_secret_config ->> 'refund_trigger_secret';
  if v_secret_config is null
     or v_trigger_secret is null
     or btrim(v_trigger_secret) = '' then
    return null;                                    -- no trigger secret
  end if;

  select decrypted_secret into v_project_url
    from vault.decrypted_secrets where name = 'lazywait_sync_project_url';
  if v_project_url is null then
    return null;                                    -- no project URL
  end if;

  -- ---- Send. Secret passed VERBATIM. Bounded batch. Fire-and-forget. --------
  -- Timeout 100s: worst case is 5 refunds x 15s provider timeout = 75s plus
  -- claim/finalize overhead, and it stays below Supabase's 150s idle timeout.
  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/payment-refund',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-refund-secret', v_trigger_secret),
    body := jsonb_build_object('limit', 5),
    timeout_milliseconds := 100000
  ) into v_request_id;

  return v_request_id;

exception when others then
  -- An unexpected internal error must not raise out of a cron tick (that would
  -- only produce a failed job row with no added information). The per-refund
  -- state is authoritative and untouched: nothing was claimed or finalized by a
  -- driver that failed before sending.
  return null;
end;
$$;

revoke all on function public.invoke_payment_refund_processor()
  from public, anon, authenticated;
grant execute on function public.invoke_payment_refund_processor()
  to service_role;

comment on function public.invoke_payment_refund_processor() is
  'pg_cron driver for the payment-refund worker. Escalates abandoned leases via expire_stale_order_refund_claims(), then runs a fail-closed preflight (single enabled Tap integration row, non-blank refund_trigger_secret, project URL in Vault) and POSTs {"limit":5} with the secret sent VERBATIM in x-refund-secret. Never decides that a refund is owed — enrollment is order_refund_due() in Postgres. The secret is never stored in cron.job, Vault, logs or any table.';

-- Schedule: every 5 minutes. cron.job stores ONLY the bare function call, so the
-- secret never appears in the scheduler catalog.
select cron.schedule(
  'payment-refund-worker',
  '*/5 * * * *',
  'select public.invoke_payment_refund_processor();'
);

-- Post-schedule self-verification: fail the migration if the job was not created
-- exactly once with the intended schedule and command, or if the reaper is
-- missing/incorrectly granted.
do $$
declare
  v_count integer;
  v_job   record;
begin
  select count(*) into v_count from cron.job where jobname = 'payment-refund-worker';
  if v_count <> 1 then
    raise exception 'expected exactly one "payment-refund-worker" cron job, found %', v_count;
  end if;

  select schedule, active, btrim(command) as command into v_job
    from cron.job where jobname = 'payment-refund-worker';

  if v_job.schedule is distinct from '*/5 * * * *' then
    raise exception 'payment-refund-worker scheduled with unexpected schedule %', v_job.schedule;
  end if;
  if not coalesce(v_job.active, false) then
    raise exception 'payment-refund-worker was created inactive';
  end if;
  if v_job.command is distinct from 'select public.invoke_payment_refund_processor();' then
    raise exception 'payment-refund-worker created with an unexpected command';
  end if;

  if to_regprocedure('public.expire_stale_order_refund_claims(interval)') is null then
    raise exception 'expire_stale_order_refund_claims(interval) is missing';
  end if;
  if has_function_privilege('authenticated', 'public.expire_stale_order_refund_claims(interval)', 'execute')
     or has_function_privilege('anon', 'public.expire_stale_order_refund_claims(interval)', 'execute') then
    raise exception 'expire_stale_order_refund_claims must be service-role only';
  end if;
end $$;