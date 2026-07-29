-- ============================================================================
-- Spicy Meal — app-level discounts & promotional campaigns (GitHub #100).
--
-- Purely ADDITIVE: creates two new tables (campaigns, campaign_redemptions),
-- their RLS + policies, an updated_at trigger, and ONE server-authoritative
-- validation RPC (compute_campaign_discount). It does NOT modify orders,
-- place_order, coupons, payments, Lazywait, or any existing policy/function.
-- Wiring the discount into place_order is a deliberate follow-up (see the
-- SERVER-AUTHORITATIVE note on the RPC below and docs/DISCOUNTS_CAMPAIGNS.md).
--
-- Security model (mirrors coupons + homepage_banners conventions):
--   * campaigns: deny-all by default. anon + customers may SELECT only ACTIVE,
--     in-window, CODELESS (auto-apply) campaigns — coded campaigns stay secret
--     and are reachable only through compute_campaign_discount(), exactly like
--     coupons. Staff (admin+accountant) may read all rows; only admins write.
--   * campaign_redemptions: deny-all writes for every client. Customers may read
--     only their OWN rows; staff read all. Rows are written only by the
--     SECURITY DEFINER order path (never by a client), so usage limits cannot be
--     bypassed by a tampered client.
--   * compute_campaign_discount() is SECURITY DEFINER + STABLE, pinned to
--     search_path=public, revoked from public/anon, granted to authenticated.
--     It re-validates window / limits / min-order and returns a SERVER-COMPUTED,
--     cap-clamped discount. The client can never dictate the discount amount.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  name_en             text not null,
  name_ar             text not null,
  description_en      text,
  description_ar      text,
  type                text not null
                        check (type in ('percentage', 'fixed', 'free_delivery')),
  -- percentage: 0..100 (a percent). fixed: an amount in SAR. free_delivery: 0.
  value               numeric(10,2) not null default 0 check (value >= 0),
  -- Optional promo code. Unique WHEN PRESENT (partial index below); stored
  -- uppercase. NULL code = auto-apply campaign (advertised, not secret).
  code                text
                        check (code is null or (code = upper(code) and length(code) between 3 and 32)),
  starts_at           timestamptz,
  ends_at             timestamptz,
  min_order_amount    numeric(10,2) not null default 0 check (min_order_amount >= 0),
  -- Cap for percentage discounts (max SAR off). NULL = uncapped.
  max_discount_amount numeric(10,2) check (max_discount_amount is null or max_discount_amount >= 0),
  -- Usage caps. NULL = unlimited. Enforced by counting campaign_redemptions.
  per_user_limit      integer check (per_user_limit is null or per_user_limit >= 0),
  global_limit        integer check (global_limit is null or global_limit >= 0),
  -- Optional branch scoping: NULL = every branch; else applies only at this one.
  branch_id           uuid references public.branches(id) on delete cascade,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null,
  -- A percentage's value is a percent, so it must be <= 100.
  constraint campaigns_percentage_range
    check (type <> 'percentage' or value <= 100),
  -- free_delivery carries no numeric value (the waiver is the delivery fee).
  constraint campaigns_free_delivery_zero_value
    check (type <> 'free_delivery' or value = 0),
  -- A window, when both bounds are set, must be ordered.
  constraint campaigns_window_ordered
    check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

comment on table public.campaigns is
  'App-level discount / promotional campaigns (#100). Customers read only active, in-window, codeless rows; coded campaigns are validated via compute_campaign_discount(); admins manage.';
comment on column public.campaigns.value is
  'percentage: percent 0..100. fixed: SAR amount. free_delivery: 0 (the waiver is the delivery fee).';
comment on column public.campaigns.code is
  'Optional promo code, uppercase, unique when present. NULL = auto-apply (advertised) campaign.';

-- Unique only when a code is present (multiple NULL/codeless campaigns allowed).
create unique index if not exists campaigns_code_key
  on public.campaigns (code) where code is not null;
-- Fast path for the public "active, in-window" read.
create index if not exists campaigns_active_idx
  on public.campaigns (is_active, starts_at, ends_at);
create index if not exists campaigns_branch_idx
  on public.campaigns (branch_id);

drop trigger if exists set_campaigns_updated_at on public.campaigns;
create trigger set_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaign_redemptions — the source of truth for usage limits.
-- Append-only; written only by the SECURITY DEFINER order path, never a client.
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_redemptions (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  order_id        uuid references public.orders(id) on delete set null,
  discount_amount numeric(10,2) not null default 0 check (discount_amount >= 0),
  redeemed_at     timestamptz not null default now()
);

comment on table public.campaign_redemptions is
  'One row per campaign redemption. Source of truth for per_user_limit / global_limit. Written only by the server order path; clients may read only their own rows.';

create index if not exists campaign_redemptions_campaign_idx
  on public.campaign_redemptions (campaign_id);
create index if not exists campaign_redemptions_user_idx
  on public.campaign_redemptions (user_id, campaign_id);
-- One redemption per (campaign, order): makes a retried checkout idempotent and
-- prevents a single order from being counted twice against the same campaign.
create unique index if not exists campaign_redemptions_order_uniq
  on public.campaign_redemptions (campaign_id, order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- RLS — campaigns
-- ---------------------------------------------------------------------------
alter table public.campaigns enable row level security;

revoke all on public.campaigns from anon, authenticated;
grant select on public.campaigns to anon, authenticated;
grant insert, update, delete on public.campaigns to authenticated;

-- Public/customer: only ACTIVE, in-window, CODELESS (auto-apply) campaigns.
-- Coded campaigns are never listed — they are validated via the RPC only.
drop policy if exists campaigns_select_public on public.campaigns;
create policy campaigns_select_public on public.campaigns
  for select to anon, authenticated
  using (
    is_active
    and code is null
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  );

-- Staff (admin + accountant) may read ALL campaigns for management/preview.
drop policy if exists campaigns_select_staff on public.campaigns;
create policy campaigns_select_staff on public.campaigns
  for select to authenticated
  using (public.is_staff());

-- Only admins may write.
drop policy if exists campaigns_admin_insert on public.campaigns;
create policy campaigns_admin_insert on public.campaigns
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists campaigns_admin_update on public.campaigns;
create policy campaigns_admin_update on public.campaigns
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists campaigns_admin_delete on public.campaigns;
create policy campaigns_admin_delete on public.campaigns
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- RLS — campaign_redemptions
-- ---------------------------------------------------------------------------
alter table public.campaign_redemptions enable row level security;

revoke all on public.campaign_redemptions from anon, authenticated;
-- Read-only for clients. No INSERT/UPDATE/DELETE grant → clients can never write
-- redemptions directly (the server order path, SECURITY DEFINER, does the write).
grant select on public.campaign_redemptions to authenticated;

drop policy if exists campaign_redemptions_select_own_or_staff on public.campaign_redemptions;
create policy campaign_redemptions_select_own_or_staff on public.campaign_redemptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- No write policies: with no write grant AND no permissive write policy, every
-- client INSERT/UPDATE/DELETE is denied (deny-by-default, double-locked).

-- ---------------------------------------------------------------------------
-- compute_campaign_discount: server-authoritative validation + discount.
--
-- SERVER-AUTHORITATIVE: like validate_coupon(), this returns a SERVER-COMPUTED
-- discount for a given subtotal — it never accepts a client-sent discount. The
-- authoritative guarantee is delivered at order time: the order path must call
-- this with its OWN server-recomputed p_subtotal / p_delivery_fee (never the
-- client's claimed totals) and record a campaign_redemptions row. A direct
-- client call is only a PREVIEW; it cannot change what a real order is charged.
--
-- Resolves a campaign by explicit id (auto-apply) OR by code (secret promo).
-- Re-checks: auth, is_active, window, branch scope, min-order, per-user limit,
-- global limit. Percentage discounts are clamped by max_discount_amount and by
-- the subtotal; free_delivery returns the delivery fee as the waiver amount.
-- ---------------------------------------------------------------------------
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

  if not found then
    return query select false, null::uuid, v_norm, null::text, null::text, null::text,
                        0::numeric, false, 'Campaign not found';
    return;
  end if;

  if not c.is_active then
    return query select false, c.id, c.code, c.type, c.name_en, c.name_ar,
                        0::numeric, false, 'Campaign is not active';
    return;
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return query select false, c.id, c.code, c.type, c.name_en, c.name_ar,
                        0::numeric, false, 'Campaign has not started yet';
    return;
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    return query select false, c.id, c.code, c.type, c.name_en, c.name_ar,
                        0::numeric, false, 'Campaign has expired';
    return;
  end if;

  -- Branch scoping: a branch-scoped campaign applies only at that branch.
  if c.branch_id is not null and (p_branch_id is null or p_branch_id <> c.branch_id) then
    return query select false, c.id, c.code, c.type, c.name_en, c.name_ar,
                        0::numeric, false, 'Campaign is not available at this branch';
    return;
  end if;

  -- Minimum order, against the SERVER-computed merchandise subtotal.
  if v_sub < c.min_order_amount then
    return query select false, c.id, c.code, c.type, c.name_en, c.name_ar,
                        0::numeric, false, 'Order is below the campaign minimum';
    return;
  end if;

  -- Per-user limit (count this user's redemptions of this campaign).
  if c.per_user_limit is not null then
    select count(*) into v_used from public.campaign_redemptions r
      where r.campaign_id = c.id and r.user_id = v_uid;
    if v_used >= c.per_user_limit then
      return query select false, c.id, c.code, c.type, c.name_en, c.name_ar,
                          0::numeric, false, 'Per-user redemption limit reached';
      return;
    end if;
  end if;

  -- Global limit (count all redemptions of this campaign).
  if c.global_limit is not null then
    select count(*) into v_used from public.campaign_redemptions r
      where r.campaign_id = c.id;
    if v_used >= c.global_limit then
      return query select false, c.id, c.code, c.type, c.name_en, c.name_ar,
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
