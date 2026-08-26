-- ===========================================================================
-- Comped customers — a named group who order without paying
-- ===========================================================================
--
-- The owner needs a named group (staff, family, investors) to order at no
-- charge. Nothing in this project could express that: `coupons` has no
-- per-customer targeting at all, `campaigns` is applied but fully dormant AND
-- has no eligibility column either, and `profiles` carries no group, segment or
-- tier — `profiles.role` is staff-console routing and is read by zero pricing
-- code.
--
-- This migration adds the membership, its audit trail and the admin RPCs. The
-- money path itself is changed in the migration that follows, so that a review
-- of "who is comped" and a review of "what a comp does to a total" are separate
-- diffs.
--
-- SCOPE, as decided by the owner on 2026-08-26: the discount is AUTOMATIC (no
-- code to type and none to leak), it zeroes EVERYTHING including the delivery
-- fee, and there is NO CAP.
--
-- The absence of a cap is the risk in this feature, and it is deliberate rather
-- than overlooked. Everything below makes a comp TRACEABLE — a mandatory
-- reason, a permanent audit row, an AAL2-gated writer, and `is_comped` stamped
-- on every order — but nothing makes it BOUNDED. One wrongly-added member is
-- unlimited free food. A per-period cap belongs on `comp_members` and can be
-- added later without reshaping any of this.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
-- Deactivated, never deleted: an order stamped `is_comped` months ago must stay
-- explicable, and `added_by`/`note` are the explanation.
create table if not exists public.comp_members (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  is_active  boolean not null default true,
  note       text,
  added_by   uuid references auth.users(id) on delete set null,
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (note is null or length(btrim(note)) <= 500)
);

create index if not exists comp_members_active_idx
  on public.comp_members(profile_id) where is_active;

drop trigger if exists set_comp_members_updated_at on public.comp_members;
create trigger set_comp_members_updated_at
  before update on public.comp_members
  for each row execute function public.set_updated_at();

alter table public.comp_members enable row level security;
revoke all on public.comp_members from public, anon, authenticated;
grant select on public.comp_members to authenticated;

-- A customer may read THEIR OWN row and nothing else. The checkout screen needs
-- it to show the discount before the order is placed; without that the customer
-- sees full price and is then charged nothing, which is a confusing way to give
-- someone a gift. It is a read of a boolean about themselves — it reveals
-- nothing about anyone else, and the money is still decided server-side.
drop policy if exists comp_members_read_own on public.comp_members;
create policy comp_members_read_own
  on public.comp_members
  for select to authenticated
  using ((profile_id = (select auth.uid())) or public.is_admin());

-- No client write policy of any kind. Membership is changed ONLY through
-- admin_set_comp_member below, which is SECURITY DEFINER and gated on
-- is_admin() — role AND AAL2.

-- ---------------------------------------------------------------------------
-- Audit — permanent, and deliberately not ops_change_events
-- ---------------------------------------------------------------------------
-- `ops_change_events` self-prunes after one day (20260820130000:63). That is
-- fine for operational noise and useless for a money trail: the question "who
-- made this person free, and why" has to be answerable a year later.
--
-- Mirrors public.role_change_audit (20260810140000:10) down to the SET NULL
-- FKs, which keep account deletion working without erasing the audit.
create table if not exists public.comp_member_audit (
  id             bigint generated always as identity primary key,
  target_user_id uuid references auth.users(id) on delete set null,
  was_active     boolean not null,
  now_active     boolean not null,
  reason         text not null,
  changed_by     uuid references auth.users(id) on delete set null,
  changed_at     timestamptz not null default now(),
  check (was_active <> now_active),
  check (length(btrim(reason)) between 3 and 500)
);

create index if not exists comp_member_audit_target_idx
  on public.comp_member_audit(target_user_id, changed_at desc);
create index if not exists comp_member_audit_actor_idx
  on public.comp_member_audit(changed_by, changed_at desc);

alter table public.comp_member_audit enable row level security;
revoke all on public.comp_member_audit from public, anon, authenticated;
grant select on public.comp_member_audit to authenticated;

drop policy if exists comp_member_audit_admin_read on public.comp_member_audit;
create policy comp_member_audit_admin_read
  on public.comp_member_audit
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- orders: record that a comp happened, and how much it was worth
-- ---------------------------------------------------------------------------
-- Separate columns rather than reusing `discount_amount`, which means "coupon"
-- everywhere else (ReportsPanel's coupon-usage report groups by `coupon_code`
-- and sums `discount_amount`). Folding a comp into it would silently corrupt
-- that report. `subtotal` keeps its meaning too: the real value of the goods.
alter table public.orders
  add column if not exists is_comped boolean not null default false;
alter table public.orders
  add column if not exists comp_discount_amount numeric(10,2) not null default 0
    check (comp_discount_amount >= 0);

create index if not exists orders_comped_idx
  on public.orders(created_at desc) where is_comped;

-- ---------------------------------------------------------------------------
-- admin_set_comp_member — the ONLY way membership changes
-- ---------------------------------------------------------------------------
-- Mirrors admin_set_user_role (20260810140000:40): is_admin() is role AND AAL2,
-- the reason is mandatory, and the audit row is written in the same transaction
-- as the change so the two cannot disagree.
create or replace function public.admin_set_comp_member(
  p_user_id uuid,
  p_active  boolean,
  p_reason  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target  public.profiles;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_was     boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins may change comped membership' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'A target user is required' using errcode = '22023';
  end if;
  if p_active is null then
    raise exception 'An active flag is required' using errcode = '22023';
  end if;
  -- The reason is not decoration. This is the record of why someone eats free.
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'A reason of 3 to 500 characters is required' using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception 'No such customer' using errcode = 'P0002';
  end if;

  -- Absent membership reads as inactive, so adding someone for the first time
  -- and re-activating a lapsed member are the same operation.
  select cm.is_active into v_was from public.comp_members cm where cm.profile_id = p_user_id;
  v_was := coalesce(v_was, false);

  if v_was = p_active then
    -- No-op. Refused rather than silently accepted, because the audit's
    -- was_active <> now_active check would reject the row anyway and an admin
    -- who thinks they changed something should be told they did not.
    raise exception 'That customer is already %', case when p_active then 'comped' else 'not comped' end
      using errcode = 'P0001';
  end if;

  insert into public.comp_members (profile_id, is_active, note, added_by)
  values (p_user_id, p_active, nullif(v_reason, ''), auth.uid())
  on conflict (profile_id) do update
    set is_active = excluded.is_active,
        note      = excluded.note,
        added_by  = excluded.added_by,
        updated_at = now();

  insert into public.comp_member_audit (target_user_id, was_active, now_active, reason, changed_by)
  values (p_user_id, v_was, p_active, v_reason, auth.uid());

  return jsonb_build_object(
    'profile_id', p_user_id,
    'is_active',  p_active,
    'was_active', v_was
  );
end $$;

revoke all on function public.admin_set_comp_member(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_comp_member(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read helpers for the admin console
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_comp_members()
returns table (
  profile_id uuid,
  full_name  text,
  phone_number text,
  is_active  boolean,
  note       text,
  added_at   timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may read comped membership' using errcode = '42501';
  end if;
  return query
    select cm.profile_id, p.full_name, p.phone_number,
           cm.is_active, cm.note, cm.added_at, cm.updated_at
    from public.comp_members cm
    join public.profiles p on p.id = cm.profile_id
    order by cm.is_active desc, p.full_name nulls last;
end $$;

revoke all on function public.admin_list_comp_members() from public, anon;
grant execute on function public.admin_list_comp_members() to authenticated;

create or replace function public.admin_list_comp_member_audit(p_limit integer default 100)
returns table (
  id             bigint,
  target_user_id uuid,
  target_name    text,
  was_active     boolean,
  now_active     boolean,
  reason         text,
  changed_by     uuid,
  changed_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may read the comped-membership audit' using errcode = '42501';
  end if;
  return query
    select a.id, a.target_user_id, p.full_name,
           a.was_active, a.now_active, a.reason, a.changed_by, a.changed_at
    from public.comp_member_audit a
    left join public.profiles p on p.id = a.target_user_id
    order by a.changed_at desc, a.id desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

revoke all on function public.admin_list_comp_member_audit(integer) from public, anon;
grant execute on function public.admin_list_comp_member_audit(integer) to authenticated;
