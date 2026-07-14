-- Spicy Meal — push notifications: device registry + send idempotency.
--
-- push_devices: one row per (customer, Expo push token). The customer app
-- registers/updates its own device rows; customers can NEVER read or write
-- another customer's devices (RLS below). Preferences live per device:
--   order_updates_enabled default TRUE  (order status pushes)
--   promos_enabled        default FALSE (promotions are strictly OPT-IN)
--
-- notification_log: idempotency ledger — one row per (order, status) send, so
-- the same order status can never be pushed twice even if two callers race
-- (unique index + insert-first in the push-dispatch function).
--
-- MASTER FLAG: sending stays disabled until the admin enables the existing
-- integration_settings row (provider_type='push', provider_name='expo') —
-- seeded disabled. push-dispatch is a no-op while it is off.

create table if not exists public.push_devices (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references public.profiles(id) on delete cascade,
  expo_push_token        text not null unique,
  platform               text not null default 'android' check (platform in ('android', 'ios')),
  lang                   text not null default 'en' check (lang in ('en', 'ar')),
  is_active              boolean not null default true,
  order_updates_enabled  boolean not null default true,
  promos_enabled         boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists push_devices_customer_idx on public.push_devices (customer_id);
create index if not exists push_devices_active_promos_idx on public.push_devices (is_active, promos_enabled);

drop trigger if exists set_push_devices_updated_at on public.push_devices;
create trigger set_push_devices_updated_at
  before update on public.push_devices
  for each row execute function public.set_updated_at();

alter table public.push_devices enable row level security;

-- Customers manage ONLY their own devices. No DELETE policy — devices are
-- deactivated (is_active=false), never client-deleted, so dispatch history
-- stays consistent. Service role (push-dispatch) bypasses RLS for send-time
-- reads and DeviceNotRegistered deactivation.
drop policy if exists push_devices_select_own on public.push_devices;
create policy push_devices_select_own on public.push_devices
  for select using (auth.uid() = customer_id);

drop policy if exists push_devices_insert_own on public.push_devices;
create policy push_devices_insert_own on public.push_devices
  for insert with check (auth.uid() = customer_id);

drop policy if exists push_devices_update_own on public.push_devices;
create policy push_devices_update_own on public.push_devices
  for update using (auth.uid() = customer_id) with check (auth.uid() = customer_id);

-- Admin dashboard: read-only visibility (device/opt-in counts).
drop policy if exists push_devices_admin_select on public.push_devices;
create policy push_devices_admin_select on public.push_devices
  for select using (public.is_admin());

-- --------------------------------------------------------------------------

create table if not exists public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('order_status', 'test', 'broadcast')),
  order_id    uuid references public.orders(id) on delete cascade,
  status      text,
  targeted    integer not null default 0,
  sent        integer not null default 0,
  failed      integer not null default 0,
  deactivated integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Idempotency: at most ONE send per (order, status).
create unique index if not exists notification_log_order_status_uq
  on public.notification_log (order_id, status)
  where kind = 'order_status';

alter table public.notification_log enable row level security;

-- No customer policies at all: only the service role (push-dispatch) writes,
-- and only admins can read the delivery counts.
drop policy if exists notification_log_admin_select on public.notification_log;
create policy notification_log_admin_select on public.notification_log
  for select using (public.is_admin());
