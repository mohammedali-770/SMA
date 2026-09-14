-- ============================================================================
-- The SECOND order-creation path defers loyalty earning too.
--
-- Runs against a THROWAWAY Postgres with the whole migration chain applied
-- (`.github/sql-ci/run.sh`). Every case RAISES EXCEPTION on failure; a clean run
-- prints one NOTICE per case and commits nothing.
--
-- WHY THIS SUITE EXISTS SEPARATELY from `loyalty_earn_on_settlement_test.sql`.
-- That suite pins `place_order`. `20260918120000` closed the audit finding
-- there and left `insert_order_from_snapshot` — the checkout-session creation
-- path — still crediting spendable points at creation. The gap survived
-- authoring, review and apply because every test exercised the path that was
-- fixed. So the property is tested here on the path that was missed, and
-- CASE 6 asserts it of BOTH paths at once so the next divergence is caught by
-- a failing test rather than by reading the diff.
--
-- HOW THE PATH IS DRIVEN. `insert_order_from_snapshot` is `service_role`-only
-- and is reached in production from `begin_checkout_session` /
-- `complete_checkout_session`, which require a verified online payment. Rather
-- than fake a payment, these cases build a real snapshot with
-- `compute_order_snapshot` and call the function directly — the same two
-- arguments the session path passes, and the same code under test.
--
-- Covers:
--   1. Creation records `earn_pending`, writes no `earn`, moves no balance.
--   2. Delivery of a PAID online order promotes it and credits exactly once.
--   3. Redemption still debits AT CREATION, and the `redeem` row's
--      `balance_after` is the real post-redemption balance.
--   4. Cancelling before delivery credits nothing and refunds the redemption
--      in full.
--   5. A COMPED (zero-total) order writes no loyalty ledger row at all.
--   6. Source parity: neither creation path credits at creation, and both
--      write the `earn_pending` shape the promotion reads.
-- ============================================================================
begin;

\set eater  '''0e000000-0000-0000-0000-000000000001'''
\set spend  '''0e000000-0000-0000-0000-000000000002'''
\set comped '''0e000000-0000-0000-0000-000000000003'''
\set admin  '''0e000000-0000-0000-0000-0000000ad999'''
\set branch '''b0000000-0000-0000-0000-000000000001'''

insert into auth.users (id, email) values
  (:eater,  'snap-eater@x'),
  (:spend,  'snap-spend@x'),
  (:comped, 'snap-comped@x'),
  (:admin,  'snap-admin@x');

insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:eater,  'customer', 'Snap Eater',  '+966500000211', 0),
  (:spend,  'customer', 'Snap Spender','+966500000212', 500),
  (:comped, 'customer', 'Snap Comped', '+966500000213', 0),
  (:admin,  'admin',    'Snap Admin',  '+966500000214', 0)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number,
  loyalty_points = excluded.loyalty_points;

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
-- CASE 1 — the snapshot path records a PENDING earn and moves no balance.
--
-- This is the defect. Before this migration the same call added the points to
-- `profiles.loyalty_points` in the creation transaction and wrote a spendable
-- `earn` row, exactly as `place_order` did before `20260918120000`.
-- ============================================================================
do $$
declare
  v_snap  jsonb;
  v_order public.orders;
  v_bal   integer;
begin
  perform set_config('test.auth_uid', '0e000000-0000-0000-0000-000000000001', true);
  perform set_config('test.is_admin', 'false', true);

  v_snap := public.compute_order_snapshot(
    '0e000000-0000-0000-0000-000000000001'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);

  if (v_snap->>'loyalty_points_earned')::int <> 64 then
    raise exception 'CASE 1: snapshot says % points, expected 64',
      v_snap->>'loyalty_points_earned'; end if;

  -- 'paid' on purpose: this is the arm that will exist the moment online
  -- payment is enabled, and it is the arm that used to mint points.
  v_order := public.insert_order_from_snapshot(
    '0e000000-0000-0000-0000-000000000001'::uuid, v_snap, 'online', 'paid',
    gen_random_uuid(), 'test');
  insert into t_ctx values ('paid_online', v_order.id);

  if v_order.loyalty_points_earned <> 64 then
    raise exception 'CASE 1: order records % earned, expected 64',
      v_order.loyalty_points_earned; end if;

  if not exists (select 1 from public.loyalty_transactions
                 where order_id = v_order.id and type = 'earn_pending' and points = 64) then
    raise exception 'CASE 1: no earn_pending ledger row'; end if;
  if exists (select 1 from public.loyalty_transactions
             where order_id = v_order.id and type = 'earn') then
    raise exception 'CASE 1: a spendable earn row was written at creation — the whole point is that it is not'; end if;

  select loyalty_points into v_bal from public.profiles
   where id = '0e000000-0000-0000-0000-000000000001'::uuid;
  if v_bal <> 0 then
    raise exception 'CASE 1: balance moved to % at creation, expected 0', v_bal; end if;

  raise notice 'CASE 1 ok — snapshot path records a promise, not a credit';
end $$;

-- ============================================================================
-- CASE 2 — delivering that PAID online order promotes it, exactly once.
--
-- The promotion is `admin_set_order_status`'s and is not touched by this
-- migration; what is proved here is that a snapshot-path order reaches it in a
-- shape it understands. It would not have, had this file written `earn`.
-- ============================================================================
do $$
declare v_order uuid; v_bal integer; v_rows integer;
begin
  select order_id into v_order from t_ctx where label = 'paid_online';
  perform set_config('test.auth_uid', '0e000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);

  perform public.admin_set_order_status(v_order, 'preparing');
  perform public.admin_set_order_status(v_order, 'ready');

  select loyalty_points into v_bal from public.profiles
   where id = '0e000000-0000-0000-0000-000000000001'::uuid;
  if v_bal <> 0 then
    raise exception 'CASE 2: balance moved to % before delivery', v_bal; end if;

  perform public.admin_set_order_status(v_order, 'delivered');

  select loyalty_points into v_bal from public.profiles
   where id = '0e000000-0000-0000-0000-000000000001'::uuid;
  if v_bal <> 64 then
    raise exception 'CASE 2: balance is % after delivery, expected 64', v_bal; end if;

  select count(*) into v_rows from public.loyalty_transactions
   where order_id = v_order and type = 'earn';
  if v_rows <> 1 then
    raise exception 'CASE 2: % earn rows after delivery, expected 1', v_rows; end if;

  raise notice 'CASE 2 ok — a paid snapshot-path order credits once on delivery';
end $$;

-- ============================================================================
-- CASE 3 — REDEMPTION STILL DEBITS AT CREATION, and the ledger says so.
--
-- Deferring redemption would be a worse defect than the one being fixed: the
-- customer gets the discount on this order immediately, so the points have to
-- leave the balance immediately or the same points can be spent twice.
--
-- The `balance_after` assertion is the one a future edit will get wrong. The
-- old body wrote `v_bal_new - v_earned`, correct only because `v_bal_new`
-- included the earn. It no longer does, so the subtraction would now
-- under-report the customer's own transaction history by the earned amount.
-- ============================================================================
do $$
declare
  v_snap  jsonb;
  v_order public.orders;
  v_bal   integer;
  v_after integer;
begin
  perform set_config('test.auth_uid', '0e000000-0000-0000-0000-000000000002', true);
  perform set_config('test.is_admin', 'false', true);

  v_snap := public.compute_order_snapshot(
    '0e000000-0000-0000-0000-000000000002'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
    null, null, 100);

  if (v_snap->>'loyalty_points_redeemed')::int <> 100 then
    raise exception 'CASE 3: snapshot redeemed %, expected 100',
      v_snap->>'loyalty_points_redeemed'; end if;

  v_order := public.insert_order_from_snapshot(
    '0e000000-0000-0000-0000-000000000002'::uuid, v_snap, 'online', 'paid',
    gen_random_uuid(), 'test');
  insert into t_ctx values ('redeemed', v_order.id);

  select loyalty_points into v_bal from public.profiles
   where id = '0e000000-0000-0000-0000-000000000002'::uuid;
  if v_bal <> 400 then
    raise exception 'CASE 3: balance is % after redeeming 100 of 500, expected 400 (the earn must NOT be added)', v_bal; end if;

  select balance_after into v_after from public.loyalty_transactions
   where order_id = v_order.id and type = 'redeem';
  if v_after is null then
    raise exception 'CASE 3: no redeem ledger row'; end if;
  if v_after <> 400 then
    raise exception 'CASE 3: redeem row records balance_after=%, but the balance is 400', v_after; end if;

  if not exists (select 1 from public.loyalty_transactions
                 where order_id = v_order.id and type = 'earn_pending') then
    raise exception 'CASE 3: redeeming lost the pending earn'; end if;

  raise notice 'CASE 3 ok — redemption debits now and the ledger balance is honest';
end $$;

-- ============================================================================
-- CASE 4 — cancelling before delivery credits nothing, and refunds in full.
--
-- The reversal in `admin_set_order_status` reads `type = 'earn'` — what was
-- ACTUALLY credited — so a never-delivered snapshot-path order has nothing to
-- claw back. Had this file kept writing `earn` at creation, the reversal would
-- instead be deducting points from a balance that never received them on the
-- paths where the customer had already spent them.
-- ============================================================================
do $$
declare v_order uuid; v_bal integer;
begin
  select order_id into v_order from t_ctx where label = 'redeemed';
  perform set_config('test.auth_uid', '0e000000-0000-0000-0000-0000000ad999', true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);

  perform public.admin_set_order_status(v_order, 'cancelled');

  if exists (select 1 from public.loyalty_transactions
             where order_id = v_order and type = 'earn') then
    raise exception 'CASE 4: cancelling a never-delivered order produced an earn row'; end if;

  select loyalty_points into v_bal from public.profiles
   where id = '0e000000-0000-0000-0000-000000000002'::uuid;
  if v_bal <> 500 then
    raise exception 'CASE 4: balance is % after cancellation, expected the original 500', v_bal; end if;

  raise notice 'CASE 4 ok — cancellation refunds the redemption and reverses nothing else';
end $$;

-- ============================================================================
-- CASE 5 — a COMPED order writes no loyalty ledger row at all.
--
-- This is the arm that is reachable TODAY: `begin_checkout_session` settles a
-- zero total straight through `insert_order_from_snapshot`. A comped order
-- earns 0 because earning is clamped to the payable total, so the migration
-- changes nothing here — which is exactly the claim being pinned.
-- ============================================================================
do $$
declare
  v_snap  jsonb;
  v_order public.orders;
  v_rows  integer;
begin
  -- `profile_id` alone satisfies comp_members_identity_ck; `added_by` is
  -- nullable and the audit trail is not what this case is about.
  insert into public.comp_members (profile_id, is_active)
  values ('0e000000-0000-0000-0000-000000000003'::uuid, true)
  on conflict do nothing;

  perform set_config('test.auth_uid', '0e000000-0000-0000-0000-000000000003', true);
  perform set_config('test.is_admin', 'false', true);

  v_snap := public.compute_order_snapshot(
    '0e000000-0000-0000-0000-000000000003'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);

  if not coalesce((v_snap->>'is_comped')::boolean, false) then
    raise exception 'CASE 5: the comped customer was not recognised as comped'; end if;
  if (v_snap->>'total')::numeric <> 0 then
    raise exception 'CASE 5: comped total is %, expected 0', v_snap->>'total'; end if;
  if (v_snap->>'loyalty_points_earned')::int <> 0 then
    raise exception 'CASE 5: a comped order earned % points', v_snap->>'loyalty_points_earned'; end if;

  v_order := public.insert_order_from_snapshot(
    '0e000000-0000-0000-0000-000000000003'::uuid, v_snap, 'online', 'paid',
    gen_random_uuid(), null);

  select count(*) into v_rows from public.loyalty_transactions where order_id = v_order.id;
  if v_rows <> 0 then
    raise exception 'CASE 5: a comped order wrote % loyalty rows, expected 0', v_rows; end if;

  raise notice 'CASE 5 ok — a comped order touches the loyalty ledger not at all';
end $$;

-- ============================================================================
-- CASE 6 — SOURCE PARITY ACROSS BOTH CREATION PATHS.
--
-- Asserted at source level deliberately. The behavioural cases above prove the
-- snapshot path; this proves the two paths cannot silently diverge again, which
-- is the actual failure this migration exists to repair. A future edit that
-- restores the credit to either function fails here even if it touches no case
-- that happens to exercise that function.
-- ============================================================================
do $$
declare
  v_snapshot_src text;
  v_place_src    text;
begin
  select prosrc into v_snapshot_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'insert_order_from_snapshot';
  select prosrc into v_place_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';

  if v_snapshot_src is null or v_place_src is null then
    raise exception 'CASE 6: one of the two creation paths is missing'; end if;

  -- Neither adds the earn to the balance. Anchored on the arithmetic, which is
  -- what both functions actually wrote before their respective fixes.
  if v_snapshot_src like '%- v_redeemed + v_earned%' then
    raise exception 'CASE 6: insert_order_from_snapshot credits the earn at creation again'; end if;
  if v_place_src like '%- v_loyalty_redeemed + v_points_earned%' then
    raise exception 'CASE 6: place_order credits the earn at creation again'; end if;

  -- Both write the pending shape the promotion reads. Anchored on the argument
  -- list rather than the bare word, because both bodies carry comments that
  -- legitimately contain 'earn'.
  if v_snapshot_src not like '%, ''earn_pending'', v_earned,%' then
    raise exception 'CASE 6: insert_order_from_snapshot no longer writes earn_pending'; end if;
  if v_place_src not like '%, ''earn_pending'', v_points_earned,%' then
    raise exception 'CASE 6: place_order no longer writes earn_pending'; end if;

  -- And neither writes a spendable earn row at creation.
  if v_snapshot_src like '%, ''earn'', v_earned,%' then
    raise exception 'CASE 6: insert_order_from_snapshot writes a spendable earn row again'; end if;
  if v_place_src like '%, ''earn'', v_points_earned,%' then
    raise exception 'CASE 6: place_order writes a spendable earn row again'; end if;

  raise notice 'CASE 6 ok — both creation paths defer earning, and neither credits at creation';
end $$;

rollback;
