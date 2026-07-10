-- ============================================================================
-- claim_lazywait_sync_one(p_order_id) — claim a SINGLE due order for a
-- synchronous sync at checkout (order-intake), mirroring claim_lazywait_sync_batch.
--
-- Same locking discipline as the batch claim (FOR UPDATE SKIP LOCKED + flip to
-- 'syncing') so the synchronous checkout path and the background worker can
-- NEVER both send the same order (Create Order has no idempotency key, so a
-- double-send would duplicate the POS ticket). Returns the claimed row, or no
-- rows if the order isn't currently due (e.g. delivery = 'blocked', already
-- 'synced'/'syncing', or a backoff window not yet elapsed). Service-role only.
-- ============================================================================
create or replace function public.claim_lazywait_sync_one(p_order_id uuid)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing', updated_at = now()
   where o.id in (
     select id from public.orders
      where id = p_order_id
        and lazywait_sync_state in ('pending','failed')
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
      for update skip locked
   )
   returning o.*;
end $$;

revoke all on function public.claim_lazywait_sync_one(uuid) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_one(uuid) to service_role;
