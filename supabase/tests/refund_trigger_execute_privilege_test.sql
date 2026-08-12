-- ============================================================================
-- Refund trigger helper privilege regression coverage.
-- ============================================================================
begin;

do $$
declare
  v_trigger_count integer;
begin
  -- This is a database trigger helper, not a client RPC. Any PUBLIC grant would
  -- flow through to anon/authenticated, so both client roles must resolve false.
  if has_function_privilege('anon', 'public.open_order_refund_record()', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: anon can execute open_order_refund_record()';
  end if;

  if has_function_privilege('authenticated', 'public.open_order_refund_record()', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: authenticated can execute open_order_refund_record()';
  end if;

  if not has_function_privilege('service_role', 'public.open_order_refund_record()', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: service_role execute missing on open_order_refund_record()';
  end if;

  -- The hardening must not detach the function from the order trigger that uses
  -- it internally.
  select count(*) into v_trigger_count
    from pg_trigger t
   where not t.tgisinternal
     and t.tgrelid = 'public.orders'::regclass
     and t.tgfoid = 'public.open_order_refund_record()'::regprocedure
     and t.tgname = 'open_orders_refund_record';

  if v_trigger_count <> 1 then
    raise exception 'TRIGGER FAILED: open_orders_refund_record is not wired to open_order_refund_record()';
  end if;
end $$;

rollback;
