-- ============================================================================
-- Loyalty earning is promoted at SETTLEMENT, not at order creation.
--
-- Runs against a THROWAWAY Postgres with the whole migration chain applied
-- (`.github/sql-ci/run.sh`). Every case RAISES EXCEPTION on failure; a clean run
-- prints one NOTICE and commits nothing.
--
-- WHY THIS SUITE EXISTS SEPARATELY. `20260918120000` moves the credit from
-- `place_order` to the `delivered` transition, and the first version of it
-- credited ANY delivered order — including an online one that was never paid.
-- Review caught that (#372), and the reason it survived authoring is that the
-- change was covered only by edits to neighbouring suites. The property is now
-- tested on its own, with the online case first among equals.
--
-- THE CENTRAL ASYMMETRY, since it is the thing a future edit will get wrong:
-- delivery is the settlement signal for CASH (handing food over means it was
-- paid for) and is NOT one for ONLINE (staff can advance an unpaid online order
-- past a confirm dialog — a warning, not a block). So online additionally
-- requires `payment_status = 'paid'`.
--
-- Covers:
--   1. A cash order records `earn_pending` and does NOT move the balance.
--   2. Delivery promotes it to `earn` and credits exactly once.
--   3. Promotion is idempotent across a repeated `delivered` transition.
--   4. An ONLINE order that is still `pending` credits NOTHING on delivery.
--   5. An online order paid BEFORE delivery credits normally — and paying
--      AFTER delivery is too late, which is a real consequence rather than an
--      oversight, and is asserted rather than left to be discovered.
--   6. A NULL payment_method behaves as cash, not as online.
--   7. Cancelling before delivery credits nothing and leaves no `earn` row.
-- ============================================================================
begin;

\set eater  '''0f000000-0000-0000-0000-000000000001'''
\set admin  '''0f000000-0000-0000-0000-0000000ad999'''
\set branch '''b0000000-0000-0000-0000-000000000001'''

insert into auth.users (id, email) values
  (:eater, 'settle-eater@x'),
  (:admin, 'settle-admin@x');

insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:eater, 'customer', 'Settle Eater', '+966500000201', 0),
  (:admin, 'admin',    'Settle Admin', '+966500000202', 0)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number,
  loyalty_points = excluded.loyalty_points;

-- Cash by default; the online cases below set the columns directly, because
-- driving a real online order would mean a payment attempt.
update public.app_settings
   set loyalty_enabled = true,
       min_points_to_redeem = 0,
       cash_payment_enabled = true,
       online_payment_enabled = false,
       default_payment_method = 'cash',
       loyalty_pickup_only = true
 where id = true;

create temp table t_ctx (label text primary key, order_id uuid);

-- ============================================================================
-- CASE 1 — placement records a PENDING earn and moves no balance.
-- ============================================================================
select set_config('test.auth_uid', :eater, true);
select set_config('test.is_admin', 'false', true);

do $$
declare o public.orders; v_bal integer;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);
  insert into t_ctx values ('cash', o.id);

  if o.loyalty_points_earned <> 64 then
    raise exception 'CASE 1: order says it earned %, expected 64', o.loyalty_points_earned; end if;
  if not exists (select 1 from public.loyalty_transactions
                 where order_id = o.id and type = 'earn_pending' and points = 64) then
    raise exception 'CASE 1: no earn_pending ledger row'; end if;
  if exists (select 1 from public.loyalty_transactions where order_id = o.id and type = 'earn') then
    raise exception 'CASE 1: an earn row was written at creation — the whole point is that it is not'; end if;

  select loyalty_points into v_bal from public.profiles where id = o.customer_id;
  if v_bal <> 0 then
    raise exception 'CASE 1: balance moved to % at creation, expected 0', v_bal; end if;

  raise notice 'CASE 1 ok — pending at creation, balance untouched';
end $$;

-- ============================================================================
-- CASE 2-3 — delivery promotes exactly once, and repeating it changes nothing.
-- ============================================================================
do $$
declare v_order uuid; v_bal integer; v_rows integer;
begin
  select order_id into v_order from t_ctx where label = 'cash';
  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);

  perform public.admin_set_order_status(v_order, 'preparing');
  perform public.admin_set_order_status(v_order, 'ready');

  select loyalty_points into v_bal from public.profiles
   where id = (select customer_id from public.orders where id = v_order);
  if v_bal <> 0 then
    raise exception 'CASE 2: balance moved to % before delivery', v_bal; end if;

  perform public.admin_set_order_status(v_order, 'delivered');

  select loyalty_points into v_bal from public.profiles
   where id = (select customer_id from public.orders where id = v_order);
  if v_bal <> 64 then
    raise exception 'CASE 2: balance is % after delivery, expected 64', v_bal; end if;
  if not exists (select 1 from public.loyalty_transactions
                 where order_id = v_order and type = 'earn' and points = 64) then
    raise exception 'CASE 2: no earn row after delivery'; end if;

  -- CASE 3 — a repeated transition must not credit again.
  --
  -- NOTE WHAT DOES THE WORK HERE, because an earlier draft of this case was
  -- vacuous: `admin_set_order_status` returns at `if p_status = v_order.status`
  -- before it reaches the promotion at all, so this proves the EARLY RETURN,
  -- not the promotion's own `not exists ... type = 'earn'` guard. That second
  -- guard is defence in depth against a future caller that reaches the branch
  -- twice, and it is asserted at source level in CASE 3b rather than left to
  -- look tested by this call.
  perform public.admin_set_order_status(v_order, 'delivered');
  select count(*) into v_rows from public.loyalty_transactions
   where order_id = v_order and type = 'earn';
  select loyalty_points into v_bal from public.profiles
   where id = (select customer_id from public.orders where id = v_order);
  if v_rows <> 1 or v_bal <> 64 then
    raise exception 'CASE 3: repeating delivery gave % earn rows and balance %', v_rows, v_bal; end if;

  raise notice 'CASE 2-3 ok — credited once on delivery, repeat is a no-op';
end $$;

-- ============================================================================
-- CASE 3b — the promotion's OWN idempotence guard still exists.
--
-- Asserted at source level because the early return above makes it unreachable
-- from this suite. Deleting it would leave the property resting on one `if`.
-- ============================================================================
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_set_order_status';
  if v_src not like '%where order_id = v_order.id and type = ''earn''%' then
    raise exception 'CASE 3b: the promotion lost its own double-credit guard';
  end if;
  raise notice 'CASE 3b ok — the promotion still guards against a second credit';
end $$;

-- ============================================================================
-- CASE 4 — AN UNPAID ONLINE ORDER CREDITS NOTHING ON DELIVERY.
--
-- This is the review finding (#372). `LiveOrdersPanel` lets staff advance an
-- unpaid online order past a `window.confirm()`, and `admin_set_order_status`
-- used to look at neither payment field — so delivery alone minted spendable
-- points on an order nobody had paid for. `delivered` is terminal, so the
-- cancellation reversal cannot take them back afterwards.
-- ============================================================================
do $$
declare o public.orders; v_bal integer;
begin
  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-000000000001', true);
  perform set_config('test.is_admin', 'false', true);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  insert into t_ctx values ('online', o.id);

  -- Make it the online order this suite cannot place directly: settings keep
  -- online off so a payment attempt is never made, and the columns are what the
  -- promotion gate actually reads.
  update public.orders set payment_method = 'online', payment_status = 'pending'
   where id = o.id;

  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform public.admin_set_order_status(o.id, 'preparing');
  perform public.admin_set_order_status(o.id, 'ready');
  perform public.admin_set_order_status(o.id, 'delivered');

  if exists (select 1 from public.loyalty_transactions where order_id = o.id and type = 'earn') then
    raise exception 'CASE 4: an UNPAID online order minted points on delivery'; end if;
  if not exists (select 1 from public.loyalty_transactions
                 where order_id = o.id and type = 'earn_pending') then
    raise exception 'CASE 4: the pending earn was destroyed rather than withheld'; end if;

  select loyalty_points into v_bal from public.profiles where id = o.customer_id;
  if v_bal <> 64 then
    raise exception 'CASE 4: balance is % — an unpaid online order changed it (expected 64 from CASE 2)', v_bal; end if;

  raise notice 'CASE 4 ok — an unpaid online order credits nothing on delivery';
end $$;

-- ============================================================================
-- CASE 5 — an online order PAID BEFORE DELIVERY credits normally.
--
-- Without this the fix could be satisfied by a gate that never credits online
-- at all, which would be a different defect wearing the same green tick.
-- ============================================================================
do $$
declare o public.orders; v_bal integer;
begin
  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-000000000001', true);
  perform set_config('test.is_admin', 'false', true);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  update public.orders set payment_method = 'online', payment_status = 'paid' where id = o.id;

  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform public.admin_set_order_status(o.id, 'preparing');
  perform public.admin_set_order_status(o.id, 'ready');
  perform public.admin_set_order_status(o.id, 'delivered');

  if not exists (select 1 from public.loyalty_transactions
                 where order_id = o.id and type = 'earn' and points = 32) then
    raise exception 'CASE 5: a PAID online order did not credit on delivery'; end if;

  select loyalty_points into v_bal from public.profiles where id = o.customer_id;
  if v_bal <> 96 then
    raise exception 'CASE 5: balance is %, expected 96 (64 + 32)', v_bal; end if;

  raise notice 'CASE 5 ok — a paid online order credits on delivery';
end $$;

-- ============================================================================
-- CASE 5b — AND PAYING AFTER DELIVERY IS TOO LATE. Stated, not glossed.
--
-- This is a real consequence of gating on delivery, found by writing the test
-- and NOT by reasoning about it: `admin_set_order_status` returns early when
-- the status is unchanged, so once an order has been delivered there is no
-- second `delivered` transition to carry the promotion. An order that staff
-- force-delivered while unpaid therefore forfeits its points permanently, even
-- if the payment is recorded a minute later.
--
-- That is accepted rather than fixed here: the alternative is to promote from
-- the payment-confirmation path, which is frozen under CLAUDE.md §6. It is the
-- conservative direction — the customer never paid at the moment of delivery —
-- and it is asserted so a future change to the payment path finds it.
-- ============================================================================
do $$
declare v_order uuid; v_bal integer;
begin
  select order_id into v_order from t_ctx where label = 'online';   -- delivered while pending
  update public.orders set payment_status = 'paid' where id = v_order;

  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform public.admin_set_order_status(v_order, 'delivered');

  if exists (select 1 from public.loyalty_transactions where order_id = v_order and type = 'earn') then
    raise exception 'CASE 5b: paying after delivery credited retroactively — if that is now intended, update the comment above rather than this assertion'; end if;

  select loyalty_points into v_bal from public.profiles
   where id = (select customer_id from public.orders where id = v_order);
  if v_bal <> 96 then
    raise exception 'CASE 5b: balance is %, expected 96', v_bal; end if;

  raise notice 'CASE 5b ok — paying after delivery does not credit retroactively';
end $$;

-- ============================================================================
-- CASE 6 — a NULL payment_method behaves as cash, not as online.
--
-- The column is nullable text with no default and one legacy row carries NULL.
-- `is distinct from 'online'` is what keeps that row earning; `= 'cash'` would
-- silently deny points on an order whose method was never recorded.
-- ============================================================================
do $$
declare o public.orders; v_bal integer;
begin
  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-000000000001', true);
  perform set_config('test.is_admin', 'false', true);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  update public.orders set payment_method = null where id = o.id;

  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform public.admin_set_order_status(o.id, 'preparing');
  perform public.admin_set_order_status(o.id, 'ready');
  perform public.admin_set_order_status(o.id, 'delivered');

  if not exists (select 1 from public.loyalty_transactions
                 where order_id = o.id and type = 'earn' and points = 32) then
    raise exception 'CASE 6: a NULL-method order was treated as online and denied its points'; end if;

  select loyalty_points into v_bal from public.profiles where id = o.customer_id;
  if v_bal <> 128 then
    raise exception 'CASE 6: balance is %, expected 128 (64 + 32 + 32)', v_bal; end if;

  raise notice 'CASE 6 ok — NULL method earns like cash';
end $$;

-- ============================================================================
-- CASE 7 — cancelling before delivery credits nothing.
-- ============================================================================
do $$
declare o public.orders; v_bal_before integer; v_bal_after integer;
begin
  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-000000000001', true);
  perform set_config('test.is_admin', 'false', true);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);

  select loyalty_points into v_bal_before from public.profiles where id = o.customer_id;

  perform set_config('test.auth_uid', '0f000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform public.admin_set_order_status(o.id, 'cancelled');

  if exists (select 1 from public.loyalty_transactions where order_id = o.id and type = 'earn') then
    raise exception 'CASE 7: a cancelled order minted points'; end if;

  select loyalty_points into v_bal_after from public.profiles where id = o.customer_id;
  if v_bal_after <> v_bal_before then
    raise exception 'CASE 7: cancelling moved the balance from % to %', v_bal_before, v_bal_after; end if;

  raise notice 'CASE 7 ok — a cancelled order credits nothing';
end $$;

do $$ begin raise notice 'loyalty_earn_on_settlement_test: ALL CASES PASSED'; end $$;

rollback;
