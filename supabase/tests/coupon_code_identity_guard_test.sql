-- Coupon code is the immutable identity snapshotted on orders for cancellation
-- compensation. Once referenced, code mutation/deletion must fail; non-identity
-- edits and unused-coupon lifecycle remain allowed.
begin;

insert into public.branches (id, name_en, name_ar, is_active)
values ('b0000000-0000-0000-0000-00000000c001', 'Coupon Guard Test', 'اختبار القسيمة', true)
on conflict (id) do nothing;

insert into public.coupons (id, code, type, value, is_active, usage_count)
values
  ('c0000000-0000-0000-0000-00000000c001', 'USED10', 'fixed', 10, true, 1),
  ('c0000000-0000-0000-0000-00000000c002', 'FREE10', 'fixed', 10, true, 0);

set local session_replication_role = replica;
insert into public.orders (
  id, order_number, branch_id, order_type, subtotal, total,
  status, payment_status, lazywait_sync_state, coupon_code, created_at, updated_at
) values (
  '10000000-0000-0000-0000-00000000c001', 'COUPON-GUARD-ORDER',
  'b0000000-0000-0000-0000-00000000c001', 'pickup', 20, 10,
  'received', 'pending', 'pending', 'USED10', now(), now()
);
set local session_replication_role = origin;

-- Non-identity edits remain allowed for a used coupon.
update public.coupons set is_active = false where code = 'USED10';

-- Used code cannot be renamed.
do $$
begin
  begin
    update public.coupons set code = 'RENAMED10' where code = 'USED10';
    raise exception 'rename unexpectedly succeeded';
  exception when sqlstate '23503' then
    null;
  end;
end $$;

-- Used coupon row cannot be deleted, preventing code reuse later.
do $$
begin
  begin
    delete from public.coupons where code = 'USED10';
    raise exception 'delete unexpectedly succeeded';
  exception when sqlstate '23503' then
    null;
  end;
end $$;

-- Unused coupons retain normal admin lifecycle.
update public.coupons set code = 'FREE11' where code = 'FREE10';
delete from public.coupons where code = 'FREE11';

-- Identity remains present for later cancellation compensation.
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.coupons where code = 'USED10';
  if v_count <> 1 then
    raise exception 'used coupon identity was not preserved';
  end if;
end $$;

rollback;
