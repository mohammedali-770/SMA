-- ============================================================================
-- Spicy Meal — close the anon EXECUTE grant on caller_can_read_order().
--
-- WHAT WAS MISSED
-- 20260724200000_order_read_contracts introduced the SECURITY DEFINER ownership
-- predicate public.caller_can_read_order(uuid) and wrote:
--
--     revoke all on function public.caller_can_read_order(uuid) from public;
--     grant execute on function public.caller_can_read_order(uuid) to authenticated;
--
-- Every OTHER function added by that same migration is revoked from
-- `public, anon` (admin_list_orders, admin_list_orders_with_items,
-- admin_set_order_status, place_customer_order). This one omitted `anon`, so the
-- anon role kept EXECUTE. The Supabase Security Advisor reports it as
-- `anon_security_definer_function_executable` — "Public Can Execute SECURITY
-- DEFINER Function".
--
-- ACTUAL EXPOSURE: NONE TODAY, and this is not a retroactive fix for a leak.
-- The function body is:
--     select exists (select 1 from public.orders o
--                    where o.id = p_order_id
--                      and (o.customer_id = auth.uid() or public.is_staff()));
-- For an anonymous caller auth.uid() is NULL, so `o.customer_id = auth.uid()`
-- is NULL (never true), and is_staff() is false. The predicate therefore returns
-- FALSE for every order id an anon caller could pass — it discloses neither the
-- existence of an order nor any column value.
--
-- WHY FIX IT ANYWAY
-- A SECURITY DEFINER function that reads orders.customer_id should not be
-- callable by an unauthenticated role at all. Correctness of the current body is
-- the only thing standing between `anon` and a privileged read; a future edit to
-- that body would silently inherit an anon-reachable entry point. Least
-- privilege belongs on the grant, not on the body's current logic.
--
-- SCOPE — one REVOKE. No policy, body, signature, owner, search_path or
-- authenticated grant changes, so order_items / order_item_modifiers RLS (which
-- calls this predicate as the signed-in customer) is unaffected.
--
-- ROLLBACK (not recommended — it reopens the advisor finding):
--   grant execute on function public.caller_can_read_order(uuid) to anon;
-- ============================================================================

revoke execute on function public.caller_can_read_order(uuid) from anon;

-- Self-verification: anon must no longer hold EXECUTE, and `authenticated` must
-- still hold it (the RLS policies on order_items / order_item_modifiers depend
-- on the signed-in customer being able to call this predicate).
do $$
begin
  if has_function_privilege('anon', 'public.caller_can_read_order(uuid)', 'execute') then
    raise exception 'anon still holds EXECUTE on caller_can_read_order(uuid)';
  end if;
  if not has_function_privilege('authenticated', 'public.caller_can_read_order(uuid)', 'execute') then
    raise exception 'authenticated LOST EXECUTE on caller_can_read_order(uuid) — order line RLS would break';
  end if;
end $$;