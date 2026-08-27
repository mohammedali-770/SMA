-- ===========================================================================
-- Comp a PHONE NUMBER, not only an existing account
-- ===========================================================================
--
-- The owner's requirement, 2026-08-27: "when the number of someone in comped
-- customers enters the app, they should see the prices as 0."
--
-- 20260826090000 keyed membership on `profile_id`, so a person had to already
-- have an account before they could be comped. That is backwards for how the
-- decision is actually made: the owner knows the NUMBER of the person they want
-- to host, usually before that person has ever opened the app. The panel proved
-- it on the day it went live — a search for +966555820667 returned "No matching
-- customers", correctly, because nobody with that number had signed up yet, and
-- there was no way to say "comp them anyway, from the moment they do".
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH: the money path.
--
-- `place_order` and `compute_order_snapshot` still resolve the comp exactly as
-- 20260826100000 left them —
--
--     select cm.is_active into v_is_comp
--       from public.comp_members cm where cm.profile_id = v_customer;
--
-- — and that is the point of this design rather than an omission. Those two
-- functions were applied to Production on 2026-08-26 and verified against two
-- live orders on 2026-08-27 (SM-2026-000055, SM-2026-000056: subtotal kept,
-- total 0.00, VAT 0.00, payment_status paid, POS synced). Re-deriving the comp
-- from a phone number inside the pricing functions would put that verified path
-- back under review to buy nothing: an UNCLAIMED number has no account, so it
-- cannot place an order, so there is nothing for pricing to resolve.
--
-- Instead the number is linked to the account at the one moment it becomes
-- trustworthy — when Auth confirms the OTP. From then on `profile_id` is set and
-- the pricing functions match it exactly as before.
--
-- WHY THE OTP MOMENT, AND NOT `profiles.phone_number` GENERALLY
--
-- Comping by phone is only safe if the phone cannot be self-asserted. Verified
-- on live Production before writing this: `authenticated` holds column UPDATE on
-- `profiles` for `email` and `full_name` ONLY — `phone_number` is not
-- customer-writable, and is written solely by handle_new_user() and
-- handle_auth_user_phone_confirmed(), both SECURITY DEFINER and both fed from
-- `auth.users.phone`. The claim below hangs off those same two functions, so a
-- membership can only ever attach to a number Auth has confirmed. A customer
-- cannot type a comped number into their profile and eat free.
--
-- SHAPE DRIFT, AGAIN
--
-- `profiles.phone_number` is stored raw from `auth.users.phone`, which is why
-- live data holds four `9665…` and one `+9665…`. `phone_e164` here is canonical
-- by constraint, and every comparison goes through normalize_ksa_e164, so the
-- drift cannot reach this feature.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Membership: a row is now identified by a phone, an account, or both
-- ---------------------------------------------------------------------------
alter table public.comp_members
  add column if not exists phone_e164 text;

-- A surrogate key, because neither natural key is present on every row: a
-- phone-only row has no profile yet, and a comp added for an email-only account
-- (there are such accounts — 5 of 10 live profiles carry no phone at all) has no
-- phone ever.
alter table public.comp_members
  add column if not exists id bigint generated always as identity;

-- Backfill before re-keying, so an existing membership keeps working by phone
-- too — including after the account it points at is deleted and recreated.
update public.comp_members cm
   set phone_e164 = public.normalize_ksa_e164(p.phone_number)
  from public.profiles p
 where p.id = cm.profile_id
   and cm.phone_e164 is null
   and public.normalize_ksa_e164(p.phone_number) is not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.comp_members'::regclass and conname = 'comp_members_pkey'
  ) then
    alter table public.comp_members drop constraint comp_members_pkey;
  end if;
end $$;

alter table public.comp_members alter column profile_id drop not null;
alter table public.comp_members add primary key (id);

-- One membership per account, and one per number. Partial, because NULL is the
-- normal state of whichever key this row is not using.
create unique index if not exists comp_members_profile_uidx
  on public.comp_members(profile_id) where profile_id is not null;
create unique index if not exists comp_members_phone_uidx
  on public.comp_members(phone_e164) where phone_e164 is not null;

-- Unclaimed rows are looked up by phone on every OTP confirmation.
create index if not exists comp_members_unclaimed_idx
  on public.comp_members(phone_e164) where profile_id is null and is_active;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.comp_members'::regclass and conname = 'comp_members_identity_ck'
  ) then
    alter table public.comp_members
      add constraint comp_members_identity_ck
      check (phone_e164 is not null or profile_id is not null);
  end if;

  -- Canonical by constraint. normalize_ksa_e164 emits exactly this shape or
  -- null, so anything reaching the column has already been through it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.comp_members'::regclass and conname = 'comp_members_phone_shape_ck'
  ) then
    alter table public.comp_members
      add constraint comp_members_phone_shape_ck
      check (phone_e164 is null or phone_e164 ~ '^\+9665[0-9]{8}$');
  end if;
end $$;

-- The customer-facing grant is unchanged and still column-scoped: (profile_id,
-- is_active). `phone_e164` is deliberately NOT added to it — it is somebody
-- else's number on every row but one, and the own-row RLS policy filters rows,
-- not columns. An unclaimed row has profile_id NULL, which the policy's
-- `profile_id = auth.uid()` never matches, so pending comps are invisible to
-- every customer.

-- ---------------------------------------------------------------------------
-- Audit: record the number when there is no account to record
-- ---------------------------------------------------------------------------
alter table public.comp_member_audit
  add column if not exists target_phone text;

create index if not exists comp_member_audit_phone_idx
  on public.comp_member_audit(target_phone, changed_at desc)
  where target_phone is not null;

-- ---------------------------------------------------------------------------
-- The claim: link a pending number to the account that just proved it owns it
-- ---------------------------------------------------------------------------
-- Called ONLY from the two Auth-fed trigger functions below, both of which fire
-- on a number Auth has confirmed. Not callable by any client role: a customer
-- who could call this could hand themselves somebody else's comp.
create or replace function public.claim_comp_membership(p_user_id uuid, p_phone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone   text := public.normalize_ksa_e164(p_phone);
  v_claimed integer := 0;
begin
  if p_user_id is null or v_phone is null then
    return false;
  end if;

  -- Never move a membership onto an account that already has one: the partial
  -- unique index on profile_id would reject it, and the account's own row is
  -- the more specific record anyway.
  if exists (select 1 from public.comp_members where profile_id = p_user_id) then
    return false;
  end if;

  -- `is_active` is deliberately NOT filtered. A number that was comped and then
  -- switched off must still bind to its account when that account appears,
  -- otherwise the same number could be added again as a fresh pending row and
  -- the deactivation would be quietly undone.
  update public.comp_members
     set profile_id = p_user_id
   where phone_e164 = v_phone
     and profile_id is null;
  get diagnostics v_claimed = row_count;

  return v_claimed > 0;
end $$;

revoke all on function public.claim_comp_membership(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Auth hooks — unchanged behaviour, plus the claim
-- ---------------------------------------------------------------------------
-- Both bodies are carried over verbatim from their current live definitions;
-- the only addition is the claim call. Neither trigger is re-created, so the
-- wiring (on_auth_user_created, on_auth_user_phone_confirmed) is untouched.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone_number, email, phone_verified, phone_verified_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.phone,
    new.email,
    (new.phone_confirmed_at is not null),
    new.phone_confirmed_at
  )
  on conflict (id) do nothing;

  -- Only a number Auth has already confirmed at insert time. An unconfirmed
  -- signup claims nothing here; it claims below, when the OTP lands.
  if new.phone_confirmed_at is not null then
    perform public.claim_comp_membership(new.id, new.phone);
  end if;

  return new;
end $$;

create or replace function public.handle_auth_user_phone_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set phone_verified = true,
        phone_verified_at = coalesce(phone_verified_at, new.phone_confirmed_at, now()),
        phone_number = coalesce(nullif(btrim(new.phone), ''), phone_number),
        updated_at = now()
    where id = new.id;

  -- The moment the number becomes trustworthy. This is what makes "add the
  -- number now, they are comped when they join" work.
  perform public.claim_comp_membership(new.id, new.phone);

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- admin_set_comp_member — now takes a phone, an account, or both
-- ---------------------------------------------------------------------------
-- Signature change, so the old one is dropped rather than replaced. Every caller
-- reaches it through PostgREST by NAMED arguments, so the existing admin panel
-- call (p_user_id / p_active / p_reason) keeps resolving unchanged.
drop function if exists public.admin_set_comp_member(uuid, boolean, text);

create or replace function public.admin_set_comp_member(
  p_user_id uuid     default null,
  p_active  boolean  default null,
  p_reason  text     default null,
  p_phone   text     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_phone   text;
  v_profile uuid := p_user_id;
  v_row     public.comp_members;
  v_hits    integer;
  v_was     boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins may change comped membership' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'An active flag is required' using errcode = '22023';
  end if;
  -- The reason is not decoration. This is the record of why someone eats free.
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'A reason of 3 to 500 characters is required' using errcode = '22023';
  end if;

  -- Accept a number in any shape a human types; refuse anything that is not a
  -- Saudi mobile rather than storing a value that can never match an account.
  if p_phone is not null and btrim(p_phone) <> '' then
    v_phone := public.normalize_ksa_e164(p_phone);
    if v_phone is null then
      raise exception 'Enter a Saudi mobile number, for example 0555123456 or +966555123456'
        using errcode = '22023';
    end if;
  end if;

  if v_profile is null and v_phone is null then
    raise exception 'A customer or a phone number is required' using errcode = '22023';
  end if;

  if v_profile is not null then
    if not exists (select 1 from public.profiles where id = v_profile) then
      raise exception 'No such customer' using errcode = 'P0002';
    end if;
  else
    -- Does this number already belong to somebody? auth.users.phone first: it is
    -- OTP-verified and not customer-writable. profiles.phone_number is the
    -- fallback for accounts that predate phone sign-in (there are such rows) and
    -- is likewise not customer-writable. Same precedence anonymize_account_data
    -- uses, for the same reason.
    select u.id into v_profile from auth.users u
     where public.normalize_ksa_e164(u.phone) = v_phone limit 1;
    if v_profile is null then
      select p.id into v_profile from public.profiles p
       where public.normalize_ksa_e164(p.phone_number) = v_phone limit 1;
    end if;
  end if;

  -- A membership may be found by either key. Two DIFFERENT rows matching is a
  -- data question only an admin can answer, so it is refused loudly rather than
  -- merged by guess.
  select count(*) into v_hits from public.comp_members cm
   where (v_profile is not null and cm.profile_id = v_profile)
      or (v_phone   is not null and cm.phone_e164 = v_phone);
  if v_hits > 1 then
    raise exception 'That number and that customer are already two separate comped entries. Remove one first.'
      using errcode = 'P0001';
  end if;

  select * into v_row from public.comp_members cm
   where (v_profile is not null and cm.profile_id = v_profile)
      or (v_phone   is not null and cm.phone_e164 = v_phone);

  v_was := coalesce(v_row.is_active, false);
  if v_was = p_active then
    -- Refused rather than silently accepted: the audit's was_active <> now_active
    -- check would reject the row anyway, and an admin who thinks they changed
    -- something should be told they did not.
    raise exception 'That customer is already %', case when p_active then 'comped' else 'not comped' end
      using errcode = 'P0001';
  end if;

  if v_row.id is null then
    insert into public.comp_members (profile_id, phone_e164, is_active, note, added_by)
    values (v_profile, v_phone, p_active, nullif(v_reason, ''), auth.uid())
    returning * into v_row;
  else
    -- coalesce, so re-adding by phone a member first added by account (or the
    -- reverse) enriches the row with the key it was missing instead of failing.
    update public.comp_members
       set is_active  = p_active,
           note       = nullif(v_reason, ''),
           added_by   = auth.uid(),
           profile_id = coalesce(profile_id, v_profile),
           phone_e164 = coalesce(phone_e164, v_phone)
     where id = v_row.id
    returning * into v_row;
  end if;

  insert into public.comp_member_audit
    (target_user_id, target_phone, was_active, now_active, reason, changed_by)
  values (v_row.profile_id, v_row.phone_e164, v_was, p_active, v_reason, auth.uid());

  return jsonb_build_object(
    'id',         v_row.id,
    'profile_id', v_row.profile_id,
    'phone_e164', v_row.phone_e164,
    'is_active',  v_row.is_active,
    'was_active', v_was,
    -- The UI needs to say "comped from the moment they sign up" rather than
    -- implying the discount is live for somebody who has no account yet.
    'pending',    (v_row.profile_id is null)
  );
end $$;

revoke all on function public.admin_set_comp_member(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_set_comp_member(uuid, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read helpers: surface the number and whether it has been claimed
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_comp_members();

create or replace function public.admin_list_comp_members()
returns table (
  id           bigint,
  profile_id   uuid,
  phone_e164   text,
  full_name    text,
  phone_number text,
  is_active    boolean,
  pending      boolean,
  note         text,
  added_at     timestamptz,
  updated_at   timestamptz
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
    select cm.id, cm.profile_id, cm.phone_e164, p.full_name, p.phone_number,
           cm.is_active, (cm.profile_id is null) as pending,
           cm.note, cm.added_at, cm.updated_at
      from public.comp_members cm
      left join public.profiles p on p.id = cm.profile_id
     order by cm.is_active desc, p.full_name nulls last, cm.phone_e164;
end $$;

revoke all on function public.admin_list_comp_members() from public, anon;
grant execute on function public.admin_list_comp_members() to authenticated;

drop function if exists public.admin_list_comp_member_audit(integer);

create or replace function public.admin_list_comp_member_audit(p_limit integer default 100)
returns table (
  id             bigint,
  target_user_id uuid,
  target_phone   text,
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
    select a.id, a.target_user_id, a.target_phone, p.full_name,
           a.was_active, a.now_active, a.reason, a.changed_by, a.changed_at
      from public.comp_member_audit a
      left join public.profiles p on p.id = a.target_user_id
     order by a.changed_at desc, a.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

revoke all on function public.admin_list_comp_member_audit(integer) from public, anon;
grant execute on function public.admin_list_comp_member_audit(integer) to authenticated;
