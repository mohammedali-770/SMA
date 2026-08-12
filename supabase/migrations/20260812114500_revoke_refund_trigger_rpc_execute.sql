-- Harden the refund trigger helper against direct client/RPC execution.
--
-- open_order_refund_record() is a RETURNS trigger SECURITY DEFINER function.
-- It is invoked by the open_orders_refund_record trigger on public.orders; it is
-- not a client API. Trigger execution does not require anon/authenticated to
-- hold EXECUTE on the trigger function, so those grants only increase surface
-- area and are removed here.

revoke execute on function public.open_order_refund_record() from public, anon, authenticated;

-- Keep server-side administrative execution explicit. The function owner
-- (postgres) retains its owner privileges independently.
grant execute on function public.open_order_refund_record() to service_role;
