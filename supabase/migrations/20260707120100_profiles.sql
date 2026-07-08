-- ============================================================================
-- Spicy Meal — profiles (1:1 with auth.users) + role helpers + RLS.
-- ============================================================================

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  phone_number  text,
  email         text,
  role          public.user_role not null default 'customer',
  loyalty_points integer not null default 0 check (loyalty_points >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is
  'Application user profile, 1:1 with auth.users. `role` drives all access control.';

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so they read profiles as the table owner,
-- bypassing RLS — this prevents infinite recursion when RLS policies call them.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

-- Admin OR accountant (accountant = read/reporting staff).
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'accountant'), false);
$$;

-- ---------------------------------------------------------------------------
-- Provision a profile row automatically whenever a new auth user is created.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone_number, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.phone,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS. Row visibility via policies; column-level GRANTs stop customers from
-- editing their own role or loyalty_points (those change only through
-- SECURITY DEFINER routines / admin tooling).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone_number, email) on public.profiles to authenticated;

drop policy if exists profiles_select_own_or_staff on public.profiles;
create policy profiles_select_own_or_staff on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Note: no INSERT/DELETE grant to clients. Profiles are created by the
-- on_auth_user_created trigger; staff management (role changes, deletes) is
-- done via service-role/admin tooling, which is added in a later migration.
