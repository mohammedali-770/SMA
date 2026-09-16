-- 20260922120000_orders_comp_columns_customer_grant.sql
--
-- FIXES A LIVE CUSTOMER-FACING OUTAGE. "My Orders" and the post-order receipt
-- have been failing with "something went wrong" for every client built after
-- 2026-08-26, on every channel.
--
-- WHAT BREAKS
-- -----------
-- `authenticated` holds COLUMN-LEVEL select grants on `public.orders` — a
-- deliberate allowlist, which is why `order_number`, `customer_name`,
-- `customer_phone`, `coupon_code` and the operational sync columns are withheld.
-- A column-level grant does NOT extend to columns added later.
--
-- `20260826100000_comp_order_totals.sql` added `orders.is_comped` and
-- `orders.comp_discount_amount` and granted neither. The same day, #269 added
-- both to the customer read contract in `apps/mobile/src/lib/orderSelect.ts`.
-- So the client has been asking for two columns it cannot read ever since, and
-- PostgREST refuses the WHOLE query:
--
--   select id, is_comped, comp_discount_amount from public.orders limit 1;
--   -- 42501: permission denied for table orders
--
-- while the same select without those two columns succeeds. Measured live on
-- 2026-09-16, both ways round.
--
-- WHY IT WENT UNNOTICED FOR THREE WEEKS
-- -------------------------------------
-- The only iOS build in TestFlight was 1.0.0 (22), built 2026-08-25 — one day
-- BEFORE the client change, so its bundle does not ask for the columns. Build 23
-- was refused by App Store Connect and never installable. Build 24, 2026-09-16,
-- is the first iOS binary anyone has run that contains the change, and it failed
-- on the first order placed through it.
--
-- The web channel is NOT so lucky: `/app` is the Expo web export of the same
-- source, and the deployed bundle was confirmed to contain the two columns, so
-- live web customers have been hitting this.
--
-- WHY A GRANT RATHER THAN A CLIENT CHANGE
-- ---------------------------------------
-- These two columns are legitimately the customer's own business: whether their
-- order was comped, and by how much. The receipt should say so. A grant also
-- reaches every channel the moment it applies — web and both binaries — whereas
-- removing the columns from the client would need a new build per platform and
-- would hide information the customer is entitled to.
--
-- THIS DOES NOT WIDEN ROW ACCESS. RLS is enabled on `public.orders` and
-- `orders_select_own_or_staff` already scopes SELECT for `authenticated`; a
-- column grant cannot bypass a row policy. Verified before writing this.
--
-- `anon` is deliberately NOT granted. It cannot select `orders.total` either —
-- anonymous callers have no business reading orders at all — and adding these
-- two would be the first crack in that.
--
-- No function is redefined, so the money-path pair is untouched and NO DEPLOY IS
-- IMPLIED.

begin;

grant select (is_comped, comp_discount_amount) on public.orders to authenticated;

-- Self-verification. Asserts the exact regression this file exists for, and the
-- two boundaries it must not move.
do $$
declare
  v_missing text;
  v_anon_leak text;
begin
  -- 1. Every column of the customer read contract must be selectable by
  --    `authenticated`. This list is a SNAPSHOT of
  --    apps/mobile/src/lib/orderSelect.ts (CUSTOMER_ORDER_COLUMNS) as it stood
  --    when this file was written, and it stays frozen: a migration is history.
  --    A column the customer legitimately gains later must be granted by a NEW
  --    forward migration, never by editing this one.
  --
  --    THE LIVING CONTRACT IS supabase/tests/order_read_contracts_test.sql
  --    CASE 1, which reads information_schema.column_privileges after the whole
  --    chain has replayed and therefore sees the CUMULATIVE grant.
  --    apps/mobile/src/lib/orderSelectGrantParity.test.ts ties that suite's
  --    expectation to CUSTOMER_ORDER_COLUMNS, and holds this file only to the
  --    weaker rule that it may not grant a column the contract does not carry.
  select string_agg(c, ', ')
    into v_missing
  from unnest(array[
    'id','status','order_type','created_at','branch_id','branch_name_en','branch_name_ar',
    'subtotal','delivery_fee','discount_amount','loyalty_discount_amount','vat_amount','total',
    'loyalty_points_earned','is_comped','comp_discount_amount','payment_status','payment_method',
    'notes','lazywait_order_number','lazywait_sync_state','lazywait_ref','sync_blocked_reason',
    'sync_next_attempt_at','pos_create_attempted_at','pos_customer_retry_count','refund_state'
  ]) as c
  where not has_column_privilege('authenticated', 'public.orders', c, 'SELECT');

  if v_missing is not null then
    raise exception 'customer order columns still not selectable by authenticated: %', v_missing;
  end if;

  -- 2. The withheld set must stay withheld. These are the columns the allowlist
  --    exists to keep away from customers.
  select string_agg(c, ', ')
    into v_anon_leak
  from unnest(array[
    'order_number','customer_id','customer_name','customer_phone','coupon_code',
    'address_snapshot','idempotency_key','sync_last_error'
  ]) as c
  where has_column_privilege('authenticated', 'public.orders', c, 'SELECT');

  if v_anon_leak is not null then
    raise exception 'internal-only order columns became selectable by authenticated: %', v_anon_leak;
  end if;

  -- 3. `anon` must not have gained anything. It holds no select on orders at all.
  if has_column_privilege('anon', 'public.orders', 'is_comped', 'SELECT')
     or has_column_privilege('anon', 'public.orders', 'comp_discount_amount', 'SELECT') then
    raise exception 'anon gained select on the comp columns';
  end if;

  -- 4. RLS must still be on, or a column grant would be the only thing between
  --    one customer and another's orders.
  if not (select relrowsecurity from pg_class where oid = 'public.orders'::regclass) then
    raise exception 'RLS is not enabled on public.orders';
  end if;

  raise notice 'orders comp-column grant verified';
end $$;

commit;
