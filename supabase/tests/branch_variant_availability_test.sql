-- ============================================================================
-- Per-branch VARIANT (price tier) availability.
--
-- This file EXECUTES the money path. `20260924120000` re-emits `place_order`
-- and `compute_order_snapshot`, and the risk in re-emitting a 500-line function
-- is never the twenty-six lines you meant to add — so half of this suite is a
-- regression net on pricing, the cheapest-tier fallback and the product guard,
-- exactly as `place_order_modifier_availability_test.sql` is for its own
-- migration.
--
-- The seed catalog carries no `product_variants` rows, so the tiers below are
-- created here: "Crispy Chicken" gets Small 27.00 / Large 41.00, which makes
-- Small the cheapest and therefore the one the stale-client fallback picks.
--
-- Impersonation is through request.jwt.claim.sub — see ops_roles_test.sql for
-- why the test.* GUCs cannot express the operations roles.
-- ============================================================================
begin;

\set branch  '''b0000000-0000-0000-0000-000000000001'''
\set chicken '''a0000000-0000-0000-0000-000000000002'''
\set small   '''d0000000-0000-0000-0000-000000000001'''
\set large   '''d0000000-0000-0000-0000-000000000002'''
\set cust    '''01000000-0000-0000-0000-000000000001'''

do $$
declare
  v_cust uuid := '01000000-0000-0000-0000-000000000001';
  v_opa  uuid := '01000000-0000-0000-0000-000000000002';
begin
  insert into auth.users(id) values (v_cust),(v_opa) on conflict (id) do nothing;
  insert into public.profiles(id, full_name, role) values
    (v_cust,'Tier Customer','customer'),
    (v_opa,'Operator A','branch_staff')
  on conflict (id) do update set role = excluded.role;
  insert into public.staff_branch_assignments(user_id, branch_id)
    values (v_opa,'b0000000-0000-0000-0000-000000000001')
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

insert into public.product_variants (id, product_id, name_en, name_ar, price, sort_order, is_active)
values
  ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','Small','صغير',27.00,1,true),
  ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','Large','كبير',41.00,2,true);

-- Place a cash pickup order for the chicken. `p_variant` null means the cart
-- names no tier, which is the stale-client path. Returns the SQLSTATE, or null
-- on success.
-- CAPTURES THE RETURNED ROW rather than looking the order up afterwards.
-- `place_order` returns `orders`, and reading it back with
-- `order by created_at desc limit 1` would be wrong inside a suite: a
-- transaction freezes `now()`, so every order placed here shares a
-- `created_at` and the comparison ties silently. That is the same trap the
-- health card's own comment records ("ordering is by the ledger's identity
-- column, never by timestamp"), and the first draft of this file fell into it.
create or replace function pg_temp.order_tier(p_variant uuid, out state text, out subtotal numeric)
language plpgsql as $$
declare v_prev text; v_item jsonb; v_order public.orders;
begin
  v_prev := coalesce(current_setting('request.jwt.claim.sub', true), '');
  perform set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000001',true);
  v_item := jsonb_build_object(
    'product_id','a0000000-0000-0000-0000-000000000002', 'quantity',1);
  if p_variant is not null then
    v_item := v_item || jsonb_build_object('variant_id', p_variant::text);
  end if;
  begin
    v_order := public.place_order(
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'pickup'::public.order_type,
      jsonb_build_array(v_item),
      null, null, null, 0, null, 'cash');
    state := null;
    subtotal := v_order.subtotal;
  exception when others then
    state := sqlstate;
    subtotal := null;
  end;
  perform set_config('request.jwt.claim.sub', v_prev, true);
end $$;

-- The same cart through the snapshot path, which is the other order-creating
-- implementation. Returns the SQLSTATE, or null on success.
create or replace function pg_temp.snapshot_tier(p_variant uuid) returns text
language plpgsql as $$
declare v_state text; v_item jsonb;
begin
  v_item := jsonb_build_object(
    'product_id','a0000000-0000-0000-0000-000000000002', 'quantity',1);
  if p_variant is not null then
    v_item := v_item || jsonb_build_object('variant_id', p_variant::text);
  end if;
  begin
    perform public.compute_order_snapshot(
      '01000000-0000-0000-0000-000000000001'::uuid,
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'pickup'::public.order_type,
      jsonb_build_array(v_item),
      null, null, 0);
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  return v_state;
end $$;

-- Close one tier at one branch, directly. The RPCs are covered separately; this
-- keeps each case about the ORDER PATH rather than about authorization.
create or replace function pg_temp.close_tier(p_variant uuid, p_until timestamptz)
returns void language sql as $$
  insert into public.branch_variant_availability
    (branch_id, variant_id, is_available, snoozed_until, reason_code, source)
  values ('b0000000-0000-0000-0000-000000000001', p_variant, false, p_until,
          'out_of_stock', 'manual')
  on conflict (branch_id, variant_id) do update
    set is_available = false, snoozed_until = excluded.snoozed_until,
        reason_code = excluded.reason_code, source = 'manual';
$$;

create or replace function pg_temp.open_tier(p_variant uuid)
returns void language sql as $$
  update public.branch_variant_availability set is_available = true
   where branch_id = 'b0000000-0000-0000-0000-000000000001' and variant_id = p_variant;
$$;

-- ---------------------------------------------------------------------------
-- 1. Baseline. Both tiers order, and each is priced from ITS OWN row.
--    This is the regression that matters most: the file edits the block
--    immediately above `v_unit_price`.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  r := pg_temp.order_tier('d0000000-0000-0000-0000-000000000002');  -- Large
  if r.state is not null then
    raise exception 'CASE 1: ordering an open tier failed with %', r.state;
  end if;
  if r.subtotal is distinct from 41.00 then
    raise exception 'CASE 1: Large priced at %, expected 41.00', r.subtotal;
  end if;

  r := pg_temp.order_tier('d0000000-0000-0000-0000-000000000001');  -- Small
  if r.state is not null then
    raise exception 'CASE 1: ordering the other open tier failed with %', r.state;
  end if;
  if r.subtotal is distinct from 27.00 then
    raise exception 'CASE 1: Small priced at %, expected 27.00', r.subtotal;
  end if;
  raise notice 'CASE 1 baseline pricing OK';
end $$;

-- ---------------------------------------------------------------------------
-- 2. A closed tier is refused — and ONLY that tier. This is the whole point:
--    closing the Large must not close the Small, which is what a cashier has
--    had to do until now.
-- ---------------------------------------------------------------------------
do $$
declare v_state text;
begin
  perform pg_temp.close_tier('d0000000-0000-0000-0000-000000000002', now() + interval '30 minutes');

  if (pg_temp.order_tier('d0000000-0000-0000-0000-000000000002')).state is null then
    raise exception 'CASE 2: a CLOSED tier was accepted';
  end if;

  v_state := (pg_temp.order_tier('d0000000-0000-0000-0000-000000000001')).state;
  if v_state is not null then
    raise exception 'CASE 2: closing the Large also blocked the Small (%)', v_state;
  end if;
  raise notice 'CASE 2 per-tier refusal OK';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Lazy expiry, both directions. An UNTIMED closure is an administrator's
--    delisting and blocks; a timer that has RUN OUT is not a closure, even
--    before the sweeper reopens the row.
-- ---------------------------------------------------------------------------
do $$
declare v_state text;
begin
  perform pg_temp.close_tier('d0000000-0000-0000-0000-000000000002', null);
  if (pg_temp.order_tier('d0000000-0000-0000-0000-000000000002')).state is null then
    raise exception 'CASE 3: an UNTIMED closure did not block';
  end if;

  perform pg_temp.close_tier('d0000000-0000-0000-0000-000000000002', now() - interval '1 minute');
  v_state := (pg_temp.order_tier('d0000000-0000-0000-0000-000000000002')).state;
  if v_state is not null then
    raise exception 'CASE 3: a LAPSED timer still blocked (%) — lazy expiry lost', v_state;
  end if;
  raise notice 'CASE 3 lazy expiry OK both ways';
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE STALE-CLIENT FALLBACK REFUSES RATHER THAN SUBSTITUTING.
--
--    A cart naming no tier gets the cheapest ACTIVE one. With the cheapest
--    closed, the order must be REFUSED — never quietly promoted to the dearer
--    tier, because `products.price` is what a pre-tier client displayed and
--    charging above it breaks "the price charged may never exceed the price
--    displayed".
--
--    Asserting the refusal alone would be too weak: a substitution would also
--    show up as "an order exists". So the order COUNT is pinned across the
--    attempt.
-- ---------------------------------------------------------------------------
do $$
declare v_state text; v_before bigint; v_after bigint;
begin
  perform pg_temp.open_tier('d0000000-0000-0000-0000-000000000002');
  perform pg_temp.close_tier('d0000000-0000-0000-0000-000000000001', now() + interval '30 minutes');

  select count(*) into v_before from public.orders;
  v_state := (pg_temp.order_tier(null)).state;
  select count(*) into v_after from public.orders;

  if v_state is null then
    raise exception 'CASE 4: the fallback accepted an order whose cheapest tier is closed';
  end if;
  if v_after <> v_before then
    raise exception 'CASE 4: % order(s) were created despite the refusal — a tier was SUBSTITUTED',
      v_after - v_before;
  end if;

  -- And with the cheapest tier open again the same cart succeeds, priced at the
  -- cheapest — so the refusal above was the closure, not a broken fallback.
  perform pg_temp.open_tier('d0000000-0000-0000-0000-000000000001');
  declare r record;
  begin
    r := pg_temp.order_tier(null);
    if r.state is not null then
      raise exception 'CASE 4: the fallback stopped working entirely (%)', r.state;
    end if;
    if r.subtotal is distinct from 27.00 then
      raise exception 'CASE 4: the fallback charged %, not the cheapest tier 27.00', r.subtotal;
    end if;
  end;
  raise notice 'CASE 4 fallback refuses rather than substitutes OK';
end $$;

-- ---------------------------------------------------------------------------
-- 5. The SNAPSHOT path enforces it too. This is the second order-creating
--    implementation, and the one `20260918120000` forgot — which is why
--    `20260921120000` had to exist.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.close_tier('d0000000-0000-0000-0000-000000000002', now() + interval '30 minutes');
  if pg_temp.snapshot_tier('d0000000-0000-0000-0000-000000000002') is null then
    raise exception 'CASE 5: compute_order_snapshot accepted a CLOSED tier';
  end if;
  if pg_temp.snapshot_tier('d0000000-0000-0000-0000-000000000001') is not null then
    raise exception 'CASE 5: compute_order_snapshot blocked an OPEN tier';
  end if;
  raise notice 'CASE 5 snapshot path enforces it OK';
end $$;

-- ---------------------------------------------------------------------------
-- 6. The sweeper reopens a lapsed tier and counts it, so a snooze is temporary
--    in fact and not only in intention.
-- ---------------------------------------------------------------------------
do $$
declare v_run bigint; v_count integer; v_open boolean;
begin
  perform pg_temp.close_tier('d0000000-0000-0000-0000-000000000002', now() - interval '1 minute');
  v_run := public.branch_availability_sweep();

  select variants_reopened into v_count from public.branch_availability_runs where id = v_run;
  if coalesce(v_count,0) < 1 then
    raise exception 'CASE 6: the sweep did not count a reopened tier (got %)', v_count;
  end if;

  select is_available into v_open from public.branch_variant_availability
   where branch_id='b0000000-0000-0000-0000-000000000001'
     and variant_id='d0000000-0000-0000-0000-000000000002';
  if v_open is not true then
    raise exception 'CASE 6: the tier was not reopened';
  end if;
  raise notice 'CASE 6 sweeper reopens and counts OK';
end $$;

-- ---------------------------------------------------------------------------
-- 7. The RPC gate. A branch operator may close a tier at THEIR branch and
--    nowhere else; the call centre is excluded from what is sellable, the same
--    boundary products and modifiers draw.
-- ---------------------------------------------------------------------------
do $$
declare v_state text;
begin
  perform set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000002',true);
  begin
    perform public.set_variant_snooze(
      'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
      30, 'out_of_stock', null);
    v_state := null;
  exception when others then v_state := sqlstate;
  end;
  if v_state is not null then
    raise exception 'CASE 7: a branch operator could not close a tier at their own branch (%)', v_state;
  end if;

  begin
    perform public.set_variant_snooze(
      'b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
      30, 'out_of_stock', null);
    v_state := null;
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'CASE 7: an operator closed a tier at ANOTHER branch (state %)', v_state;
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  raise notice 'CASE 7 RPC branch scoping OK';
end $$;

-- ---------------------------------------------------------------------------
-- 8. An INACTIVE tier cannot be closed. The Lazywait importer deactivates a
--    tier it no longer sees rather than deleting it, so allowing this would
--    create a row no console lists and nobody can reopen from the counter.
-- ---------------------------------------------------------------------------
do $$
declare v_state text;
begin
  update public.product_variants set is_active = false
   where id = 'd0000000-0000-0000-0000-000000000002';
  perform set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000002',true);
  begin
    perform public.set_variant_snooze(
      'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
      30, 'out_of_stock', null);
    v_state := null;
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception 'CASE 8: an INACTIVE tier was closeable (state %)', v_state;
  end if;

  -- Reopening one is still allowed: a tier deactivated while closed would
  -- otherwise be stuck closed for ever.
  begin
    perform public.clear_variant_snooze(
      'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002');
    v_state := null;
  exception when others then v_state := sqlstate;
  end;
  if v_state is not null then
    raise exception 'CASE 8: an inactive tier could not be REOPENED (%)', v_state;
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  raise notice 'CASE 8 inactive tier closed/reopen asymmetry OK';
end $$;

rollback;
