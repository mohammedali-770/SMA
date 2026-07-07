-- ============================================================================
-- Spicy Meal — app_settings (singleton). Brand + VAT + loyalty configuration.
-- Payment / SMS / push / Lazywait settings are intentionally NOT modelled here
-- (deferred to their own integration migrations).
-- Publicly readable (storefront needs brand + VAT); admin-writable only.
-- ============================================================================

create table if not exists public.app_settings (
  -- Singleton guard: only one row can ever exist (id must be true).
  id                  boolean primary key default true check (id),
  brand_name_en       text not null default 'Spicy Meal',
  brand_name_ar       text not null default 'سبايسي ميل',
  primary_color       text not null default '#422e87',
  secondary_color     text not null default '#e02d3d',
  currency            text not null default 'SAR',
  vat_percentage      numeric(5,2) not null default 15 check (vat_percentage >= 0 and vat_percentage <= 100),
  loyalty_enabled     boolean not null default true,
  points_per_riyal    numeric(10,2) not null default 1 check (points_per_riyal >= 0),
  discount_per_point  numeric(10,4) not null default 0.10 check (discount_per_point >= 0),
  min_points_to_redeem integer not null default 100 check (min_points_to_redeem >= 0),
  updated_at          timestamptz not null default now()
);

drop trigger if exists set_app_settings_updated_at on public.app_settings;
create trigger set_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Seed the single settings row (idempotent).
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant update on public.app_settings to authenticated;

drop policy if exists app_settings_select_public on public.app_settings;
create policy app_settings_select_public on public.app_settings
  for select to anon, authenticated using (true);

drop policy if exists app_settings_admin_update on public.app_settings;
create policy app_settings_admin_update on public.app_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
