-- ============================================================================
-- Spicy Meal — coupons. Managed by admins only; codes are NOT client-readable.
-- Clients validate a code through the validate_coupon() RPC, which never
-- exposes the coupon table or other codes.
-- ============================================================================

create table if not exists public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique
                        check (code = upper(code) and length(code) between 3 and 32),
  type                public.coupon_type not null,
  value               numeric(10,2) not null check (value >= 0),
  is_active           boolean not null default true,
  min_order_amount    numeric(10,2) not null default 0 check (min_order_amount >= 0),
  max_discount_amount numeric(10,2) check (max_discount_amount is null or max_discount_amount >= 0),
  starts_at           timestamptz,
  ends_at             timestamptz,
  usage_limit         integer check (usage_limit is null or usage_limit >= 0),
  usage_count         integer not null default 0 check (usage_count >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists set_coupons_updated_at on public.coupons;
create trigger set_coupons_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

alter table public.coupons enable row level security;

revoke all on public.coupons from anon, authenticated;
grant select, insert, update, delete on public.coupons to authenticated;

-- Admin-only for every command. No public/customer SELECT: codes stay secret.
drop policy if exists coupons_admin_all on public.coupons;
create policy coupons_admin_all on public.coupons
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- validate_coupon: safe read-only validation for clients/checkout.
-- Returns the computed discount for a subtotal without leaking the table.
-- (Usage counting happens atomically inside place_order, not here.)
-- ---------------------------------------------------------------------------
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
  if not c.is_active then
    return query select false, c.code, c.type, c.value, 0::numeric, 'Coupon is inactive';
    return;
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return query select false, c.code, c.type, c.value, 0::numeric, 'Coupon is not active yet';
    return;
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    return query select false, c.code, c.type, c.value, 0::numeric, 'Coupon has expired';
    return;
  end if;
  if c.usage_limit is not null and c.usage_count >= c.usage_limit then
    return query select false, c.code, c.type, c.value, 0::numeric, 'Coupon usage limit reached';
    return;
  end if;
  if coalesce(p_subtotal, 0) < c.min_order_amount then
    return query select false, c.code, c.type, c.value, 0::numeric, 'Order is below the coupon minimum';
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
