-- ============================================================================
-- Comped customers — a named group who order at no charge.
--
-- Covers all three migrations of the feature:
--   20260826090000_comp_members.sql               membership, audit, admin RPCs
--   20260826100000_comp_order_totals.sql          the money path (3 functions)
--   20260826110000_checkout_zero_total_idempotency.sql   the retry hole
--
-- WHY THIS FILE IS UNUSUAL: it is the FIRST suite anywhere in this repository
-- that places a ZERO-TOTAL order. Two defects were found precisely because
-- nothing had ever done that, and both are regression-tested here rather than
-- described:
--
--   LANDMINE 1  set_lazywait_initial_sync parks a non-paid ONLINE order at
--               lazywait_sync_state='awaiting_payment', and begin_payment_attempt
--               refuses a total of 0. A comped order left 'pending' would
--               therefore never reach the kitchen AND could never be paid.
--               Case 4 asserts the state is 'pending'; without the
--               payment_status='paid' rule it is 'awaiting_payment'.
--
--   LANDMINE 2  begin_checkout_session settles a zero-total cart inside one
--               call, so its retry lookup (which required 'pending_payment')
--               never matched and a retry produced a SECOND free order.
--               Case 11 asserts one session and one order; it fails against
--               the pre-fix definition.
--
-- Seed fixtures (supabase/seed.sql): branch 001 (delivery_fee 15,
-- min_delivery_order 40), product 001 at 32.00, coupon SPICY15 (percentage 15).
--
-- Runs against a throwaway chain-applied Postgres. Every case raises on
-- failure, so the script aborts non-zero; a clean run prints the final notice
-- and commits nothing.
-- ============================================================================
begin;

\set admin  '''00000000-0000-0000-0000-0000000ca001'''
\set member '''00000000-0000-0000-0000-0000000ca002'''
\set payer  '''00000000-0000-0000-0000-0000000ca003'''
\set lapsed '''00000000-0000-0000-0000-0000000ca004'''
\set branch '''b0000000-0000-0000-0000-000000000001'''
\set beef   '''a0000000-0000-0000-0000-000000000001'''

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, email) values
  (:admin,  'admin@x'),
  (:member, 'member@x'),
  (:payer,  'payer@x'),
  (:lapsed, 'lapsed@x');

-- handle_new_user() already created these from the auth.users insert above.
insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:admin,  'admin',    'Admin',        '+966500000001', 0),
  (:member, 'customer', 'Free Eater',   '+966500000002', 500),
  (:payer,  'customer', 'Paying Person','+966500000003', 500),
  (:lapsed, 'customer', 'Lapsed Member','+966500000004', 500)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number,
  loyalty_points = excluded.loyalty_points;

-- min_points_to_redeem defaults to 100; 0 keeps the loyalty arithmetic in this
-- file about the comp rule rather than about the redemption floor.
update public.app_settings
   set online_payment_enabled = true, cash_payment_enabled = true,
       default_payment_method = 'online', loyalty_enabled = true,
       min_points_to_redeem = 0
 where id = true;

-- ============================================================================
-- 1. Object contract
-- ============================================================================
do $$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing from (
    select t from unnest(array['comp_members','comp_member_audit']) t
    where to_regclass('public.' || t) is null
  ) s;
  if v_missing is not null then
    raise exception 'FAIL 1: missing table(s): %', v_missing;
  end if;

  select string_agg(f, ', ') into v_missing from (
    select f from unnest(array['admin_set_comp_member','admin_list_comp_members',
                               'admin_list_comp_member_audit']) f
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f)
  ) s;
  if v_missing is not null then
    raise exception 'FAIL 1: missing function(s): %', v_missing;
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='is_comped') then
    raise exception 'FAIL 1: orders.is_comped is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='comp_discount_amount') then
    raise exception 'FAIL 1: orders.comp_discount_amount is missing';
  end if;

  raise notice 'case 1 ok — objects exist';
end $$;

-- ============================================================================
-- 2. Grants + RLS. Membership must be admin-writable ONLY.
-- ============================================================================
do $$
declare v_t text; v_n integer;
begin
  foreach v_t in array array['comp_members','comp_member_audit'] loop
    if not (select relrowsecurity from pg_class
            where oid = ('public.'||v_t)::regclass) then
      raise exception 'FAIL 2: RLS is not enabled on public.%', v_t;
    end if;
    -- No INSERT/UPDATE/DELETE grant to a client role: the RPC is the only door.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='public' and table_name=v_t
       and grantee in ('anon','authenticated')
       and privilege_type in ('INSERT','UPDATE','DELETE');
    if v_n <> 0 then
      raise exception 'FAIL 2: public.% has % client write grant(s)', v_t, v_n;
    end if;
  end loop;

  -- anon may not execute the writer.
  if has_function_privilege('anon', 'public.admin_set_comp_member(uuid, boolean, text, text)', 'execute') then
    raise exception 'FAIL 2: anon can execute admin_set_comp_member';
  end if;
  if not has_function_privilege('authenticated',
        'public.admin_set_comp_member(uuid, boolean, text, text)', 'execute') then
    raise exception 'FAIL 2: authenticated cannot execute admin_set_comp_member';
  end if;

  raise notice 'case 2 ok — RLS on, no client write grant, anon cannot call the writer';
end $$;

-- ============================================================================
-- 3. admin_set_comp_member: the gate, the mandatory reason, the audit
-- ============================================================================
-- A non-admin is refused.
select set_config('test.auth_uid', :payer, true);
select set_config('test.is_admin', 'false', true);
do $$
declare v_err text;
begin
  begin
    perform public.admin_set_comp_member('00000000-0000-0000-0000-0000000ca002'::uuid,
                                         true, 'trying it on');
    raise exception 'FAIL 3: a non-admin was allowed to comp somebody';
  exception when insufficient_privilege then
    null;  -- 42501, as intended
  end;
end $$;

select set_config('test.auth_uid', :admin, true);
select set_config('test.is_admin', 'true', true);
do $$
declare v_res jsonb; v_n integer; v_reason text;
begin
  -- A reason under three characters is refused: this is the record of why
  -- somebody eats free, not decoration.
  begin
    perform public.admin_set_comp_member('00000000-0000-0000-0000-0000000ca002'::uuid, true, 'ab');
    raise exception 'FAIL 3: a two-character reason was accepted';
  exception when invalid_parameter_value then
    null;
  end;

  v_res := public.admin_set_comp_member('00000000-0000-0000-0000-0000000ca002'::uuid,
                                        true, 'founding staff member');
  if not (v_res->>'is_active')::boolean or (v_res->>'was_active')::boolean then
    raise exception 'FAIL 3: add returned %', v_res;
  end if;

  -- Adding twice is refused rather than silently accepted.
  begin
    perform public.admin_set_comp_member('00000000-0000-0000-0000-0000000ca002'::uuid,
                                         true, 'again');
    raise exception 'FAIL 3: a duplicate add was accepted';
  exception when raise_exception then
    null;
  end;

  select count(*), max(reason) into v_n, v_reason from public.comp_member_audit
   where target_user_id = '00000000-0000-0000-0000-0000000ca002';
  if v_n <> 1 then
    raise exception 'FAIL 3: expected 1 audit row, found %', v_n;
  end if;
  if v_reason <> 'founding staff member' then
    raise exception 'FAIL 3: the audit did not record the reason (got %)', v_reason;
  end if;

  -- The lapsed member exists but is switched off.
  perform public.admin_set_comp_member('00000000-0000-0000-0000-0000000ca004'::uuid,
                                       true, 'briefly a member');
  perform public.admin_set_comp_member('00000000-0000-0000-0000-0000000ca004'::uuid,
                                       false, 'left the company');

  raise notice 'case 3 ok — gate, reason, no-op refusal and audit all hold';
end $$;

-- ============================================================================
-- 4. place_order: a comped PICKUP order whose method resolves to ONLINE.
--    This is the LANDMINE 1 regression test.
-- ============================================================================
select set_config('test.auth_uid', :member, true);
select set_config('test.is_admin', 'false', true);
do $$
declare o public.orders; v_bal integer;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);

  if o.total <> 0 then      raise exception 'FAIL 4: total is %, expected 0', o.total; end if;
  if o.vat_amount <> 0 then raise exception 'FAIL 4: VAT is %, expected 0', o.vat_amount; end if;
  if o.subtotal <> 64 then  raise exception 'FAIL 4: subtotal is %, expected 64 (the real goods value)', o.subtotal; end if;
  if not o.is_comped then   raise exception 'FAIL 4: is_comped is false'; end if;
  if o.comp_discount_amount <> 64 then
    raise exception 'FAIL 4: comp_discount_amount is %, expected 64', o.comp_discount_amount;
  end if;
  if o.discount_amount <> 0 then
    raise exception 'FAIL 4: discount_amount is % — a comp must not masquerade as a coupon', o.discount_amount;
  end if;
  if o.payment_status <> 'paid' then
    raise exception 'FAIL 4: payment_status is %, expected paid', o.payment_status;
  end if;
  if o.paid_at is null then
    raise exception 'FAIL 4: paid_at is null on a paid order — watchdog rule R1 would never see it';
  end if;
  if o.payment_method <> 'online' then
    raise exception 'FAIL 4: the method resolved to % — this case is meaningless unless it is online', o.payment_method;
  end if;

  -- THE LANDMINE. 'awaiting_payment' here means the kitchen never gets the food.
  if o.lazywait_sync_state <> 'pending' then
    raise exception 'FAIL 4 (LANDMINE 1): lazywait_sync_state is %, expected pending — the order is stranded',
      o.lazywait_sync_state;
  end if;
  if o.sync_next_attempt_at is null then
    raise exception 'FAIL 4: the order was not queued for the POS';
  end if;

  if coalesce(o.loyalty_points_earned, 0) <> 0 then
    raise exception 'FAIL 4: % points earned on a free order', o.loyalty_points_earned;
  end if;
  select loyalty_points into v_bal from public.profiles
   where id = '00000000-0000-0000-0000-0000000ca002';
  if v_bal <> 500 then
    raise exception 'FAIL 4: the loyalty balance moved to %', v_bal;
  end if;

  raise notice 'case 4 ok — comped pickup order is free, paid, and queued to the POS';
end $$;

-- ============================================================================
-- 5. A non-member with the identical cart is completely unaffected
-- ============================================================================
select set_config('test.auth_uid', :payer, true);
do $$
declare o public.orders;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);

  if o.total <> 64 then     raise exception 'FAIL 5: total is %, expected 64', o.total; end if;
  if o.vat_amount = 0 then  raise exception 'FAIL 5: VAT was zeroed for a paying customer'; end if;
  if o.is_comped then       raise exception 'FAIL 5: a non-member was comped'; end if;
  if o.comp_discount_amount <> 0 then
    raise exception 'FAIL 5: comp_discount_amount is %', o.comp_discount_amount;
  end if;
  if o.payment_status <> 'pending' then
    raise exception 'FAIL 5: payment_status is %, expected pending', o.payment_status;
  end if;
  if o.paid_at is not null then
    raise exception 'FAIL 5: an unpaid order was stamped paid_at';
  end if;
  -- The old behaviour, still intact: an unpaid online order waits for payment.
  if o.lazywait_sync_state <> 'awaiting_payment' then
    raise exception 'FAIL 5: lazywait_sync_state is %, expected awaiting_payment', o.lazywait_sync_state;
  end if;
  if o.loyalty_points_earned <> 64 then
    raise exception 'FAIL 5: % points earned, expected 64', o.loyalty_points_earned;
  end if;

  raise notice 'case 5 ok — the paying customer is untouched by any of this';
end $$;

-- ============================================================================
-- 6. An INACTIVE membership does not comp
-- ============================================================================
select set_config('test.auth_uid', :lapsed, true);
do $$
declare o public.orders;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  if o.total <> 32 then raise exception 'FAIL 6: a deactivated member ate free (total %)', o.total; end if;
  if o.is_comped then   raise exception 'FAIL 6: a deactivated member was comped'; end if;
  raise notice 'case 6 ok — deactivation takes effect immediately';
end $$;

-- ============================================================================
-- 7. Comped + coupon + loyalty: neither is consumed
-- ============================================================================
select set_config('test.auth_uid', :member, true);
do $$
declare o public.orders; v_used integer; v_bal integer; v_ledger integer;
begin
  select usage_count into v_used from public.coupons where code = 'SPICY15';

  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
        null, 'SPICY15', null, 300);

  if o.total <> 0 then raise exception 'FAIL 7: total is %', o.total; end if;
  if o.coupon_code is not null then
    raise exception 'FAIL 7: the coupon was recorded on a free order (%)', o.coupon_code;
  end if;
  if o.discount_amount <> 0 then
    raise exception 'FAIL 7: discount_amount is %', o.discount_amount;
  end if;

  -- The point of skipping the block: a limited code must not burn a use on an
  -- order that was free anyway.
  if (select usage_count from public.coupons where code = 'SPICY15') <> coalesce(v_used, 0) then
    raise exception 'FAIL 7: the coupon usage_count was burned on a comped order';
  end if;

  if coalesce(o.loyalty_points_redeemed, 0) <> 0 then
    raise exception 'FAIL 7: % points were burned against free food', o.loyalty_points_redeemed;
  end if;
  if o.loyalty_discount_amount <> 0 then
    raise exception 'FAIL 7: loyalty_discount_amount is %', o.loyalty_discount_amount;
  end if;
  select loyalty_points into v_bal from public.profiles
   where id = '00000000-0000-0000-0000-0000000ca002';
  if v_bal <> 500 then raise exception 'FAIL 7: the balance moved to %', v_bal; end if;
  select count(*) into v_ledger from public.loyalty_transactions
   where profile_id = '00000000-0000-0000-0000-0000000ca002';
  if v_ledger <> 0 then raise exception 'FAIL 7: % loyalty ledger row(s) written', v_ledger; end if;

  raise notice 'case 7 ok — coupon and loyalty are both left alone';
end $$;

-- The same coupon on a PAYING customer, to prove case 7 skipped something real.
select set_config('test.auth_uid', :payer, true);
do $$
declare o public.orders; v_before integer; v_after integer;
begin
  select usage_count into v_before from public.coupons where code = 'SPICY15';
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
        null, 'SPICY15');
  if o.discount_amount <= 0 then
    raise exception 'FAIL 7b: the coupon did not apply to a paying customer';
  end if;
  select usage_count into v_after from public.coupons where code = 'SPICY15';
  if v_after <> coalesce(v_before, 0) + 1 then
    raise exception 'FAIL 7b: usage_count went % -> %', v_before, v_after;
  end if;
  raise notice 'case 7b ok — the coupon path a comp skips is a live one';
end $$;

-- ============================================================================
-- 8. Delivery: the branch minimum still applies; the fee is comped
-- ============================================================================
-- A real zone around the seeded Riyadh branch, so place_order's PostGIS check
-- passes and the assertions below are about the comp rather than the geometry.
insert into public.branch_delivery_zones (branch_id, name, zone_geojson, zone_polygon, is_active)
values (
  'b0000000-0000-0000-0000-000000000001', 'test box',
  '{"type":"MultiPolygon","coordinates":[[[[46.6,24.6],[46.8,24.6],[46.8,24.8],[46.6,24.8],[46.6,24.6]]]]}'::jsonb,
  extensions.ST_GeomFromText(
    'MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326),
  true);

select set_config('test.auth_uid', :member, true);
insert into public.addresses (id, customer_id, label, latitude, longitude, description)
values ('00000000-0000-0000-0000-0000000ad001', :member, 'Home',
        24.7136, 46.6753, 'Second floor, blue door');

do $$
declare o public.orders; v_err text; v_refused boolean := false;
begin
  -- 32.00 is below the branch minimum of 40. A comp must not buy a way past a
  -- gate that exists to protect the kitchen from an uneconomic run.
  begin
    o := public.place_order(
          'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
          '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
          '00000000-0000-0000-0000-0000000ad001'::uuid);
  exception when others then
    v_err := SQLERRM; v_refused := true;
  end;
  if not v_refused or v_err not like '%delivery minimum%' then
    raise exception 'FAIL 8: the delivery minimum did not refuse a comped 32.00 cart (err=%)',
      coalesce(v_err, 'none');
  end if;

  -- Above the minimum: the fee is zeroed with everything else, and counted in.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '00000000-0000-0000-0000-0000000ad001'::uuid);
  if o.total <> 0 then raise exception 'FAIL 8: delivery total is %', o.total; end if;
  if o.delivery_fee <> 15 then
    raise exception 'FAIL 8: delivery_fee is %, expected the branch fee of 15', o.delivery_fee;
  end if;
  if o.comp_discount_amount <> 79 then
    raise exception 'FAIL 8: comp_discount_amount is %, expected 79 (64 goods + 15 fee)',
      o.comp_discount_amount;
  end if;
  if o.vat_amount <> 0 then raise exception 'FAIL 8: VAT is %', o.vat_amount; end if;

  raise notice 'case 8 ok — the minimum still bites, the fee is comped';
end $$;

-- ============================================================================
-- 9. compute_order_snapshot + insert_order_from_snapshot (the online path)
-- ============================================================================
do $$
declare snap jsonb; o public.orders;
begin
  snap := public.compute_order_snapshot(
            '00000000-0000-0000-0000-0000000ca002'::uuid,
            'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
            '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":3}]'::jsonb);

  if (snap->>'total')::numeric <> 0 then
    raise exception 'FAIL 9: snapshot total is %', snap->>'total';
  end if;
  if (snap->>'vat_amount')::numeric <> 0 then
    raise exception 'FAIL 9: snapshot VAT is %', snap->>'vat_amount';
  end if;
  if (snap->>'subtotal')::numeric <> 96 then
    raise exception 'FAIL 9: snapshot subtotal is %, expected 96', snap->>'subtotal';
  end if;
  if not (snap->>'is_comped')::boolean then
    raise exception 'FAIL 9: the snapshot did not record the comp';
  end if;
  if (snap->>'comp_discount_amount')::numeric <> 96 then
    raise exception 'FAIL 9: snapshot comp_discount_amount is %', snap->>'comp_discount_amount';
  end if;

  -- The row written after payment must record what the customer was SHOWN,
  -- not re-decide the comp later.
  o := public.insert_order_from_snapshot(
         '00000000-0000-0000-0000-0000000ca002'::uuid, snap, 'online', 'paid', null, 'test');
  if not o.is_comped then raise exception 'FAIL 9: the order lost is_comped'; end if;
  if o.comp_discount_amount <> 96 then
    raise exception 'FAIL 9: the order lost the comp amount (got %)', o.comp_discount_amount;
  end if;
  if o.total <> 0 then raise exception 'FAIL 9: the order total is %', o.total; end if;
  if o.lazywait_sync_state <> 'pending' then
    raise exception 'FAIL 9: the snapshot path did not queue to the POS (state %)',
      o.lazywait_sync_state;
  end if;

  raise notice 'case 9 ok — both pricing functions agree, and the order keeps the comp';
end $$;

-- A non-member's snapshot is unchanged.
do $$
declare snap jsonb;
begin
  snap := public.compute_order_snapshot(
            '00000000-0000-0000-0000-0000000ca003'::uuid,
            'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
            '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":3}]'::jsonb);
  if (snap->>'total')::numeric <> 96 then
    raise exception 'FAIL 9b: a non-member snapshot totals %', snap->>'total';
  end if;
  if (snap->>'is_comped')::boolean then
    raise exception 'FAIL 9b: a non-member snapshot is comped';
  end if;
  raise notice 'case 9b ok — non-member snapshot unaffected';
end $$;

-- ============================================================================
-- 10. RLS: a customer reads their OWN membership row and nobody else's
-- ============================================================================
-- The checkout screen needs this to show the discount before the order is
-- placed; it is a boolean about oneself and reveals nothing about anyone else.
select set_config('test.auth_uid', :member, true);
select set_config('test.is_admin', 'false', true);
set local role authenticated;
do $$
declare v_own integer; v_other integer; v_audit boolean := false;
begin
  select count(*) into v_own from public.comp_members
   where profile_id = '00000000-0000-0000-0000-0000000ca002';
  select count(*) into v_other from public.comp_members
   where profile_id <> '00000000-0000-0000-0000-0000000ca002';

  if v_own <> 1 then
    raise exception 'FAIL 10: a member cannot read their own row (saw %)', v_own;
  end if;
  if v_other <> 0 then
    raise exception 'FAIL 10: a member can see % other membership row(s)', v_other;
  end if;

  -- The audit is money-trail data and is admin-read-only.
  begin
    perform 1 from public.comp_member_audit limit 1;
    select count(*) > 0 into v_audit from public.comp_member_audit;
  exception when others then
    v_audit := false;
  end;
  if v_audit then
    raise exception 'FAIL 10: a customer can read the comp audit trail';
  end if;

  -- COLUMN scope, not just row scope. `note` holds the ADMINISTRATOR's private
  -- reason — written about the customer, never for them — and `added_by` is an
  -- admin's user id. RLS filters rows and would have handed both over with the
  -- customer's own row, so the grant is what closes this.
  begin
    perform cm.note from public.comp_members cm
     where cm.profile_id = '00000000-0000-0000-0000-0000000ca002';
    raise exception 'FAIL 10: a customer can read the admin note on their own row';
  exception when insufficient_privilege then
    null;  -- 42501, as intended
  end;
  begin
    perform cm.added_by from public.comp_members cm
     where cm.profile_id = '00000000-0000-0000-0000-0000000ca002';
    raise exception 'FAIL 10: a customer can read which admin comped them';
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'case 10 ok — own row visible, columns scoped, audit hidden';
end $$;
reset role;

-- ============================================================================
-- 11. begin_checkout_session zero-total idempotency — LANDMINE 2
-- ============================================================================
select set_config('test.auth_uid', :member, true);
do $$
declare s1 public.checkout_sessions; s2 public.checkout_sessions;
        v_sessions integer; v_orders integer;
        k uuid := '00000000-0000-0000-0000-0000000de001';
begin
  s1 := public.begin_checkout_session(
          'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
          '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
          null, null, null, 0, k);
  if s1.total <> 0 then raise exception 'FAIL 11: the session totals %', s1.total; end if;
  if s1.status <> 'consumed' then
    raise exception 'FAIL 11: a zero-total session is %, expected consumed', s1.status;
  end if;
  if s1.order_id is null then raise exception 'FAIL 11: no order was created'; end if;

  -- THE RETRY. Before the fix this fell through both guards and produced a
  -- second session and a second free order.
  s2 := public.begin_checkout_session(
          'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
          '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
          null, null, null, 0, k);
  if s2.id <> s1.id then
    raise exception 'FAIL 11 (LANDMINE 2): the retry created session % instead of reusing %',
      s2.id, s1.id;
  end if;
  if s2.order_id is distinct from s1.order_id then
    raise exception 'FAIL 11 (LANDMINE 2): the retry created order % instead of reusing %',
      s2.order_id, s1.order_id;
  end if;

  select count(*) into v_sessions from public.checkout_sessions where idempotency_key = k;
  if v_sessions <> 1 then raise exception 'FAIL 11: % sessions exist for one key', v_sessions; end if;
  select count(*) into v_orders from public.orders
   where customer_id = '00000000-0000-0000-0000-0000000ca002' and idempotency_key = k;
  if v_orders <> 1 then raise exception 'FAIL 11: % orders exist for one key', v_orders; end if;

  raise notice 'case 11 ok — a retried free checkout produces one session and one order';
end $$;

-- Layer 2 alone: with the session row gone, the orders unique index is the only
-- thing left, and it must still refuse a duplicate.
do $$
declare s public.checkout_sessions; v_orders integer;
        k uuid := '00000000-0000-0000-0000-0000000de001';
begin
  delete from public.checkout_sessions where idempotency_key = k;
  s := public.begin_checkout_session(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        null, null, null, 0, k);
  select count(*) into v_orders from public.orders
   where customer_id = '00000000-0000-0000-0000-0000000ca002' and idempotency_key = k;
  if v_orders <> 1 then
    raise exception 'FAIL 11b: the orders index let % orders exist for one key', v_orders;
  end if;
  if s.order_id is null then
    raise exception 'FAIL 11b: the recovered session was not linked to the surviving order';
  end if;
  raise notice 'case 11b ok — the order-level guard holds on its own';
end $$;


-- A paying customer's session is unchanged by any of it.
select set_config('test.auth_uid', :payer, true);
do $$
declare s1 public.checkout_sessions; s2 public.checkout_sessions;
        k uuid := '00000000-0000-0000-0000-0000000de002';
begin
  s1 := public.begin_checkout_session(
          'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
          '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
          null, null, null, 0, k);
  if s1.total <> 64 then raise exception 'FAIL 11c: the session totals %', s1.total; end if;
  if s1.status <> 'pending_payment' then
    raise exception 'FAIL 11c: status is %, expected pending_payment', s1.status;
  end if;
  if s1.order_id is not null then
    raise exception 'FAIL 11c: an order was created before payment';
  end if;
  s2 := public.begin_checkout_session(
          'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
          '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
          null, null, null, 0, k);
  if s2.id <> s1.id then
    raise exception 'FAIL 11c: live-session reuse broke (% vs %)', s2.id, s1.id;
  end if;
  raise notice 'case 11c ok — the ordinary paid flow is untouched';
end $$;

-- ============================================================================
-- 12. Historic comped orders survive deactivation
-- ============================================================================
select set_config('test.auth_uid', :admin, true);
select set_config('test.is_admin', 'true', true);
select public.admin_set_comp_member(:member::uuid, false, 'end of the arrangement');

do $$
declare v_comped integer; v_wrong integer;
begin
  select count(*) into v_comped from public.orders where is_comped;
  if v_comped = 0 then
    raise exception 'FAIL 12: deactivation erased the historic comped orders';
  end if;
  select count(*) into v_wrong from public.orders where is_comped and total <> 0;
  if v_wrong <> 0 then
    raise exception 'FAIL 12: % comped order(s) carry a total', v_wrong;
  end if;
  select count(*) into v_wrong from public.orders where not is_comped and comp_discount_amount <> 0;
  if v_wrong <> 0 then
    raise exception 'FAIL 12: % paying order(s) carry a comp amount', v_wrong;
  end if;
  raise notice 'case 12 ok — % historic comped order(s) intact and still free', v_comped;
end $$;

-- A newly placed order is no longer comped.
select set_config('test.auth_uid', :member, true);
select set_config('test.is_admin', 'false', true);
do $$
declare o public.orders;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  if o.is_comped or o.total <> 32 then
    raise exception 'FAIL 12b: a deactivated member still eats free (comped=%, total=%)',
      o.is_comped, o.total;
  end if;
  raise notice 'case 12b ok — deactivation stops the next order immediately';
end $$;

-- ============================================================================
-- 13. Account deletion removes the membership and KEEPS the audit
-- ============================================================================
-- The erasure pipeline ends in auth.admin.deleteUser, so this is the real
-- chain: auth.users -> profiles (cascade) -> comp_members (cascade), while
-- comp_member_audit.target_user_id is SET NULL so the money trail survives the
-- person. Asserted rather than assumed, because a membership that outlived its
-- account would be a dormant free-food grant nobody can see.
do $$
declare v_members integer; v_audit integer; v_orphaned integer;
begin
  select count(*) into v_audit from public.comp_member_audit
   where target_user_id = '00000000-0000-0000-0000-0000000ca004';
  if v_audit = 0 then
    raise exception 'FAIL 13: the fixture wrote no audit row to survive';
  end if;

  delete from auth.users where id = '00000000-0000-0000-0000-0000000ca004';

  select count(*) into v_members from public.comp_members
   where profile_id = '00000000-0000-0000-0000-0000000ca004';
  if v_members <> 0 then
    raise exception 'FAIL 13: % membership row(s) outlived the account', v_members;
  end if;

  select count(*) into v_orphaned from public.comp_member_audit
   where reason in ('briefly a member', 'left the company') and target_user_id is null;
  if v_orphaned <> v_audit then
    raise exception 'FAIL 13: % of % audit rows survived the deletion', v_orphaned, v_audit;
  end if;

  raise notice 'case 13 ok — % audit row(s) survived a deleted account', v_orphaned;
end $$;

-- ============================================================================
-- 14-20 cover 20260827100000: a comp can now be attached to a PHONE NUMBER
-- before that person has an account, and binds itself when Auth confirms it.
--
-- Cases 1-13 above are UNCHANGED and still pass, which is the load-bearing
-- evidence for this design: the money path (place_order,
-- compute_order_snapshot, insert_order_from_snapshot) was not touched at all.
-- A pending comp is invisible to pricing because it has no profile_id, and an
-- account with no orders cannot be charged wrongly.
-- ============================================================================
\set newbie    '''00000000-0000-0000-0000-0000000ca005'''
\set signup    '''00000000-0000-0000-0000-0000000ca006'''
\set withdrawn '''00000000-0000-0000-0000-0000000ca007'''

-- ============================================================================
-- 14. Comp a number that belongs to nobody yet
-- ============================================================================
select set_config('test.auth_uid', :admin, true);
select set_config('test.is_admin', 'true', true);
do $$
declare v jsonb; v_row public.comp_members; v_audit public.comp_member_audit;
begin
  v := public.admin_set_comp_member(null::uuid, true,
        'guest of the owner, has not signed up yet', '0500000009');

  if not (v ->> 'pending')::boolean then
    raise exception 'FAIL 14: a number with no account did not come back pending';
  end if;
  if (v ->> 'phone_e164') <> '+966500000009' then
    raise exception 'FAIL 14: stored phone is %, expected canonical +966500000009',
      v ->> 'phone_e164';
  end if;

  select * into v_row from public.comp_members where phone_e164 = '+966500000009';
  if v_row.id is null then
    raise exception 'FAIL 14: no membership row was created';
  end if;
  if v_row.profile_id is not null then
    raise exception 'FAIL 14: a pending row was linked to an account that does not exist';
  end if;
  if not v_row.is_active then
    raise exception 'FAIL 14: the pending row is not active';
  end if;

  -- The audit must still answer "who was made free, and why" when there is no
  -- account to name.
  select * into v_audit from public.comp_member_audit
   where target_phone = '+966500000009';
  if v_audit.id is null then
    raise exception 'FAIL 14: the audit did not record the number';
  end if;
  if v_audit.target_user_id is not null then
    raise exception 'FAIL 14: the audit named an account that does not exist';
  end if;

  raise notice 'case 14 ok — an unregistered number can be comped, and reads as pending';
end $$;

-- ============================================================================
-- 15. One number, five shapes, one row — and a non-mobile is refused
-- ============================================================================
-- This is the defect that started the whole change: the admin panel searched
-- `+966555820667` against raw stored strings and found nothing, because live
-- data holds four `9665…` and one `+9665…`. Canonicalising on the way IN is
-- what makes the shape stop mattering.
do $$
declare v_shape text; v_refused boolean; v_n integer;
begin
  foreach v_shape in array array[
    '+966500000009', '966500000009', '00966500000009', '0500000009', '500000009'
  ] loop
    v_refused := false;
    begin
      perform public.admin_set_comp_member(null::uuid, true, 'the same number again', v_shape);
    exception when sqlstate 'P0001' then
      v_refused := true;   -- "already comped" — it resolved to the SAME row
    end;
    if not v_refused then
      raise exception 'FAIL 15: shape % was treated as a different number', v_shape;
    end if;
  end loop;

  select count(*) into v_n from public.comp_members where phone_e164 = '+966500000009';
  if v_n <> 1 then
    raise exception 'FAIL 15: % rows exist for one number', v_n;
  end if;

  -- A landline is not a sign-in identity, so comping one could never take
  -- effect. Refused at the door rather than stored as a string nothing matches.
  v_refused := false;
  begin
    perform public.admin_set_comp_member(null::uuid, true, 'a landline', '0112345678');
  exception when sqlstate '22023' then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL 15: a landline was accepted as a comped number';
  end if;

  raise notice 'case 15 ok — every shape of one number is one row; a non-mobile is refused';
end $$;

-- ============================================================================
-- 16. THE REQUIREMENT: they sign up, and the food is free
-- ============================================================================
-- "when the number of someone in comped customers enters the app, they should
-- see the prices as 0" — owner, 2026-08-27.
insert into auth.users (id, phone) values (:newbie, '966500000009');

do $$
declare v_row public.comp_members;
begin
  -- Signed up, but the OTP has not been confirmed yet. Nothing may bind on an
  -- unproven number.
  select * into v_row from public.comp_members where phone_e164 = '+966500000009';
  if v_row.profile_id is not null then
    raise exception 'FAIL 16: the comp bound to an UNCONFIRMED number';
  end if;
end $$;

-- The OTP lands. This is the only moment the number is trustworthy.
update auth.users set phone_confirmed_at = now() where id = :newbie;

do $$
declare v_row public.comp_members;
begin
  select * into v_row from public.comp_members where phone_e164 = '+966500000009';
  if v_row.profile_id is null then
    raise exception 'FAIL 16: the comp did not bind when the OTP was confirmed';
  end if;
  if v_row.profile_id <> '00000000-0000-0000-0000-0000000ca005' then
    raise exception 'FAIL 16: the comp bound to % instead', v_row.profile_id;
  end if;
end $$;

select set_config('test.auth_uid', :newbie, true);
select set_config('test.is_admin', 'false', true);
do $$
declare o public.orders;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);

  if o.total <> 0 then
    raise exception 'FAIL 16: the newly-claimed member was charged %', o.total;
  end if;
  if not o.is_comped then
    raise exception 'FAIL 16: the order is not marked comped';
  end if;
  if o.subtotal <> 32 then
    raise exception 'FAIL 16: subtotal is %, expected the real goods value 32', o.subtotal;
  end if;
  if o.comp_discount_amount <> 32 then
    raise exception 'FAIL 16: comp_discount_amount is %, expected 32', o.comp_discount_amount;
  end if;
  if o.payment_status <> 'paid' then
    raise exception 'FAIL 16: payment_status is %, expected paid', o.payment_status;
  end if;

  raise notice 'case 16 ok — comped BEFORE signing up, free on the first order after it';
end $$;

-- ============================================================================
-- 17. The other Auth path: a signup that arrives already confirmed
-- ============================================================================
select set_config('test.auth_uid', :admin, true);
select set_config('test.is_admin', 'true', true);
select public.admin_set_comp_member(null::uuid, true, 'second guest', '0500000006');

insert into auth.users (id, phone, phone_confirmed_at)
values (:signup, '+966500000006', now());

do $$
declare v_row public.comp_members;
begin
  select * into v_row from public.comp_members where phone_e164 = '+966500000006';
  if v_row.profile_id <> '00000000-0000-0000-0000-0000000ca006' then
    raise exception 'FAIL 17: handle_new_user did not claim a pre-confirmed number (profile_id %)',
      v_row.profile_id;
  end if;
  raise notice 'case 17 ok — a signup that arrives pre-confirmed claims on insert';
end $$;

-- ============================================================================
-- 18. A withdrawn invitation stays withdrawn
-- ============================================================================
-- The number is comped, then switched off BEFORE anybody signs up. When it
-- finally does sign up the row must bind (so the decision is not silently
-- reversible by re-adding) but must NOT be active.
select public.admin_set_comp_member(null::uuid, true,  'invited to eat free', '0500000007');
select public.admin_set_comp_member(null::uuid, false, 'invitation withdrawn before they joined', '0500000007');

insert into auth.users (id, phone, phone_confirmed_at)
values (:withdrawn, '966500000007', now());

do $$
declare v_row public.comp_members;
begin
  select * into v_row from public.comp_members where phone_e164 = '+966500000007';
  if v_row.profile_id is null then
    raise exception 'FAIL 18: a deactivated number did not bind to its account';
  end if;
  if v_row.is_active then
    raise exception 'FAIL 18: signing up REACTIVATED a withdrawn comp';
  end if;
end $$;

select set_config('test.auth_uid', :withdrawn, true);
select set_config('test.is_admin', 'false', true);
do $$
declare o public.orders;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  if o.is_comped or o.total = 0 then
    raise exception 'FAIL 18: a withdrawn invitation still ate free (total %, comped %)',
      o.total, o.is_comped;
  end if;
  raise notice 'case 18 ok — a comp withdrawn before signup does not revive on signup';
end $$;

-- ============================================================================
-- 19. Pending rows are nobody's business but the admin's
-- ============================================================================
-- A pending row holds somebody else's phone number. The own-row RLS policy
-- filters on `profile_id = auth.uid()`, which NULL never satisfies — but that
-- is worth pinning, because a policy written as `profile_id is not distinct
-- from auth.uid()` would leak every pending number to every customer.
select set_config('test.auth_uid', :admin, true);
select set_config('test.is_admin', 'true', true);
select public.admin_set_comp_member(null::uuid, true, 'still pending, for case 19', '0500000005');

select set_config('test.auth_uid', :member, true);
select set_config('test.is_admin', 'false', true);
set local role authenticated;
do $$
declare v_n integer; v_leaked boolean := false;
begin
  select count(*) into v_n from public.comp_members where profile_id is null;
  if v_n <> 0 then
    raise exception 'FAIL 19: a customer can see % pending comp row(s)', v_n;
  end if;

  -- The number itself is not in the customer-facing column grant either.
  begin
    perform cm.phone_e164 from public.comp_members cm limit 1;
    v_leaked := true;
  exception when insufficient_privilege then
    null;   -- 42501, as intended
  end;
  if v_leaked then
    raise exception 'FAIL 19: a customer can read phone_e164 off comp_members';
  end if;

  raise notice 'case 19 ok — pending comps and their numbers are invisible to customers';
end $$;
reset role;

-- ============================================================================
-- 20. Deleting an account takes the number with it
-- ============================================================================
-- 20260827110000. The membership has no FK when it is pending, and the audit
-- deliberately outlives the account — so the number is the one field that could
-- re-identify a customer who asked to be forgotten.
do $$
declare v_res jsonb; v_members integer; v_phones integer; v_audit integer;
begin
  v_res := public.anonymize_account_data('00000000-0000-0000-0000-0000000ca005');

  select count(*) into v_members from public.comp_members
   where profile_id = '00000000-0000-0000-0000-0000000ca005';
  if v_members <> 0 then
    raise exception 'FAIL 20: % membership row(s) survived erasure', v_members;
  end if;

  select count(*) into v_phones from public.comp_members
   where phone_e164 = '+966500000009';
  if v_phones <> 0 then
    raise exception 'FAIL 20: the erased number is still comped';
  end if;

  select count(*) into v_audit from public.comp_member_audit
   where target_phone = '+966500000009';
  if v_audit <> 0 then
    raise exception 'FAIL 20: % audit row(s) still carry the erased number', v_audit;
  end if;

  -- The trail itself must remain: erasure removes the identifier, not the
  -- record that somebody was comped and why.
  select count(*) into v_audit from public.comp_member_audit
   where reason = 'guest of the owner, has not signed up yet';
  if v_audit <> 1 then
    raise exception 'FAIL 20: erasure destroyed the audit row instead of the number';
  end if;

  if (v_res ->> 'comp_memberships_deleted')::integer < 1 then
    raise exception 'FAIL 20: the summary did not report the membership deletion';
  end if;

  raise notice 'case 20 ok — erasure removes the comp and scrubs the number, keeping the trail';
end $$;

do $$ begin raise notice 'comp_members_test: all assertions passed'; end $$;

rollback;
