-- ============================================================================
-- Spicy Meal — Foundation: extensions, enum types, shared trigger helper.
-- Idempotent: every statement is guarded so the file can be re-applied safely.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Enum types (guarded — CREATE TYPE has no IF NOT EXISTS).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('customer', 'admin', 'accountant');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum
      ('received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_type') then
    create type public.order_type as enum ('delivery', 'pickup');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    -- Payment integration is deferred; kept minimal on purpose.
    create type public.payment_status as enum ('pending', 'paid');
  end if;
  if not exists (select 1 from pg_type where typname = 'sync_status') then
    -- Reserved for a future Lazywait sync worker (not implemented here).
    create type public.sync_status as enum ('not_synced', 'syncing', 'synced', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'coupon_type') then
    create type public.coupon_type as enum ('percentage', 'fixed');
  end if;
end $$;

-- Shared BEFORE UPDATE trigger to maintain updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;
