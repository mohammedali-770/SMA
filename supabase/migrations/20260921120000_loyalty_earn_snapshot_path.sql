-- 20260921120000_loyalty_earn_snapshot_path.sql
--
-- WHAT: the SECOND order-creation path stops crediting loyalty points at
-- creation. `insert_order_from_snapshot` now writes `earn_pending` exactly as
-- `place_order` has done since `20260918120000`.
--
-- WHY THIS FILE EXISTS AT ALL. `20260918120000` closed the audit finding on
-- `place_order` and its own header said it redefined "two functions" -- which it
-- did, but the second was `admin_set_order_status`, not the other creation path.
-- This repository has TWO functions that insert an order and move a customer's
-- loyalty balance:
--
--   * public.place_order(...)                    -- cash / direct checkout
--   * public.insert_order_from_snapshot(...)     -- checkout-session path
--
-- The second was left untouched and still carried the exact line the audit
-- finding is about:
--
--     set loyalty_points = greatest(0, v_bal_start - v_redeemed + v_earned)
--
-- plus a real `'earn'` ledger row, written at CREATION. The record in
-- `docs/MIGRATIONS.md` that says `20260918120000` closed the money path for both
-- creation paths was therefore WRONG, and this change corrects that claim as
-- well as the code. (CLAUDE.md §15: verify the artifact, not your picture of it.
-- The picture here was my own, and it was wrong.)
--
-- WHY IT IS NOT AN OPEN HOLE TODAY, stated so the urgency is not overclaimed:
--
--   * `insert_order_from_snapshot` is `service_role`-only and reachable only
--     from `begin_checkout_session` / `complete_checkout_session`.
--   * The ONLINE arm of that path requires a verified payment before the order
--     is inserted, and online payment is disabled under the CLAUDE.md §6 freeze.
--     Measured live before writing this: 3 online orders, all `pending`, none
--     ever paid.
--   * The other arm is the ZERO-TOTAL path, which exists for comped customers.
--     A comped order earns 0 points, so it writes no ledger row at all.
--
-- So nothing mints points through here right now. The defect returns the moment
-- online payment is enabled -- which is a live goal, not a hypothetical -- and
-- an order inserted `paid` would credit spendable points before anyone had
-- collected it. Delivery is the settlement signal for collection, and that is
-- what `20260918120000` made the balance wait for.
--
-- WHAT DOES NOT CHANGE:
--   * REDEMPTION still debits at creation, for the same reason as in
--     `place_order`: the customer is spending points for a discount on THIS
--     order, so deferring it would let the same points be spent twice.
--   * No existing row is rewritten. Points already in customer balances stay.
--   * The promotion and the cancellation reversal are NOT touched. Both already
--     read the ledger (`type = 'earn_pending'` to promote, `type = 'earn'` to
--     reverse), so they pick up snapshot-path orders with no change at all.
--   * No payment code. This file reads no payment field and writes none.
--
-- SHAPE: redefine ONE function. The body is derived from
-- `20260826100000_comp_order_totals.sql` -- the only current definition, and
-- verified byte-identical to the live body (`prosrc` md5
-- `da8c457bade050e0a0280a88061d0304`, 4 911 chars) -- by three anchored
-- substitutions, each asserted to match exactly once. Nothing retyped.
--
-- NO DEPLOY IMPLIED: the signature is unchanged, so existing callers bind to the
-- new body.

-- ---------------------------------------------------------------------------
-- 0. Refuse to apply out of order
-- ---------------------------------------------------------------------------
-- This file assumes `20260918120000` has landed: it writes `earn_pending`, which
-- that migration's widened CHECK admits and whose promotion path it installs.
-- Applied first, this would create rows the CHECK rejects -- or, worse, rows
-- nothing ever promotes. Assert both halves rather than trusting the order.
do $$
declare
  v_src text;
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.loyalty_transactions'::regclass
       and conname  = 'loyalty_transactions_type_check'
       and pg_get_constraintdef(oid) like '%earn_pending%'
  ) then
    raise exception
      'loyalty_transactions_type_check does not admit earn_pending: apply 20260918120000 first';
  end if;

  select prosrc into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_src is null then
    raise exception 'place_order not found';
  end if;
  if v_src not like '%, ''earn_pending'', v_points_earned,%' then
    raise exception
      'place_order does not defer earning: apply 20260918120000 first';
  end if;

  select prosrc into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_set_order_status';
  if v_src is null then
    raise exception 'admin_set_order_status not found';
  end if;
  if v_src not like '%type = ''earn_pending''%' then
    raise exception
      'admin_set_order_status has no promotion path: apply 20260918120000 first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. insert_order_from_snapshot -- earning becomes a promise here too
-- ---------------------------------------------------------------------------
create or replace function public.insert_order_from_snapshot(
  p_customer         uuid,
  p_snapshot         jsonb,
  p_payment_method   text,
  p_payment_status   text,
  p_idempotency_key  uuid default null,
  p_payment_provider text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_item     jsonb;
  v_mod      jsonb;
  v_item_id  uuid;
  v_loyalty_on       boolean := coalesce((p_snapshot->>'loyalty_on')::boolean, false);
  v_redeemed         integer := coalesce((p_snapshot->>'loyalty_points_redeemed')::int, 0);
  v_earned           integer := coalesce((p_snapshot->>'loyalty_points_earned')::int, 0);
  v_coupon_raw       text    := p_snapshot->>'coupon_code_raw';
  v_discount         numeric(10,2) := coalesce((p_snapshot->>'discount_amount')::numeric, 0);
  v_bal_start        integer;
  v_bal_new          integer;
begin
  insert into public.orders (
    customer_id, customer_name, customer_phone,
    branch_id, branch_name_en, branch_name_ar,
    status, order_type, subtotal, delivery_fee, discount_amount,
    loyalty_discount_amount, vat_amount, total, payment_status, payment_method,
    payment_provider, paid_at,
    coupon_code, notes, address_id, address_snapshot,
    loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded_at,
    idempotency_key, is_comped, comp_discount_amount
  ) values (
    p_customer, p_snapshot->>'customer_name', p_snapshot->>'customer_phone',
    (p_snapshot->>'branch_id')::uuid, p_snapshot->>'branch_name_en', p_snapshot->>'branch_name_ar',
    'received', (p_snapshot->>'order_type')::public.order_type,
    (p_snapshot->>'subtotal')::numeric, (p_snapshot->>'delivery_fee')::numeric, v_discount,
    (p_snapshot->>'loyalty_discount_amount')::numeric, (p_snapshot->>'vat_amount')::numeric,
    (p_snapshot->>'total')::numeric, p_payment_status::public.payment_status, p_payment_method,
    p_payment_provider,
    case when p_payment_status = 'paid' then now() else null end,
    p_snapshot->>'coupon_code',
    p_snapshot->>'notes',
    nullif(p_snapshot->>'address_id','')::uuid,
    case when jsonb_typeof(p_snapshot->'address_snapshot') = 'object' then p_snapshot->'address_snapshot' else null end,
    v_earned, v_redeemed,
    case when v_loyalty_on and (v_redeemed > 0 or v_earned > 0) then now() else null end,
    p_idempotency_key,
    -- Straight from the snapshot: the comp was decided when the cart was
    -- priced, not re-derived here after the customer has gone.
    coalesce((p_snapshot->>'is_comped')::boolean, false),
    coalesce((p_snapshot->>'comp_discount_amount')::numeric, 0)
  )
  returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_snapshot->'items')
  loop
    insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total, note,
                                    variant_id, variant_name_en, variant_name_ar)
    values (v_order.id, (v_item->>'product_id')::uuid, v_item->>'name_en', v_item->>'name_ar',
            (v_item->>'unit_price')::numeric, (v_item->>'quantity')::int, (v_item->>'line_total')::numeric,
            public.order_note_normalized(v_item->>'note'),
            nullif(v_item->>'variant_id','')::uuid,
            nullif(v_item->>'variant_name_en',''),
            nullif(v_item->>'variant_name_ar',''))
    returning id into v_item_id;

    for v_mod in select value from jsonb_array_elements(coalesce(v_item->'modifiers','[]'::jsonb))
    loop
      insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
      values (v_item_id, (v_mod->>'modifier_id')::uuid, v_mod->>'name_en', v_mod->>'name_ar', (v_mod->>'price')::numeric);
    end loop;
  end loop;

  -- Post-payment: never raise on the coupon (the discount was validated and the
  -- customer already paid); over-limit redemptions surface in reporting instead.
  if v_discount > 0 and v_coupon_raw is not null then
    update public.coupons
      set usage_count = usage_count + 1
      where code = upper(trim(v_coupon_raw));
  end if;

  if v_loyalty_on and (v_redeemed > 0 or v_earned > 0) then
    select coalesce(loyalty_points, 0) into v_bal_start from public.profiles where id = p_customer for update;
    v_redeemed := least(v_redeemed, v_bal_start);
    update public.profiles
      -- EARNING NO LONGER CREDITS HERE, exactly as in place_order since
      -- 20260918120000. Redemption still debits: the customer is spending
      -- points for a discount on THIS order, so deferring it would let the
      -- same points be spent twice.
      set loyalty_points = greatest(0, v_bal_start - v_redeemed)
      where id = p_customer
      returning loyalty_points into v_bal_new;
    if v_redeemed > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      -- v_bal_new no longer includes the earn, so it IS the post-redemption
      -- balance. Subtracting v_earned here would now double-count.
      values (p_customer, v_order.id, 'redeem', -v_redeemed, v_bal_new,
              'Redeemed on order ' || v_order.order_number, p_customer);
      update public.orders set loyalty_points_redeemed = v_redeemed where id = v_order.id;
    end if;
    if v_earned > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      -- 'earn_pending', not 'earn': recorded, visible, and NOT in the
      -- spendable balance. admin_set_order_status promotes it on delivery,
      -- and only for a cash order or an online order already marked paid.
      values (p_customer, v_order.id, 'earn_pending', v_earned, v_bal_new,
              'Pending on order ' || v_order.order_number || ' (credited on delivery)', p_customer);
    end if;
  end if;

  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Self-verification
-- ---------------------------------------------------------------------------
-- `create or replace` preserves grants, but this function's whole containment is
-- that only `service_role` can call it -- so that is asserted rather than
-- assumed. The body assertions are the ones that matter: a plpgsql body is not
-- name-resolved at creation, and a transcription slip in an inline apply would
-- be silent.
do $$
declare
  v_src   text;
  v_count integer;
  v_oid   oid;
begin
  select count(*) into v_count from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'insert_order_from_snapshot';
  if v_count <> 1 then
    raise exception 'expected exactly 1 insert_order_from_snapshot overload, found %', v_count;
  end if;

  select prosrc into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'insert_order_from_snapshot';

  -- (a) The defect is gone: the earn no longer reaches the balance.
  if v_src like '%v_bal_start - v_redeemed + v_earned%' then
    raise exception 'insert_order_from_snapshot still credits the earn at creation';
  end if;

  -- (b) And no `earn` ledger row is written here any more. Anchored on the
  --     argument list, not on the bare word: the explanatory comments in the
  --     body legitimately contain 'earn'.
  if v_src like '%, ''earn'', v_earned,%' then
    raise exception 'insert_order_from_snapshot still writes a spendable earn row';
  end if;

  -- (c) The promise IS written, exactly once, in the shape the promotion reads.
  if (length(v_src) - length(replace(v_src, ', ''earn_pending'', v_earned,', '')))
     / length(', ''earn_pending'', v_earned,') <> 1 then
    raise exception 'expected exactly one earn_pending ledger write';
  end if;

  -- (d) The redeem row's balance_after no longer subtracts an earn that is no
  --     longer in the balance. Getting this wrong under-reports the customer's
  --     balance in their own transaction history.
  if v_src like '%v_bal_new - v_earned%' then
    raise exception 'redeem balance_after still subtracts the earn';
  end if;

  -- (e) Redemption still debits. If this ever stops being true the same points
  --     can be spent twice, which is a worse defect than the one being fixed.
  if v_src not like '%v_bal_start - v_redeemed%' then
    raise exception 'insert_order_from_snapshot no longer debits redemption';
  end if;

  -- (f) Containment unchanged.
  select p.oid into v_oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'insert_order_from_snapshot';

  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE')
  then
    raise exception 'insert_order_from_snapshot is reachable by a client role';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'service_role can no longer execute insert_order_from_snapshot';
  end if;
end $$;
