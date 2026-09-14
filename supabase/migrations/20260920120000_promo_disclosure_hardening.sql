-- ============================================================================
-- Spicy Meal — promo disclosure hardening (security audit 2026-09-14)
--
-- WHAT IS WRONG TODAY. `validate_coupon` and `compute_campaign_discount` are
-- both `security definer` and both granted to `authenticated`, and both describe
-- a promotion the caller cannot use:
--
--   * `validate_coupon` returns the coupon's TYPE and VALUE on every refusal.
--     A code that has not started yet answers 'Coupon is not active yet' with
--     its terms attached, so an unlaunched campaign is readable before launch.
--   * `compute_campaign_discount` is worse, because it contradicts a policy that
--     already exists. The RLS policy on `campaigns` deliberately hides coded,
--     inactive, future and expired rows from a customer — and this definer
--     function handed back `name_en`, `name_ar`, `type`, `code` and the row id
--     for exactly those rows. The RPC undid the policy.
--
-- Codes are guessable by design: the two that have existed in Production are
-- `SPICY15` and `RIYADH10`, which is what a marketing code looks like. Nothing
-- rate-limits the RPC, so the namespace is enumerable, and every probe used to
-- come back with the terms of whatever it found.
--
-- WHAT CHANGES.
--   1. NOT FOUND, SWITCHED OFF and NOT YET STARTED return one identical answer.
--      Those states belong to a code that has never been handed to a customer.
--      EXPIRED and EXHAUSTED keep their own messages on purpose: such a code WAS
--      published, so its existence is not a secret, and a customer holding one
--      deserves to be told which it is.
--   2. The descriptive fields are returned ONLY when the answer is `valid`.
--      One rule rather than a judgement per branch, so it can be verified by
--      counting references rather than by reading.
--   3. A campaign refusal echoes the code the CALLER SUPPLIED, never the row's.
--      A campaign addressed by id must not have its secret promo code read back.
--
-- WHAT DOES NOT CHANGE. The money path. `place_order` and
-- `compute_order_snapshot` read only `valid`, `message` and `discount_amount`
-- from `validate_coupon` — verified live before this file was written — and all
-- three are untouched, as is the success path of both functions. The signatures
-- are unchanged, so existing callers bind to the new bodies and NO DEPLOY IS
-- IMPLIED.
--
-- CLIENT IMPACT: NONE. `src/lib/api.ts` and `apps/mobile/src/services/api.ts`
-- both type the coupon result as { valid, code, discount_amount, message } and
-- never read `type` or `value`. `src/lib/campaigns.ts` types every descriptive
-- field nullable already and uses none of them on a failure.
--
-- DERIVED, NOT RETYPED. Both bodies are extracted from the migrations that
-- define them — `20260707120400_coupons.sql` and
-- `20260728120000_discounts_campaigns.sql`, the only ones that ever have — and
-- transformed by anchored substitution, each anchor asserted to occur an exact
-- number of times. The pre-image of each was hashed against the LIVE body first
-- (`51d3805e52ddf0bda03cce4b980db4bf` and `4d8a5cf3ff954653baf1ae51847c4b9c`,
-- both identical), so the derivation starts from what Production actually runs.
-- ============================================================================

create or replace function public.validate_coupon(p_code text, p_subtotal numeric)
returns table (
  valid           boolean,
  code            text,
  type            public.coupon_type,
  value           numeric,
  discount_amount numeric,
  message         text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  c          public.coupons;
  v_norm     text := upper(trim(coalesce(p_code, '')));
  v_discount numeric(10,2) := 0;
begin
  if v_norm = '' then
    return query select false, null::text, null::public.coupon_type, null::numeric, 0::numeric, 'No code supplied';
    return;
  end if;

  select * into c from public.coupons cp where cp.code = v_norm;
  if not found then
    return query select false, v_norm, null::public.coupon_type, null::numeric, 0::numeric, 'Coupon not found';
    return;
  end if;
  -- SWITCHED OFF OR NOT YET STARTED IS REPORTED AS "NOT FOUND", byte for byte.
  -- Those two states belong to a code that has never been handed to a customer,
  -- so distinguishing them confirms that an unlaunched campaign exists and, in
  -- the old body, disclosed its type and value with it. An expired or
  -- exhausted code is different: it WAS published, so its existence is not a
  -- secret and a precise message is worth more than the silence.
  if not c.is_active
     or (c.starts_at is not null and now() < c.starts_at) then
    return query select false, v_norm, null::public.coupon_type, null::numeric, 0::numeric, 'Coupon not found';
    return;
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    return query select false, c.code, null::public.coupon_type, null::numeric, 0::numeric, 'Coupon has expired';
    return;
  end if;
  if c.usage_limit is not null and c.usage_count >= c.usage_limit then
    return query select false, c.code, null::public.coupon_type, null::numeric, 0::numeric, 'Coupon usage limit reached';
    return;
  end if;
  if coalesce(p_subtotal, 0) < c.min_order_amount then
    return query select false, c.code, null::public.coupon_type, null::numeric, 0::numeric, 'Order is below the coupon minimum';
    return;
  end if;

  if c.type = 'percentage' then
    v_discount := round(coalesce(p_subtotal, 0) * c.value / 100.0, 2);
  else
    v_discount := c.value;
  end if;
  if c.max_discount_amount is not null then
    v_discount := least(v_discount, c.max_discount_amount);
  end if;
  v_discount := least(v_discount, coalesce(p_subtotal, 0));

  return query select true, c.code, c.type, c.value, v_discount, 'OK';
end $$;

revoke all on function public.validate_coupon(text, numeric) from public, anon;
grant execute on function public.validate_coupon(text, numeric) to authenticated;

create or replace function public.compute_campaign_discount(
  p_code         text    default null,
  p_campaign_id  uuid    default null,
  p_subtotal     numeric default 0,
  p_delivery_fee numeric default 0,
  p_branch_id    uuid    default null
)
returns table (
  valid           boolean,
  campaign_id     uuid,
  code            text,
  type            text,
  name_en         text,
  name_ar         text,
  discount_amount numeric,
  free_delivery   boolean,
  message         text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid         uuid          := auth.uid();
  c             public.campaigns;
  v_norm        text          := nullif(upper(trim(coalesce(p_code, ''))), '');
  v_sub         numeric(10,2) := round(greatest(0, coalesce(p_subtotal, 0)), 2);
  v_fee         numeric(10,2) := round(greatest(0, coalesce(p_delivery_fee, 0)), 2);
  v_discount    numeric(10,2) := 0;
  v_free_deliv  boolean       := false;
  v_used        integer       := 0;
begin
  -- Auth gate: only a signed-in customer may evaluate a campaign.
  if v_uid is null then
    return query select false, null::uuid, null::text, null::text, null::text, null::text,
                        0::numeric, false, 'Authentication is required';
    return;
  end if;

  -- Resolve by explicit id first (auto-apply), else by normalized code.
  if p_campaign_id is not null then
    select * into c from public.campaigns cc where cc.id = p_campaign_id;
  elsif v_norm is not null then
    select * into c from public.campaigns cc where cc.code = v_norm;
  else
    return query select false, null::uuid, null::text, null::text, null::text, null::text,
                        0::numeric, false, 'No campaign or code supplied';
    return;
  end if;

  -- THE RLS POLICY ON `campaigns` HIDES CODED, INACTIVE, FUTURE AND EXPIRED
  -- ROWS FROM A CUSTOMER, AND THIS FUNCTION IS `security definer`, SO IT USED TO
  -- HAND BACK EXACTLY WHAT THAT POLICY CONCEALS: name_en, name_ar and type for a
  -- campaign nobody was meant to be able to see yet. Not-found, switched off and
  -- not-yet-started now return one identical answer.
  --
  -- `not found` is evaluated first and `true or <null>` is true, so the all-NULL
  -- record left by a missed `select into` cannot turn this condition NULL.
  if not found
     or not c.is_active
     or (c.starts_at is not null and now() < c.starts_at) then
    return query select false, null::uuid, v_norm, null::text, null::text, null::text,
                        0::numeric, false, 'Campaign not found';
    return;
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    return query select false, null::uuid, v_norm, null::text, null::text, null::text,
                        0::numeric, false, 'Campaign has expired';
    return;
  end if;

  -- Branch scoping: a branch-scoped campaign applies only at that branch.
  if c.branch_id is not null and (p_branch_id is null or p_branch_id <> c.branch_id) then
    return query select false, null::uuid, v_norm, null::text, null::text, null::text,
                        0::numeric, false, 'Campaign is not available at this branch';
    return;
  end if;

  -- Minimum order, against the SERVER-computed merchandise subtotal.
  if v_sub < c.min_order_amount then
    return query select false, null::uuid, v_norm, null::text, null::text, null::text,
                        0::numeric, false, 'Order is below the campaign minimum';
    return;
  end if;

  -- Per-user limit (count this user's redemptions of this campaign).
  if c.per_user_limit is not null then
    select count(*) into v_used from public.campaign_redemptions r
      where r.campaign_id = c.id and r.user_id = v_uid;
    if v_used >= c.per_user_limit then
      return query select false, null::uuid, v_norm, null::text, null::text, null::text,
                          0::numeric, false, 'Per-user redemption limit reached';
      return;
    end if;
  end if;

  -- Global limit (count all redemptions of this campaign).
  if c.global_limit is not null then
    select count(*) into v_used from public.campaign_redemptions r
      where r.campaign_id = c.id;
    if v_used >= c.global_limit then
      return query select false, null::uuid, v_norm, null::text, null::text, null::text,
                          0::numeric, false, 'Campaign redemption limit reached';
      return;
    end if;
  end if;

  -- Server-computed discount, clamped to caps. The client NEVER supplies it.
  if c.type = 'percentage' then
    v_discount := round(v_sub * c.value / 100.0, 2);
    if c.max_discount_amount is not null then
      v_discount := least(v_discount, c.max_discount_amount);
    end if;
    v_discount := least(v_discount, v_sub);
  elsif c.type = 'fixed' then
    v_discount := c.value;
    if c.max_discount_amount is not null then
      v_discount := least(v_discount, c.max_discount_amount);
    end if;
    v_discount := least(v_discount, v_sub);
  elsif c.type = 'free_delivery' then
    v_free_deliv := true;
    v_discount   := v_fee;   -- waive the delivery fee (0 for pickup orders)
  end if;

  return query select true, c.id, c.code, c.type, c.name_en, c.name_ar,
                      v_discount, v_free_deliv, 'OK';
end $$;

revoke all on function public.compute_campaign_discount(text, uuid, numeric, numeric, uuid)
  from public, anon;
grant execute on function public.compute_campaign_discount(text, uuid, numeric, numeric, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Self-verification. Two kinds, kept apart on purpose.
--
-- The SOURCE-LEVEL half counts references in the stored bodies, which is how a
-- "terms only on the valid path" rule is checked without reading prose.
--
-- The BEHAVIOURAL half matters more, because a `plpgsql` body is not
-- name-resolved at creation: a wrong column reference applies cleanly and
-- raises at the first call. `validate_coupon` is therefore CALLED against a
-- fixture written inside a sub-transaction that is then aborted, and the
-- rollback is proven afterwards rather than assumed. `compute_campaign_discount`
-- cannot be driven that far from a migration — it gates on `auth.uid()`, which
-- is null here — so it is called only as far as that gate, which still resolves
-- every name in its declaration section. Its refusal branches are covered by
-- `supabase/tests/promo_disclosure_test.sql`, and that is said rather than
-- glossed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_vc  text;
  v_cc  text;
  v_n   integer;
  r     record;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'validate_coupon';
  if v_n <> 1 then raise exception 'VERIFY: expected 1 validate_coupon overload, found %', v_n; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'compute_campaign_discount';
  if v_n <> 1 then raise exception 'VERIFY: expected 1 compute_campaign_discount overload, found %', v_n; end if;

  select p.prosrc into v_vc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'validate_coupon';
  select p.prosrc into v_cc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'compute_campaign_discount';
  if v_vc is null or v_cc is null then raise exception 'VERIFY: a body could not be read'; end if;

  -- The retracted messages are the disclosure. None may survive.
  if v_vc like '%Coupon is inactive%' then raise exception 'VERIFY: validate_coupon still distinguishes an inactive coupon'; end if;
  if v_vc like '%Coupon is not active yet%' then raise exception 'VERIFY: validate_coupon still distinguishes a scheduled coupon'; end if;
  if v_cc like '%Campaign is not active%' then raise exception 'VERIFY: compute_campaign_discount still distinguishes an inactive campaign'; end if;
  if v_cc like '%Campaign has not started yet%' then raise exception 'VERIFY: compute_campaign_discount still distinguishes a scheduled campaign'; end if;

  -- Terms only on the valid path, counted rather than read. validate_coupon
  -- keeps `c.type` twice (the success return and the percentage test) and
  -- `c.value` three times (the success return and both discount computations);
  -- compute_campaign_discount keeps each name field exactly once.
  v_n := (length(v_vc) - length(replace(v_vc, 'c.type', ''))) / length('c.type');
  if v_n <> 2 then raise exception 'VERIFY: validate_coupon references c.type % times, expected 2', v_n; end if;
  v_n := (length(v_vc) - length(replace(v_vc, 'c.value', ''))) / length('c.value');
  if v_n <> 3 then raise exception 'VERIFY: validate_coupon references c.value % times, expected 3', v_n; end if;
  v_n := (length(v_cc) - length(replace(v_cc, 'c.name_en', ''))) / length('c.name_en');
  if v_n <> 1 then raise exception 'VERIFY: compute_campaign_discount references c.name_en % times, expected 1', v_n; end if;
  v_n := (length(v_cc) - length(replace(v_cc, 'c.name_ar', ''))) / length('c.name_ar');
  if v_n <> 1 then raise exception 'VERIFY: compute_campaign_discount references c.name_ar % times, expected 1', v_n; end if;

  -- The boundary the whole design rests on: neither is reachable anonymously.
  if has_function_privilege('anon', 'public.validate_coupon(text, numeric)', 'execute') then
    raise exception 'VERIFY: anon can execute validate_coupon'; end if;
  if has_function_privilege('anon', 'public.compute_campaign_discount(text, uuid, numeric, numeric, uuid)', 'execute') then
    raise exception 'VERIFY: anon can execute compute_campaign_discount'; end if;
  if not has_function_privilege('authenticated', 'public.validate_coupon(text, numeric)', 'execute') then
    raise exception 'VERIFY: authenticated lost validate_coupon'; end if;
  if not has_function_privilege('authenticated', 'public.compute_campaign_discount(text, uuid, numeric, numeric, uuid)', 'execute') then
    raise exception 'VERIFY: authenticated lost compute_campaign_discount'; end if;

  -- BEHAVIOURAL. A fixture written and then thrown away: the raise at the end
  -- aborts this sub-transaction, so nothing here is committed.
  begin
    insert into public.coupons (code, type, value, is_active, starts_at)
      values ('ZZPROMOVERIFY', 'percentage', 15, false, null);
    insert into public.coupons (code, type, value, is_active, starts_at)
      values ('ZZPROMOFUTURE', 'fixed', 25, true, now() + interval '30 days');

    select * into r from public.validate_coupon('ZZPROMOVERIFY', 100);
    if r.valid then raise exception 'VERIFY: an inactive coupon was accepted'; end if;
    if r.message is distinct from 'Coupon not found' then
      raise exception 'VERIFY: an inactive coupon answered %, which distinguishes it', coalesce(r.message, '<null>'); end if;
    if r.type is not null or r.value is not null then
      raise exception 'VERIFY: an inactive coupon disclosed its terms'; end if;

    select * into r from public.validate_coupon('ZZPROMOFUTURE', 100);
    if r.valid then raise exception 'VERIFY: a scheduled coupon was accepted'; end if;
    if r.message is distinct from 'Coupon not found' then
      raise exception 'VERIFY: a scheduled coupon answered %, which announces an unlaunched campaign', coalesce(r.message, '<null>'); end if;
    if r.type is not null or r.value is not null then
      raise exception 'VERIFY: a scheduled coupon disclosed its terms'; end if;

    -- And the control: a code that truly does not exist must be identical.
    select * into r from public.validate_coupon('ZZPROMOABSENT', 100);
    if r.message is distinct from 'Coupon not found' or r.type is not null or r.value is not null then
      raise exception 'VERIFY: the not-found answer is not the one the other two now give'; end if;

    raise exception 'ROLLBACK_PROBE';
  exception
    when others then
      if sqlerrm is distinct from 'ROLLBACK_PROBE' then raise; end if;
  end;

  -- The probe is only honest if the rollback is proven, not assumed.
  if exists (select 1 from public.coupons where code in ('ZZPROMOVERIFY', 'ZZPROMOFUTURE')) then
    raise exception 'VERIFY: a probe coupon survived the sub-transaction';
  end if;

  -- Name resolution for the campaign body, as far as its own gate allows.
  select * into r from public.compute_campaign_discount(p_code => 'ZZPROMOABSENT', p_subtotal => 100);
  if r.valid then raise exception 'VERIFY: compute_campaign_discount accepted an unauthenticated caller'; end if;
  if r.message is distinct from 'Authentication is required' then
    raise exception 'VERIFY: compute_campaign_discount answered % from a null auth.uid()', coalesce(r.message, '<null>'); end if;
end $$;
