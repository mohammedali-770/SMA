-- ============================================================================
-- DB-level behaviour test for app-level discounts & campaigns (#100).
--
-- Runs against a THROWAWAY Postgres with all migrations applied (same harness as
-- the lazywait/account-deletion tests). Each case RAISES EXCEPTION on failure so
-- the whole script aborts non-zero; a clean run prints the final NOTICE and
-- commits nothing (rolled back).
--
-- NOTE: this file requires a live Postgres and is NOT part of the Vitest/CI
-- suite (which has no database). It was authored but NOT executed in the
-- implementation environment (no local Postgres here). Run it locally before
-- applying the migration.
--
-- Covers:
--   0. Object contract: both tables + the RPC exist.
--   1. Grant + RLS contract: RLS enabled; execute granted to authenticated only;
--      redemptions have no client write grant.
--   2. RLS enforcement (real role switch): anon + customer see only ACTIVE,
--      in-window, CODELESS campaigns; coded/inactive/future are hidden; a
--      customer sees only their OWN redemptions and cannot write either table;
--      an admin sees everything.
--   3. Discount math + cap clamping (percentage, fixed, free_delivery), incl.
--      resolving a SECRET coded campaign the client could not SELECT.
--   4. Rejections: expired, not-started, inactive, min-order, per-user limit,
--      global limit, wrong branch, not-found, unauthenticated.
-- ============================================================================
begin;

-- ---- Fixtures (inserted as the owner; RLS is exercised later via SET ROLE) --
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', 'admin@x'),
  ('00000000-0000-0000-0000-000000000c01', 'cust@x'),
  ('00000000-0000-0000-0000-000000000c02', 'other@x');

insert into public.profiles (id, role, full_name, phone_number) values
  ('00000000-0000-0000-0000-000000000a01', 'admin',    'Admin',  '+966500000001'),
  ('00000000-0000-0000-0000-000000000c01', 'customer', 'Cust',   '+966500000002'),
  ('00000000-0000-0000-0000-000000000c02', 'customer', 'Other',  '+966500000003');

insert into public.branches (id, name_en, name_ar) values
  ('00000000-0000-0000-0000-000000000b01', 'Main', 'الرئيسي'),
  ('00000000-0000-0000-0000-000000000b02', 'Other', 'اخرى');

-- Campaigns. Fixed UUIDs so both the SET ROLE blocks and the RPC blocks refer
-- to the same rows. Last group ...0d00NN.
insert into public.campaigns
  (id, name_en, name_ar, type, value, code, starts_at, ends_at,
   min_order_amount, max_discount_amount, per_user_limit, global_limit, branch_id, is_active)
values
  -- 01 auto-apply, active, codeless, no window -> PUBLIC-visible
  ('00000000-0000-0000-0000-00000d000001','Auto 10%','تلقائي','percentage',10,null,null,null,0,null,null,null,null,true),
  -- 02 inactive -> hidden from customers
  ('00000000-0000-0000-0000-00000d000002','Off','متوقف','percentage',10,null,null,null,0,null,null,null,null,false),
  -- 03 future -> hidden
  ('00000000-0000-0000-0000-00000d000003','Future','قادم','percentage',10,null,now()+interval '2 days',null,0,null,null,null,null,true),
  -- 04 expired -> hidden
  ('00000000-0000-0000-0000-00000d000004','Expired','منتهي','percentage',10,null,null,now()-interval '2 days',0,null,null,null,null,true),
  -- 05 coded (secret) 20% -> never SELECT-able, only via RPC
  ('00000000-0000-0000-0000-00000d000005','Save 20','وفر','percentage',20,'SAVE20',null,null,0,null,null,null,null,true),
  -- 06 percentage 50% capped at 15
  ('00000000-0000-0000-0000-00000d000006','Half capped','نص','percentage',50,null,null,null,0,15,null,null,null,true),
  -- 07 fixed 30
  ('00000000-0000-0000-0000-00000d000007','Fixed 30','ثابت','fixed',30,null,null,null,0,null,null,null,null,true),
  -- 08 fixed 200 (must clamp to subtotal)
  ('00000000-0000-0000-0000-00000d000008','Fixed big','كبير','fixed',200,null,null,null,0,null,null,null,null,true),
  -- 09 min-order 50
  ('00000000-0000-0000-0000-00000d000009','Min 50','حد','fixed',10,null,null,null,50,null,null,null,null,true),
  -- 0a branch-scoped to b01, 10%
  ('00000000-0000-0000-0000-00000d00000a','Branch only','فرع','percentage',10,null,null,null,0,null,null,null,'00000000-0000-0000-0000-000000000b01',true),
  -- 0b free delivery
  ('00000000-0000-0000-0000-00000d00000b','Free delivery','توصيل','free_delivery',0,null,null,null,0,null,null,null,null,true),
  -- 0c per-user limit 1, 10%
  ('00000000-0000-0000-0000-00000d00000c','Once per user','مرة','percentage',10,null,null,null,0,null,1,null,null,true),
  -- 0d global limit 2, 10%
  ('00000000-0000-0000-0000-00000d00000d','Global 2','عالمي','percentage',10,null,null,null,0,null,null,2,null,true);

-- Redemptions: customer used the auto campaign once; other user used it once.
insert into public.campaign_redemptions (campaign_id, user_id, order_id, discount_amount) values
  ('00000000-0000-0000-0000-00000d000001','00000000-0000-0000-0000-000000000c01',null,1.00),
  ('00000000-0000-0000-0000-00000d000001','00000000-0000-0000-0000-000000000c02',null,1.00);

-- ============================================================================
-- Phase 0 — object contract
-- ============================================================================
do $$
begin
  if to_regclass('public.campaigns') is null then
    raise exception 'OBJ: campaigns table missing'; end if;
  if to_regclass('public.campaign_redemptions') is null then
    raise exception 'OBJ: campaign_redemptions table missing'; end if;
  if to_regprocedure('public.compute_campaign_discount(text, uuid, numeric, numeric, uuid)') is null then
    raise exception 'OBJ: compute_campaign_discount RPC missing'; end if;
  raise notice 'PHASE 0 object contract OK';
end $$;

-- ============================================================================
-- Phase 1 — grant + RLS contract
-- ============================================================================
do $$
begin
  -- RLS enabled on both tables.
  if not (select relrowsecurity from pg_class where oid = 'public.campaigns'::regclass) then
    raise exception 'GRANTS: RLS not enabled on campaigns'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.campaign_redemptions'::regclass) then
    raise exception 'GRANTS: RLS not enabled on campaign_redemptions'; end if;

  -- RPC: authenticated may execute, anon may not.
  if not has_function_privilege('authenticated',
        'public.compute_campaign_discount(text, uuid, numeric, numeric, uuid)', 'execute') then
    raise exception 'GRANTS: authenticated cannot execute the RPC'; end if;
  if has_function_privilege('anon',
        'public.compute_campaign_discount(text, uuid, numeric, numeric, uuid)', 'execute') then
    raise exception 'GRANTS: anon can execute the RPC'; end if;

  -- campaigns: anon may SELECT (rows filtered by RLS) but not write.
  if not has_table_privilege('anon', 'public.campaigns', 'select') then
    raise exception 'GRANTS: anon lacks SELECT on campaigns'; end if;
  if has_table_privilege('anon', 'public.campaigns', 'insert') then
    raise exception 'GRANTS: anon has INSERT on campaigns'; end if;

  -- campaign_redemptions: clients get NO write grant at all (defence in depth).
  if has_table_privilege('authenticated', 'public.campaign_redemptions', 'insert') then
    raise exception 'GRANTS: authenticated has INSERT on campaign_redemptions'; end if;
  if has_table_privilege('anon', 'public.campaign_redemptions', 'select') then
    raise exception 'GRANTS: anon can SELECT campaign_redemptions'; end if;
  if not has_table_privilege('authenticated', 'public.campaign_redemptions', 'select') then
    raise exception 'GRANTS: authenticated lacks SELECT on campaign_redemptions'; end if;
  raise notice 'PHASE 1 grant/RLS contract OK';
end $$;

-- ============================================================================
-- Phase 2 — RLS enforcement (real role switching)
-- ============================================================================

-- ---- anon: only ACTIVE, in-window, CODELESS campaigns are visible -----------
-- Caps, min-order, branch scope and usage limits do NOT affect visibility (they
-- are enforced at compute time by the RPC), so 9 of the 13 fixtures are public:
-- 01 + 06..0d. Hidden: 02 inactive, 03 future, 04 expired, 05 coded.
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.campaigns;
  if n <> 9 then raise exception 'RLS(anon): expected 9 visible (codeless/active/in-window) campaigns, got %', n; end if;
  if not exists (select 1 from public.campaigns where id = '00000000-0000-0000-0000-00000d000001') then
    raise exception 'RLS(anon): the auto-apply campaign is not visible'; end if;
  -- coded / inactive / future / expired must stay hidden.
  if exists (select 1 from public.campaigns where id in (
        '00000000-0000-0000-0000-00000d000002',        -- inactive
        '00000000-0000-0000-0000-00000d000003',        -- future
        '00000000-0000-0000-0000-00000d000004',        -- expired
        '00000000-0000-0000-0000-00000d000005')) then  -- coded
    raise exception 'RLS(anon): a hidden campaign (inactive/future/expired/coded) leaked into SELECT'; end if;
  raise notice 'PHASE 2 anon RLS OK';
end $$;
reset role;

-- ---- customer: same visibility; own redemptions only; no writes -------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c01', true);
set local role authenticated;
do $$
declare n int; blocked boolean;
begin
  -- Only codeless, active, in-window campaigns (9 of 13); coded/inactive/future/expired hidden.
  select count(*) into n from public.campaigns;
  if n <> 9 then raise exception 'RLS(cust): expected 9 visible campaigns, got %', n; end if;
  if exists (select 1 from public.campaigns where code = 'SAVE20') then
    raise exception 'RLS(cust): a SECRET coded campaign leaked into SELECT'; end if;

  -- Own redemptions only (1 of the 2 rows).
  select count(*) into n from public.campaign_redemptions;
  if n <> 1 then raise exception 'RLS(cust): expected 1 own redemption, got %', n; end if;

  -- Cannot write campaigns (RLS with-check is_admin()).
  blocked := false;
  begin
    insert into public.campaigns (name_en, name_ar, type, value)
      values ('hack','هجوم','fixed',5);
  exception when insufficient_privilege or check_violation then blocked := true;
  end;
  if not blocked then raise exception 'RLS(cust): customer was able to INSERT a campaign'; end if;

  -- Cannot write redemptions (no grant at all).
  blocked := false;
  begin
    insert into public.campaign_redemptions (campaign_id, user_id)
      values ('00000000-0000-0000-0000-00000d000001','00000000-0000-0000-0000-000000000c01');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'RLS(cust): customer was able to INSERT a redemption'; end if;

  raise notice 'PHASE 2 customer RLS OK';
end $$;
reset role;

-- ---- admin: sees everything (incl. hidden rows) -----------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000a01', true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.campaigns;
  if n < 13 then raise exception 'RLS(admin): expected all 13 campaigns, got %', n; end if;
  if not exists (select 1 from public.campaigns where code = 'SAVE20') then
    raise exception 'RLS(admin): coded campaign not visible to admin'; end if;
  if not exists (select 1 from public.campaigns where is_active = false) then
    raise exception 'RLS(admin): inactive campaign not visible to admin'; end if;
  -- Admin sees ALL redemptions (both rows).
  select count(*) into n from public.campaign_redemptions;
  if n <> 2 then raise exception 'RLS(admin): expected 2 redemptions, got %', n; end if;
  raise notice 'PHASE 2 admin RLS OK';
end $$;
reset role;

-- ============================================================================
-- Phase 3 — discount math + cap clamping (as owner; auth.uid = customer)
-- ============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c01', true);
do $$
declare r record;
begin
  -- Auto-apply 10% on 100 -> 10.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000001', p_subtotal => 100);
  if not r.valid or r.discount_amount <> 10 then
    raise exception 'MATH: auto 10%% of 100 -> % (valid=%)', r.discount_amount, r.valid; end if;

  -- Secret coded 20% resolved BY CODE (client cannot SELECT it) on 50 -> 10.
  select * into r from public.compute_campaign_discount(p_code => 'save20', p_subtotal => 50);
  if not r.valid or r.discount_amount <> 10 or r.code <> 'SAVE20' then
    raise exception 'MATH: SAVE20 20%% of 50 -> % (code=%, valid=%)', r.discount_amount, r.code, r.valid; end if;

  -- Percentage 50% of 100 capped at 15 -> 15 (cap clamp).
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000006', p_subtotal => 100);
  if not r.valid or r.discount_amount <> 15 then
    raise exception 'MATH: 50%% cap 15 on 100 -> %', r.discount_amount; end if;

  -- Fixed 30 on 100 -> 30.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000007', p_subtotal => 100);
  if not r.valid or r.discount_amount <> 30 then
    raise exception 'MATH: fixed 30 on 100 -> %', r.discount_amount; end if;

  -- Fixed 200 on 100 -> clamped to subtotal 100 (never negative total).
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000008', p_subtotal => 100);
  if not r.valid or r.discount_amount <> 100 then
    raise exception 'MATH: fixed 200 clamps to 100 -> %', r.discount_amount; end if;

  -- free_delivery on a 100 order with an 18 fee -> discount 18, flag true.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d00000b', p_subtotal => 100, p_delivery_fee => 18);
  if not r.valid or r.discount_amount <> 18 or not r.free_delivery then
    raise exception 'MATH: free_delivery fee 18 -> % (free=%)', r.discount_amount, r.free_delivery; end if;

  -- free_delivery on a PICKUP order (fee 0) -> discount 0, flag true.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d00000b', p_subtotal => 100, p_delivery_fee => 0);
  if not r.valid or r.discount_amount <> 0 or not r.free_delivery then
    raise exception 'MATH: free_delivery pickup -> % (free=%)', r.discount_amount, r.free_delivery; end if;

  -- Branch-scoped: valid at the right branch, rejected elsewhere.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d00000a', p_subtotal => 100,
    p_branch_id => '00000000-0000-0000-0000-000000000b01');
  if not r.valid or r.discount_amount <> 10 then
    raise exception 'MATH: branch campaign at right branch -> % (valid=%)', r.discount_amount, r.valid; end if;

  raise notice 'PHASE 3 discount math OK';
end $$;

-- ============================================================================
-- Phase 4 — rejections
-- ============================================================================
do $$
declare r record;
begin
  -- Inactive campaign.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000002', p_subtotal => 100);
  if r.valid or r.discount_amount <> 0 then raise exception 'REJECT: inactive accepted'; end if;

  -- Not started (future).
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000003', p_subtotal => 100);
  if r.valid then raise exception 'REJECT: future campaign accepted'; end if;

  -- Expired.
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000004', p_subtotal => 100);
  if r.valid then raise exception 'REJECT: expired campaign accepted'; end if;

  -- Below minimum order (min 50, subtotal 40).
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000009', p_subtotal => 40);
  if r.valid then raise exception 'REJECT: below-min order accepted'; end if;

  -- Branch mismatch (scoped to b01, asked for b02).
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d00000a', p_subtotal => 100,
    p_branch_id => '00000000-0000-0000-0000-000000000b02');
  if r.valid then raise exception 'REJECT: wrong-branch campaign accepted'; end if;

  -- Per-user limit: customer c01 already redeemed campaign 0c once (limit 1).
  insert into public.campaign_redemptions (campaign_id, user_id)
    values ('00000000-0000-0000-0000-00000d00000c','00000000-0000-0000-0000-000000000c01');
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d00000c', p_subtotal => 100);
  if r.valid then raise exception 'REJECT: per-user limit not enforced'; end if;

  -- Global limit 2: seed 2 redemptions (any users) -> next is rejected.
  insert into public.campaign_redemptions (campaign_id, user_id) values
    ('00000000-0000-0000-0000-00000d00000d','00000000-0000-0000-0000-000000000c01'),
    ('00000000-0000-0000-0000-00000d00000d','00000000-0000-0000-0000-000000000c02');
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d00000d', p_subtotal => 100);
  if r.valid then raise exception 'REJECT: global limit not enforced'; end if;

  -- Unknown code.
  select * into r from public.compute_campaign_discount(p_code => 'NOPE', p_subtotal => 100);
  if r.valid then raise exception 'REJECT: unknown code accepted'; end if;

  raise notice 'PHASE 4 rejections OK';
end $$;

-- ---- Unauthenticated: the auth gate refuses even a valid campaign -----------
select set_config('request.jwt.claim.sub', null, true);
do $$
declare r record;
begin
  select * into r from public.compute_campaign_discount(
    p_campaign_id => '00000000-0000-0000-0000-00000d000001', p_subtotal => 100);
  if r.valid or r.message <> 'Authentication is required' then
    raise exception 'REJECT: unauthenticated call was accepted (valid=%, msg=%)', r.valid, r.message; end if;
  raise notice 'PHASE 4 auth-gate OK';
end $$;

do $$ begin raise notice 'discounts_campaigns_test: ALL CASES PASSED'; end $$;

rollback;
