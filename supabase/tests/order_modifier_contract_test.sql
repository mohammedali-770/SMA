-- ============================================================================
-- New order items must satisfy the server-side modifier contract.
-- ============================================================================
begin;

insert into public.branches (id, name_en, name_ar, is_active)
values ('b0000000-0000-0000-0000-00000000d001', 'Modifier Test', 'اختبار الإضافات', true)
on conflict (id) do nothing;

insert into public.categories (id, name_en, name_ar, is_active)
values ('c0000000-0000-0000-0000-00000000d001', 'Modifier Test', 'اختبار الإضافات', true)
on conflict (id) do nothing;

insert into public.products (id, category_id, name_en, name_ar, price, is_active)
values
  ('d0000000-0000-0000-0000-00000000d001', 'c0000000-0000-0000-0000-00000000d001', 'Required Product', 'منتج إلزامي', 20, true),
  ('d0000000-0000-0000-0000-00000000d002', 'c0000000-0000-0000-0000-00000000d001', 'No Group Product', 'منتج بدون مجموعة', 15, true)
on conflict (id) do nothing;

insert into public.modifier_groups (id, name_en, name_ar, min_select, max_select, is_required)
values
  ('e0000000-0000-0000-0000-00000000d001', 'Heat Level', 'درجة الحرارة', 1, 1, true),
  ('e0000000-0000-0000-0000-00000000d002', 'Optional Sauce', 'صلصة اختيارية', 0, 2, false)
on conflict (id) do nothing;

insert into public.modifiers (id, group_id, name_en, name_ar, price, is_active)
values
  ('f0000000-0000-0000-0000-00000000d001', 'e0000000-0000-0000-0000-00000000d001', 'Mild', 'خفيف', 0, true),
  ('f0000000-0000-0000-0000-00000000d002', 'e0000000-0000-0000-0000-00000000d001', 'Hot', 'حار', 0, true),
  ('f0000000-0000-0000-0000-00000000d003', 'e0000000-0000-0000-0000-00000000d002', 'Garlic', 'ثوم', 1, true),
  ('f0000000-0000-0000-0000-00000000d004', 'e0000000-0000-0000-0000-00000000d002', 'Ranch', 'رانش', 1, false)
on conflict (id) do nothing;

insert into public.product_modifier_groups (product_id, group_id, sort_order)
values
  ('d0000000-0000-0000-0000-00000000d001', 'e0000000-0000-0000-0000-00000000d001', 0),
  ('d0000000-0000-0000-0000-00000000d001', 'e0000000-0000-0000-0000-00000000d002', 1)
on conflict do nothing;

-- Test parent order. Disable ordinary order enqueue/change-event triggers only
-- while seeding this synthetic parent; the modifier contract under test is on
-- order_items/order_item_modifiers and remains enabled below.
set local session_replication_role = replica;
insert into public.orders (
  id, order_number, branch_id, order_type, subtotal, total,
  status, payment_status, lazywait_sync_state
) values (
  '10000000-0000-0000-0000-00000000d001', 'MOD-CONTRACT-TEST',
  'b0000000-0000-0000-0000-00000000d001', 'pickup', 100, 100,
  'received', 'pending', 'pending'
);
set local session_replication_role = origin;

-- A valid item: exactly one required Heat Level + one optional active sauce.
insert into public.order_items (
  id, order_id, product_id, name_en, name_ar, unit_price, quantity, line_total
) values (
  '11000000-0000-0000-0000-00000000d001', '10000000-0000-0000-0000-00000000d001',
  'd0000000-0000-0000-0000-00000000d001', 'Required Product', 'منتج إلزامي', 21, 1, 21
);
insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
values
  ('11000000-0000-0000-0000-00000000d001', 'f0000000-0000-0000-0000-00000000d001', 'Mild', 'خفيف', 0),
  ('11000000-0000-0000-0000-00000000d001', 'f0000000-0000-0000-0000-00000000d003', 'Garlic', 'ثوم', 1);
select public.assert_order_item_modifier_contract('11000000-0000-0000-0000-00000000d001');

-- Missing required selection.
insert into public.order_items (
  id, order_id, product_id, name_en, name_ar, unit_price, quantity, line_total
) values (
  '11000000-0000-0000-0000-00000000d002', '10000000-0000-0000-0000-00000000d001',
  'd0000000-0000-0000-0000-00000000d001', 'Required Product', 'منتج إلزامي', 20, 1, 20
);
do $$
begin
  begin
    perform public.assert_order_item_modifier_contract('11000000-0000-0000-0000-00000000d002');
    raise exception 'missing required modifier unexpectedly passed';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- More than max_select=1 in required group.
insert into public.order_items (
  id, order_id, product_id, name_en, name_ar, unit_price, quantity, line_total
) values (
  '11000000-0000-0000-0000-00000000d003', '10000000-0000-0000-0000-00000000d001',
  'd0000000-0000-0000-0000-00000000d001', 'Required Product', 'منتج إلزامي', 20, 1, 20
);
insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
values
  ('11000000-0000-0000-0000-00000000d003', 'f0000000-0000-0000-0000-00000000d001', 'Mild', 'خفيف', 0),
  ('11000000-0000-0000-0000-00000000d003', 'f0000000-0000-0000-0000-00000000d002', 'Hot', 'حار', 0);
do $$
begin
  begin
    perform public.assert_order_item_modifier_contract('11000000-0000-0000-0000-00000000d003');
    raise exception 'max_select violation unexpectedly passed';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Duplicate modifier ID cannot be used to inflate price/cardinality.
insert into public.order_items (
  id, order_id, product_id, name_en, name_ar, unit_price, quantity, line_total
) values (
  '11000000-0000-0000-0000-00000000d004', '10000000-0000-0000-0000-00000000d001',
  'd0000000-0000-0000-0000-00000000d001', 'Required Product', 'منتج إلزامي', 20, 1, 20
);
insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
values
  ('11000000-0000-0000-0000-00000000d004', 'f0000000-0000-0000-0000-00000000d001', 'Mild', 'خفيف', 0),
  ('11000000-0000-0000-0000-00000000d004', 'f0000000-0000-0000-0000-00000000d001', 'Mild', 'خفيف', 0);
do $$
begin
  begin
    perform public.assert_order_item_modifier_contract('11000000-0000-0000-0000-00000000d004');
    raise exception 'duplicate modifier unexpectedly passed';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Inactive modifier fails even when its group is linked.
insert into public.order_items (
  id, order_id, product_id, name_en, name_ar, unit_price, quantity, line_total
) values (
  '11000000-0000-0000-0000-00000000d005', '10000000-0000-0000-0000-00000000d001',
  'd0000000-0000-0000-0000-00000000d001', 'Required Product', 'منتج إلزامي', 21, 1, 21
);
insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
values
  ('11000000-0000-0000-0000-00000000d005', 'f0000000-0000-0000-0000-00000000d001', 'Mild', 'خفيف', 0),
  ('11000000-0000-0000-0000-00000000d005', 'f0000000-0000-0000-0000-00000000d004', 'Ranch', 'رانش', 1);
do $$
begin
  begin
    perform public.assert_order_item_modifier_contract('11000000-0000-0000-0000-00000000d005');
    raise exception 'inactive modifier unexpectedly passed';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Modifier from a group not linked to the product fails. Reuse active Garlic on
-- a product with no linked modifier groups.
insert into public.order_items (
  id, order_id, product_id, name_en, name_ar, unit_price, quantity, line_total
) values (
  '11000000-0000-0000-0000-00000000d006', '10000000-0000-0000-0000-00000000d001',
  'd0000000-0000-0000-0000-00000000d002', 'No Group Product', 'منتج بدون مجموعة', 16, 1, 16
);
insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
values ('11000000-0000-0000-0000-00000000d006', 'f0000000-0000-0000-0000-00000000d003', 'Garlic', 'ثوم', 1);
do $$
begin
  begin
    perform public.assert_order_item_modifier_contract('11000000-0000-0000-0000-00000000d006');
    raise exception 'unlinked modifier unexpectedly passed';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Trigger metadata must remain INSERT-only and deferred on both tables.
do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  where t.tgname in ('validate_new_order_item_modifiers_on_item','validate_new_order_item_modifiers_on_modifier')
    and (not t.tgdeferrable or not t.tginitdeferred or (t.tgtype & 4) = 0);
  if v_bad <> 0 then
    raise exception 'modifier contract triggers are not deferred INSERT triggers';
  end if;
end $$;

-- Remove intentionally-invalid rows before forcing the deferred valid trigger.
delete from public.order_item_modifiers where order_item_id <> '11000000-0000-0000-0000-00000000d001';
delete from public.order_items where id <> '11000000-0000-0000-0000-00000000d001';
set constraints all immediate;

rollback;
