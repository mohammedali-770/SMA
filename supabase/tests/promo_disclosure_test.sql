-- ============================================================================
-- Promo disclosure hardening — behaviour test for `20260920120000`.
--
-- Runs against a THROWAWAY Postgres with the whole migration chain applied
-- (`.github/sql-ci/run.sh`). Every case RAISES EXCEPTION on failure, so the
-- script aborts non-zero; a clean run prints one NOTICE and commits nothing.
--
-- WHAT THIS EXISTS TO PROVE, and why the migration cannot prove it alone.
-- `compute_campaign_discount` gates on `auth.uid()`, which is null inside a
-- migration, so the file that installs it can only reach that gate. Every
-- refusal branch below the gate is therefore proven HERE, as a real
-- `authenticated` caller with a real customer id.
--
-- THE PROPERTY UNDER TEST is an INDISTINGUISHABILITY, not a message. A code
-- that does not exist, one switched off, and one that has not started yet must
-- produce the SAME tuple — so each case is compared against the not-found
-- answer field by field rather than against a literal, which is the only way a
-- future edit to one branch cannot drift away from the others unnoticed.
--
-- Covers:
--   1. Coupons: absent / inactive / scheduled are indistinguishable.
--   2. Coupons: expired / exhausted / below-minimum keep their own message but
--      disclose no terms.
--   3. Coupons: the valid path still returns type, value and the discount.
--   4. Campaigns: absent / inactive / future are indistinguishable, addressed
--      by CODE and by ID.
--   5. Campaigns: expired / wrong-branch / below-minimum / per-user / global
--      keep their message and disclose no descriptors, and never echo the
--      row's own secret code back to a caller who addressed it by id.
--   6. Campaigns: the valid path still returns id, code, type and both names.
--   7. The RLS policy and the RPC now agree: the rows the policy hides are the
--      rows the RPC refuses opaquely.
-- ============================================================================
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0001', 'promo-cust@x');
insert into public.profiles (id, role, full_name, phone_number) values
  ('00000000-0000-0000-0000-0000000c0001', 'customer', 'Promo Cust', '+966500000101')
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number;

insert into public.branches (id, name_en, name_ar) values
  ('00000000-0000-0000-0000-0000000b0001', 'Promo Main', 'الرئيسي'),
  ('00000000-0000-0000-0000-0000000b0002', 'Promo Other', 'اخرى');

-- ---- Coupons ---------------------------------------------------------------
insert into public.coupons (code, type, value, is_active, starts_at, ends_at,
                            usage_limit, usage_count, min_order_amount)
values
  ('PDOFF',      'percentage', 15, false, null,                        null,                        null, 0, 0),
  ('PDFUTURE',   'fixed',      25, true,  now() + interval '30 days',  null,                        null, 0, 0),
  ('PDEXPIRED',  'percentage', 20, true,  null,                        now() - interval '1 day',    null, 0, 0),
  ('PDEXHAUST',  'fixed',      30, true,  null,                        null,                        2,    2, 0),
  ('PDMINIMUM',  'percentage', 10, true,  null,                        null,                        null, 0, 500),
  ('PDLIVE',     'percentage', 10, true,  null,                        null,                        null, 0, 0);

-- ---- Campaigns -------------------------------------------------------------
insert into public.campaigns
  (id, name_en, name_ar, type, value, code, starts_at, ends_at,
   min_order_amount, max_discount_amount, per_user_limit, global_limit, branch_id, is_active)
values
  ('00000000-0000-0000-0000-00000e000001','Promo Off','متوقف','percentage',10,'PDCOFF',
     null, null, 0, null, null, null, null, false),
  ('00000000-0000-0000-0000-00000e000002','Promo Future','قادم','percentage',10,'PDCFUTURE',
     now() + interval '30 days', null, 0, null, null, null, null, true),
  ('00000000-0000-0000-0000-00000e000003','Promo Expired','منتهي','percentage',10,'PDCEXPIRED',
     null, now() - interval '1 day', 0, null, null, null, null, true),
  ('00000000-0000-0000-0000-00000e000004','Promo Branch','فرع','fixed',10,'PDCBRANCH',
     null, null, 0, null, null, null, '00000000-0000-0000-0000-0000000b0001', true),
  ('00000000-0000-0000-0000-00000e000005','Promo Minimum','حد','percentage',10,'PDCMIN',
     null, null, 500, null, null, null, null, true),
  ('00000000-0000-0000-0000-00000e000006','Promo PerUser','لكل','fixed',10,'PDCUSER',
     null, null, 0, null, 1, null, null, true),
  ('00000000-0000-0000-0000-00000e000007','Promo Global','عام','fixed',10,'PDCGLOBAL',
     null, null, 0, null, null, 1, null, true),
  ('00000000-0000-0000-0000-00000e000008','Promo Live','حي','percentage',10,'PDCLIVE',
     null, null, 0, null, null, null, null, true);

insert into public.campaign_redemptions (campaign_id, user_id) values
  ('00000000-0000-0000-0000-00000e000006','00000000-0000-0000-0000-0000000c0001'),
  ('00000000-0000-0000-0000-00000e000007','00000000-0000-0000-0000-0000000c0001');

-- ============================================================================
-- CASE 1-3 — coupons, as a real signed-in customer.
-- ============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0001', true);
set local role authenticated;

do $$
declare
  absent  record;
  r       record;
begin
  -- The reference answer every hidden state must match, field for field.
  select * into absent from public.validate_coupon('PDABSENT', 100);
  if absent.valid then raise exception 'CASE 1: a coupon that does not exist was accepted'; end if;
  if absent.type is not null or absent.value is not null then
    raise exception 'CASE 1: the not-found answer itself carries terms'; end if;

  select * into r from public.validate_coupon('PDOFF', 100);
  if (r.valid, r.type, r.value, r.discount_amount, r.message)
     is distinct from (absent.valid, absent.type, absent.value, absent.discount_amount, absent.message) then
    raise exception 'CASE 1: a switched-off coupon is distinguishable — msg=%, type=%, value=%',
      coalesce(r.message,'<null>'), coalesce(r.type::text,'<null>'), coalesce(r.value::text,'<null>'); end if;

  select * into r from public.validate_coupon('PDFUTURE', 100);
  if (r.valid, r.type, r.value, r.discount_amount, r.message)
     is distinct from (absent.valid, absent.type, absent.value, absent.discount_amount, absent.message) then
    raise exception 'CASE 1: a scheduled coupon announces an unlaunched campaign — msg=%, type=%, value=%',
      coalesce(r.message,'<null>'), coalesce(r.type::text,'<null>'), coalesce(r.value::text,'<null>'); end if;

  -- CASE 2 — published codes keep a useful message and still disclose nothing.
  select * into r from public.validate_coupon('PDEXPIRED', 100);
  if r.valid or r.message <> 'Coupon has expired' then
    raise exception 'CASE 2: expired coupon answered %', coalesce(r.message,'<null>'); end if;
  if r.type is not null or r.value is not null then
    raise exception 'CASE 2: expired coupon disclosed its terms'; end if;

  select * into r from public.validate_coupon('PDEXHAUST', 100);
  if r.valid or r.message <> 'Coupon usage limit reached' then
    raise exception 'CASE 2: exhausted coupon answered %', coalesce(r.message,'<null>'); end if;
  if r.type is not null or r.value is not null then
    raise exception 'CASE 2: exhausted coupon disclosed its terms'; end if;

  select * into r from public.validate_coupon('PDMINIMUM', 100);
  if r.valid or r.message <> 'Order is below the coupon minimum' then
    raise exception 'CASE 2: below-minimum coupon answered %', coalesce(r.message,'<null>'); end if;
  if r.type is not null or r.value is not null then
    raise exception 'CASE 2: below-minimum coupon disclosed its terms'; end if;

  -- CASE 3 — the success path is UNTOUCHED. Without this the whole change could
  -- be satisfied by a function that refuses everything.
  select * into r from public.validate_coupon('PDLIVE', 100);
  if not r.valid then raise exception 'CASE 3: a live coupon was refused — %', coalesce(r.message,'<null>'); end if;
  if r.type is null or r.value is null then
    raise exception 'CASE 3: a live coupon returned no terms'; end if;
  if r.discount_amount <> 10 then
    raise exception 'CASE 3: 10%% of 100 came back as %', r.discount_amount; end if;
  if r.code <> 'PDLIVE' then raise exception 'CASE 3: code echo is %', coalesce(r.code,'<null>'); end if;

  raise notice 'CASES 1-3 coupons OK';
end $$;

-- ============================================================================
-- CASE 4-6 — campaigns, by code AND by id.
-- ============================================================================
do $$
declare
  absent record;
  r      record;
begin
  select * into absent from public.compute_campaign_discount(p_code => 'PDCABSENT', p_subtotal => 1000);
  if absent.valid then raise exception 'CASE 4: a campaign that does not exist was accepted'; end if;
  if absent.campaign_id is not null or absent.type is not null
     or absent.name_en is not null or absent.name_ar is not null then
    raise exception 'CASE 4: the not-found answer itself carries descriptors'; end if;

  select * into r from public.compute_campaign_discount(p_code => 'PDCOFF', p_subtotal => 1000);
  if (r.valid, r.campaign_id, r.type, r.name_en, r.name_ar, r.message)
     is distinct from (absent.valid, absent.campaign_id, absent.type, absent.name_en, absent.name_ar, absent.message) then
    raise exception 'CASE 4: a switched-off campaign is distinguishable — msg=%, name=%',
      coalesce(r.message,'<null>'), coalesce(r.name_en,'<null>'); end if;

  select * into r from public.compute_campaign_discount(p_code => 'PDCFUTURE', p_subtotal => 1000);
  if (r.valid, r.campaign_id, r.type, r.name_en, r.name_ar, r.message)
     is distinct from (absent.valid, absent.campaign_id, absent.type, absent.name_en, absent.name_ar, absent.message) then
    raise exception 'CASE 4: a future campaign leaks — msg=%, name=%',
      coalesce(r.message,'<null>'), coalesce(r.name_en,'<null>'); end if;

  -- Addressed by ID rather than by code: the same states, and critically the
  -- row's OWN secret code must not come back to a caller who never supplied it.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000e000002', p_subtotal => 1000);
  if r.valid then raise exception 'CASE 4: a future campaign addressed by id was accepted'; end if;
  if r.message <> 'Campaign not found' then
    raise exception 'CASE 4: future campaign by id answered %', coalesce(r.message,'<null>'); end if;
  if r.code is not null then
    raise exception 'CASE 4: a caller who supplied only an id was handed the secret code %', r.code; end if;
  if r.name_en is not null or r.name_ar is not null or r.type is not null then
    raise exception 'CASE 4: a future campaign addressed by id disclosed its descriptors'; end if;

  -- CASE 5 — refusals below the gate.
  --
  -- Every one of these is addressed BY ID, so `code` is asserted null on all of
  -- them and not only on the not-found merge: a caller who supplied an id never
  -- supplied a code, and handing the row's own secret promo code back would be
  -- the same disclosure by a different door. An earlier draft checked `code` on
  -- the merged branch alone, and a mutant that echoed `c.code` from the
  -- branch-mismatch path survived it.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000e000003', p_subtotal => 1000);
  if r.valid or r.message <> 'Campaign has expired' then
    raise exception 'CASE 5: expired answered %', coalesce(r.message,'<null>'); end if;
  if r.campaign_id is not null or r.code is not null or r.type is not null
     or r.name_en is not null or r.name_ar is not null then
    raise exception 'CASE 5: expired campaign disclosed descriptors'; end if;

  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000e000004', p_subtotal => 1000,
    p_branch_id => '00000000-0000-0000-0000-0000000b0002');
  if r.valid or r.message <> 'Campaign is not available at this branch' then
    raise exception 'CASE 5: wrong branch answered %', coalesce(r.message,'<null>'); end if;
  if r.campaign_id is not null or r.code is not null or r.name_en is not null or r.type is not null then
    raise exception 'CASE 5: wrong-branch refusal disclosed descriptors (code=%, name=%)',
      coalesce(r.code,'<null>'), coalesce(r.name_en,'<null>'); end if;

  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000e000005', p_subtotal => 100);
  if r.valid or r.message <> 'Order is below the campaign minimum' then
    raise exception 'CASE 5: below-minimum answered %', coalesce(r.message,'<null>'); end if;
  if r.campaign_id is not null or r.code is not null or r.name_en is not null or r.type is not null then
    raise exception 'CASE 5: below-minimum refusal disclosed descriptors (code=%, name=%)',
      coalesce(r.code,'<null>'), coalesce(r.name_en,'<null>'); end if;

  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000e000006', p_subtotal => 1000);
  if r.valid or r.message <> 'Per-user redemption limit reached' then
    raise exception 'CASE 5: per-user answered %', coalesce(r.message,'<null>'); end if;
  if r.campaign_id is not null or r.code is not null or r.name_en is not null or r.type is not null then
    raise exception 'CASE 5: per-user refusal disclosed descriptors (code=%, name=%)',
      coalesce(r.code,'<null>'), coalesce(r.name_en,'<null>'); end if;

  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000e000007', p_subtotal => 1000);
  if r.valid or r.message <> 'Campaign redemption limit reached' then
    raise exception 'CASE 5: global answered %', coalesce(r.message,'<null>'); end if;
  if r.campaign_id is not null or r.code is not null or r.name_en is not null or r.type is not null then
    raise exception 'CASE 5: global refusal disclosed descriptors (code=%, name=%)',
      coalesce(r.code,'<null>'), coalesce(r.name_en,'<null>'); end if;

  -- CASE 6 — the success path is UNTOUCHED, descriptors and all.
  select * into r from public.compute_campaign_discount(p_code => 'PDCLIVE', p_subtotal => 1000);
  if not r.valid then raise exception 'CASE 6: a live campaign was refused — %', coalesce(r.message,'<null>'); end if;
  if r.campaign_id is null or r.type is null or r.name_en is null or r.name_ar is null then
    raise exception 'CASE 6: a live campaign returned no descriptors'; end if;
  if r.discount_amount <> 100 then
    raise exception 'CASE 6: 10%% of 1000 came back as %', r.discount_amount; end if;

  raise notice 'CASES 4-6 campaigns OK';
end $$;

-- ============================================================================
-- CASE 7 — the policy and the RPC now agree.
--
-- The `campaigns` RLS policy already hid coded, inactive, future and expired
-- rows from a customer. The definer RPC used to hand those same rows back. This
-- asserts the two halves line up rather than merely that each works: for every
-- row this customer CANNOT select, the RPC must answer with the not-found
-- tuple or with a message that discloses no descriptor.
-- ============================================================================
do $$
declare
  v_ids   uuid[] := array[
    '00000000-0000-0000-0000-00000e000001'::uuid,   -- switched off
    '00000000-0000-0000-0000-00000e000002'::uuid,   -- not started
    '00000000-0000-0000-0000-00000e000003'::uuid    -- expired
  ];
  v_id    uuid;
  v_seen  integer;
  r       record;
  n       integer := 0;
begin
  -- Half one: the policy really does hide them from this caller.
  select count(*) into v_seen from public.campaigns c where c.id = any(v_ids);
  if v_seen <> 0 then
    raise exception 'CASE 7: the RLS policy let a customer select % of the hidden campaigns', v_seen; end if;

  -- Half two: the definer RPC, which bypasses that policy, discloses nothing
  -- about the same rows.
  foreach v_id in array v_ids loop
    n := n + 1;
    select * into r from public.compute_campaign_discount(p_campaign_id => v_id, p_subtotal => 1000);
    if r.valid then
      raise exception 'CASE 7: a policy-hidden campaign was accepted by the RPC'; end if;
    if r.campaign_id is not null or r.code is not null or r.type is not null
       or r.name_en is not null or r.name_ar is not null then
      raise exception 'CASE 7: the RPC disclosed a campaign the policy hides (msg=%, name=%)',
        coalesce(r.message,'<null>'), coalesce(r.name_en,'<null>'); end if;
  end loop;
  if n <> 3 then raise exception 'CASE 7: expected to probe 3 hidden campaigns, probed %', n; end if;

  raise notice 'CASE 7 policy/RPC agreement OK';
end $$;

reset role;
select set_config('request.jwt.claim.sub', null, true);

do $$ begin raise notice 'promo_disclosure_test: ALL CASES PASSED'; end $$;

rollback;
