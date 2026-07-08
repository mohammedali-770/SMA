-- ============================================================================
-- Spicy Meal — Lazywait sync: stale-'syncing' reaper + safe recovery.
--
-- Problem: claim_lazywait_sync_batch flips a whole batch to 'syncing' up front,
-- then the worker processes orders one-by-one with multi-second network calls.
-- If the worker crashes / times out / is redeployed after claiming but before
-- calling record_lazywait_sync, the row stays 'syncing' forever — it is outside
-- the queue predicate ('pending','failed'), the admin requeue guard, and the UI
-- retry set, so nothing ever recovers it and the order silently never syncs.
--
-- Fix: a lease-timeout reaper the worker calls at the start of every run.
--   * Stale 'syncing' WITH a Lazywait ref  -> 'synced'  (the Create Order
--     already succeeded; NEVER re-POST — Create Order has no idempotency key).
--   * Stale 'syncing' WITHOUT a ref         -> 'failed'  (requeue with backoff)
--     or 'dead_letter' once attempts hit the max.
-- Every reaped row writes an integration_sync_logs row so Admin sees the
-- recovery. Also fixes requeue_lazywait_order to reset sync_attempt_count so an
-- admin "Retry" gets a full attempt budget instead of instantly dead-lettering.
--
-- Idempotent: create-or-replace + create index if not exists.
-- ============================================================================

-- ---- Partial index: cheaply find rows sitting in 'syncing' by claim age -----
-- (claim_lazywait_sync_batch sets updated_at = now() when it flips to 'syncing',
--  so updated_at is the lease start for a claimed row.)
create index if not exists orders_lazywait_syncing_idx
  on public.orders (updated_at)
  where lazywait_sync_state = 'syncing';

-- ---------------------------------------------------------------------------
-- reap_stale_lazywait_syncs(): recover orders stuck in 'syncing' past the lease
-- timeout. Service-role only (called by the lazywait-sync worker). Returns a
-- jsonb summary { recovered_synced, requeued, dead_lettered, timeout_minutes }.
--
-- Safety: the timeout (default 10 min) is comfortably longer than the worker's
-- per-order network budget (8s CRM + 15s Create Order), so an attempt that is
-- still legitimately in-flight is never reaped out from under itself.
-- ---------------------------------------------------------------------------
create or replace function public.reap_stale_lazywait_syncs(
  p_timeout_minutes integer default 10,
  p_max_attempts    integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer := greatest(1, coalesce(p_timeout_minutes, 10));
  v_cutoff  timestamptz := now() - make_interval(mins => v_minutes);
  v_max     integer := greatest(1, coalesce(p_max_attempts, 8));
  v_recovered_synced integer := 0;
  v_requeued         integer := 0;
  v_dead_lettered    integer := 0;
begin
  -- (a) Stale 'syncing' WITH a Lazywait ref: Create Order already succeeded on a
  --     prior run (we hold order_ref) but the worker died before finalizing.
  --     Recover to 'synced'. NEVER re-POST — there is no idempotency key.
  with recovered as (
    update public.orders o
       set lazywait_sync_state = 'synced',
           synced_at           = coalesce(o.synced_at, now()),
           sync_last_error     = null,
           sync_status         = 'synced'::public.sync_status,
           updated_at          = now()
     where o.lazywait_sync_state = 'syncing'
       and o.updated_at < v_cutoff
       and o.lazywait_ref is not null
     returning o.id
  )
  insert into public.integration_sync_logs (provider, order_id, direction, status, error)
    select 'lazywait', id, 'push', 'success', 'recovered_stale_syncing_with_ref' from recovered;
  get diagnostics v_recovered_synced = row_count;

  -- (b) Stale 'syncing' WITHOUT a ref: the create never confirmed. Requeue with
  --     backoff (or dead-letter at the attempt ceiling). The next attempt is
  --     safe to send because no POS ticket was created (we have no ref).
  with reaped as (
    update public.orders o
       set sync_attempt_count   = o.sync_attempt_count + 1,
           lazywait_sync_state  = case when o.sync_attempt_count + 1 >= v_max
                                       then 'dead_letter' else 'failed' end,
           sync_next_attempt_at = case when o.sync_attempt_count + 1 >= v_max then null
                                       else now() + make_interval(
                                              secs => least(3600, 30 * (2 ^ o.sync_attempt_count))
                                            ) end,
           sync_last_error      = 'reclaimed_stale_syncing_no_ref',
           sync_status          = 'failed'::public.sync_status,
           updated_at           = now()
     where o.lazywait_sync_state = 'syncing'
       and o.updated_at < v_cutoff
       and o.lazywait_ref is null
     returning o.id, o.lazywait_sync_state as new_state
  ), logged as (
    insert into public.integration_sync_logs (provider, order_id, direction, status, error)
      select 'lazywait', id, 'push', 'failed',
             case when new_state = 'dead_letter'
                  then 'stale_syncing_no_ref_dead_letter'
                  else 'stale_syncing_no_ref_requeued' end
        from reaped
    returning 1
  )
  select
    count(*) filter (where new_state = 'failed'),
    count(*) filter (where new_state = 'dead_letter')
    into v_requeued, v_dead_lettered
    from reaped;

  return jsonb_build_object(
    'recovered_synced', v_recovered_synced,
    'requeued',         v_requeued,
    'dead_lettered',    v_dead_lettered,
    'timeout_minutes',  v_minutes
  );
end $$;

revoke all on function public.reap_stale_lazywait_syncs(integer, integer) from public, anon, authenticated;
grant execute on function public.reap_stale_lazywait_syncs(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- requeue_lazywait_order(): admin "retry". Redefined here to ALSO reset
-- sync_attempt_count = 0 — previously a requeued order kept its exhausted
-- attempt count (e.g. 8), so the very next failure immediately re-dead-lettered
-- (attempt 9 >= max). Resetting gives the retry a full attempt budget.
-- ---------------------------------------------------------------------------
create or replace function public.requeue_lazywait_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only admins may requeue Lazywait sync' using errcode = '42501';
  end if;
  update public.orders set
    lazywait_sync_state  = 'pending',
    sync_attempt_count   = 0,
    sync_next_attempt_at = now(),
    sync_last_error      = null,
    sync_blocked_reason  = null,
    sync_status          = 'not_synced'::public.sync_status,
    updated_at           = now()
  where id = p_order_id
    and order_type <> 'delivery'      -- delivery stays blocked until schema confirmed
    and lazywait_sync_state in ('failed','blocked','dead_letter','skipped')
  returning * into v_order;
  if not found then
    raise exception 'Order not requeuable (not found, is delivery, or already pending/synced)';
  end if;
  return v_order;
end $$;

revoke all on function public.requeue_lazywait_order(uuid) from public, anon;
grant execute on function public.requeue_lazywait_order(uuid) to authenticated;
