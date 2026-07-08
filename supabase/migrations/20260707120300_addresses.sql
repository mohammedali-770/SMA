-- ============================================================================
-- Spicy Meal — customer saved addresses. Strict customer isolation.
-- ============================================================================

create table if not exists public.addresses (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references public.profiles(id) on delete cascade,
  label                  text,
  description            text,
  -- Saudi National Short Address: 4 letters + 4 digits (e.g. RRBB1234).
  national_short_address text check (
    national_short_address is null
    or national_short_address ~ '^[A-Z]{4}[0-9]{4}$'
  ),
  latitude               double precision,
  longitude              double precision,
  is_default             boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists addresses_customer_id_idx on public.addresses(customer_id);

drop trigger if exists set_addresses_updated_at on public.addresses;
create trigger set_addresses_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

alter table public.addresses enable row level security;

revoke all on public.addresses from anon, authenticated;
grant select, insert, update, delete on public.addresses to authenticated;

-- A customer fully manages their own addresses.
drop policy if exists addresses_own_all on public.addresses;
create policy addresses_own_all on public.addresses
  for all to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- Staff (admin/accountant) may read addresses (e.g. to view an order's
-- delivery target) but not modify them.
drop policy if exists addresses_staff_read on public.addresses;
create policy addresses_staff_read on public.addresses
  for select to authenticated
  using (public.is_staff());
