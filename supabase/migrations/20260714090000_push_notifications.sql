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
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('order_status', 'test', 'broadcast')),
  order_id        uuid references public.orders(id) on delete cascade,
  status          text,
  -- Send lifecycle (order_status rows): processing → sent | failed | no_targets.
  --   processing → another call is in flight; concurrent callers back off.
  --   sent / no_targets → terminal, idempotent (never re-sent).
  --   failed (TOTAL transient failure, zero devices reached) → may be
  --     atomically reclaimed for a controlled retry.
  -- PARTIAL sends (some devices ok, some failed) are recorded as 'sent' with
  -- counts + last_error_safe — deliberately NOT retryable, so devices that
  -- already received the push can never get it twice.
  send_status     text not null default 'processing'
                    check (send_status in ('processing', 'sent', 'failed', 'no_targets')),
  attempt_count   integer not null default 1,
  last_error_safe text,
  targeted        integer not null default 0,
  sent            integer not null default 0,
  failed          integer not null default 0,
  deactivated     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists set_notification_log_updated_at on public.notification_log;
create trigger set_notification_log_updated_at
  before update on public.notification_log
  for each row execute function public.set_updated_at();

-- Idempotency/claim key: at most ONE row per (order, status); the row's
-- send_status is the lifecycle lock (insert-first claim, atomic reclaim of
-- 'failed' rows only).
create unique index if not exists notification_log_order_status_uq
  on public.notification_log (order_id, status)
  where kind = 'order_status';

alter table public.notification_log enable row level security;

-- No customer policies at all: only the service role (push-dispatch) writes,
-- and only admins can read the delivery counts.
drop policy if exists notification_log_admin_select on public.notification_log;
create policy notification_log_admin_select on public.notification_log
  for select using (public.is_admin());

-- --------------------------------------------------------------------------
-- Registration RPCs (SECURITY DEFINER).
--
-- Why not plain client upserts: an Expo push token identifies the PHYSICAL
-- DEVICE and survives account switches. With owner-scoped RLS alone, a new
-- account on a shared phone could neither claim nor silence the previous
-- owner's row — the old account's pushes would keep arriving (review P1).
-- Presenting the token proves possession of the device, so:
--   register_push_device  → upserts by token and REASSIGNS the row to the
--                           calling user (old owner's targeting stops).
--   deactivate_push_device → deactivates the row for this token regardless
--                           of owner (used on sign-out from the device).

create or replace function public.register_push_device(
  p_token text,
  p_platform text,
  p_lang text,
  p_order_updates boolean,
  p_promos boolean
) returns public.push_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.push_devices;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- Expo token format only (ExponentPushToken[…] / ExpoPushToken[…]) — the
  -- registry can never hold arbitrary strings.
  if p_token is null
     or length(trim(p_token)) < 10
     or length(trim(p_token)) > 200
     or trim(p_token) !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'invalid token';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'invalid platform';
  end if;
  if p_lang not in ('en', 'ar') then
    raise exception 'invalid lang';
  end if;

  insert into public.push_devices
    (customer_id, expo_push_token, platform, lang, is_active, order_updates_enabled, promos_enabled)
  values
    (auth.uid(), trim(p_token), p_platform, p_lang, true, coalesce(p_order_updates, true), coalesce(p_promos, false))
  on conflict (expo_push_token) do update set
    customer_id           = auth.uid(),   -- device changed hands → reassign
    platform              = excluded.platform,
    lang                  = excluded.lang,
    is_active             = true,
    order_updates_enabled = excluded.order_updates_enabled,
    promos_enabled        = excluded.promos_enabled
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.deactivate_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- Token possession == device possession: sign-out silences this device even
  -- if the row is still owned by a previous account on the same phone.
  update public.push_devices
     set is_active = false
   where expo_push_token = trim(p_token);
end;
$$;

revoke all on function public.register_push_device(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.register_push_device(text, text, text, boolean, boolean) to authenticated;
revoke all on function public.deactivate_push_device(text) from public, anon;
grant execute on function public.deactivate_push_device(text) to authenticated;

-- --------------------------------------------------------------------------
-- The push integration slot was seeded as provider 'sandbox'
-- (20260707121000_integration_settings.sql), but the shipped sender supports
-- Expo — align the seed so enabling the card is sufficient (review P2). The
-- master flag (enabled) is intentionally NOT touched here.
-- Normalize + self-assert in ONE atomic block (scoped, row-count-based —
-- never judges unrelated rows by their values, so pre-existing data can't
-- fail it):
--   * only the (push, sandbox) row is updated (WHERE clause + row count ≤ 1);
--   * enabled is untouched (asserted before/after);
--   * if the row WAS sandbox it must now be expo;
--   * a push row an admin already pointed elsewhere is left alone;
--   * unrelated rows are untouched by construction (scoped UPDATE) and
--     asserted via the total-row fingerprint.
do $$
declare
  v_before record;
  v_after record;
  v_updated integer;
  v_rows_before integer;
  v_rows_after integer;
begin
  select count(*) into v_rows_before from public.integration_settings;
  select provider_name, enabled into v_before
    from public.integration_settings where provider_type = 'push';

  if v_before is null then
    raise notice 'no push integration row seeded — nothing to normalize';
    return;
  end if;

  update public.integration_settings
     set provider_name = 'expo'
   where provider_type = 'push'
     and provider_name = 'sandbox';
  get diagnostics v_updated = row_count;

  if v_updated > 1 then
    raise exception 'expected at most one (push, sandbox) row, updated %', v_updated;
  end if;

  select provider_name, enabled into v_after
    from public.integration_settings where provider_type = 'push';
  select count(*) into v_rows_after from public.integration_settings;

  if v_rows_after is distinct from v_rows_before then
    raise exception 'integration_settings row count changed (% -> %)', v_rows_before, v_rows_after;
  end if;
  if v_after.enabled is distinct from v_before.enabled then
    raise exception 'push integration enabled flag must be unchanged';
  end if;
  if v_before.provider_name = 'sandbox' and v_after.provider_name is distinct from 'expo' then
    raise exception 'sandbox push row was not normalized to expo (got %)', v_after.provider_name;
  end if;
  if v_before.provider_name <> 'sandbox' and v_after.provider_name is distinct from v_before.provider_name then
    raise exception 'non-sandbox push row must not be modified (was %, now %)', v_before.provider_name, v_after.provider_name;
  end if;
end $$;
