-- Fix: account erasure leaves the customer's phone-keyed records behind and
-- reports that it purged them.
--
-- THE BUG
-- `anonymize_account_data` (20260715120000:245) reads the phone it will purge by
-- from `public.profiles.phone_number`:
--
--     select phone_number into v_phone from public.profiles where id = p_user_id;
--     ...
--     delete from public.otp_challenges      where phone_e164 = v_phone;
--     delete from public.whatsapp_message_logs where phone_e164 = v_phone;
--
-- Those two columns are not in the same format.
--
--   * `profiles.phone_number` is copied verbatim from `auth.users.phone` by
--     `handle_new_user` (20260710150000:27-36) and `handle_auth_user_phone_confirmed`
--     (:54). GoTrue stores that WITHOUT a leading '+'.
--   * `otp_challenges.phone_e164` / `whatsapp_message_logs.phone_e164` are
--     written by the normalizer in `supabase/functions/_shared/whatsapp.ts`,
--     which returns '+966' || national — WITH the '+'.
--
-- Measured on production on 2026-08-06 (shape only, no phone values read):
-- 0 of 1 `auth.users.phone` values carry a '+', 3 of 3 `otp_challenges` rows do,
-- and `profiles.phone_number` held BOTH shapes across 2 rows. Of the 2 profiles
-- with a phone, 1 matched an OTP row; 2 would match after normalization. So the
-- delete silently purged nothing for half the affected profiles.
--
-- It is also worse than a formatting slip: `profiles.phone_number` is in the
-- `grant update (full_name, phone_number, email) ... to authenticated` list
-- (20260707120100:82), so the value the erasure keys on is CUSTOMER-WRITABLE.
-- A customer could set it to another customer's number, or to anything at all,
-- and the erasure would follow it.
--
-- AND IT REPORTED SUCCESS
-- `'phone_purged', (v_phone is not null and btrim(v_phone) <> '')` is true
-- whenever a phone STRING existed — not when any row was actually deleted. The
-- retention summary written into `account_deletion_requests` therefore recorded
-- a purge that had not happened. That is a falsified compliance record, which
-- matters more than the leak itself under PDPL.
--
-- WHAT THIS CHANGES
--   1. Adds `public.normalize_ksa_e164(text)`, a faithful SQL mirror of
--      `normalizeSaudiPhoneE164` in `_shared/whatsapp.ts`.
--   2. `anonymize_account_data` now takes the phone from `auth.users.phone`
--      (authoritative, not customer-writable), falls back to the profile only if
--      absent, and normalizes both sides of the comparison.
--   3. `phone_purged` is replaced by `phone_purge_attempted` plus the two row
--      counts the function already returns, so the summary can never claim a
--      purge that did not occur.
--   4. Revokes the customer's UPDATE privilege on `profiles.phone_number`. The
--      phone is established by verified OTP through the auth triggers; nothing
--      in either app writes it directly.
--
-- SAFETY
-- - Strictly additive plus one narrowing revoke. No table, column or constraint
--   is altered and no existing row is modified.
-- - `create or replace function` keeps the same name, signature, volatility and
--   search_path, so the account-deletion worker keeps calling it untouched, and
--   no historical migration is edited (CLAUDE.md §2.3).
-- - Idempotent: re-running is a no-op.
-- - MORE rows are now deleted during an erasure, never fewer. That is the point.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved apply_migration workflow (docs/MIGRATIONS.md).
-- `supabase db push` is forbidden against production (CLAUDE.md §8).

-- ---------------------------------------------------------------------------
-- 1. Saudi E.164 normalization, mirroring _shared/whatsapp.ts
-- ---------------------------------------------------------------------------
create or replace function public.normalize_ksa_e164(p_input text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Mirrors normalizeSaudiPhoneE164 in supabase/functions/_shared/whatsapp.ts:
  -- strip punctuation, drop a leading '+' or '00' IDD prefix, drop the '966'
  -- country code, drop the national trunk '0', then require exactly 5 + 8
  -- digits. Deliberately NOT narrowed to today's operator prefixes — CITC keeps
  -- allocating new 5X ranges and a stale allow-list would silently stop purging
  -- real customers' records.
  --
  -- Returns null for anything that is not a Saudi mobile, so a caller comparing
  -- on the result can never match on a partial or malformed value.
  with cleaned as (
    select regexp_replace(coalesce(p_input, ''), '[^0-9+]', '', 'g') as d
  ),
  unprefixed as (
    select case
             when d like '+%'  then substr(d, 2)
             when d like '00%' then substr(d, 3)
             else d
           end as d
      from cleaned
  ),
  national as (
    select case when d like '966%' then substr(d, 4) else d end as d from unprefixed
  ),
  trunked as (
    select case when d like '0%' then substr(d, 2) else d end as d from national
  )
  select case when d ~ '^5[0-9]{8}$' then '+966' || d else null end from trunked;
$$;

comment on function public.normalize_ksa_e164(text) is
  'Normalizes a Saudi mobile to +9665XXXXXXXX, or null if the input is not one. SQL mirror of normalizeSaudiPhoneE164 in supabase/functions/_shared/whatsapp.ts. Used by anonymize_account_data so an erasure matches phone-keyed rows regardless of the stored format.';

revoke all on function public.normalize_ksa_e164(text) from public, anon, authenticated;
grant execute on function public.normalize_ksa_e164(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Erasure keys on the authoritative phone, normalized on both sides
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_account_data(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_raw_phone        text;
  v_phone            text;
  v_orders_anon      integer := 0;
  v_addresses        integer := 0;
  v_devices          integer := 0;
  v_sessions         integer := 0;
  v_loyalty          integer := 0;
  v_otp              integer := 0;
  v_logs             integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;

  -- auth.users.phone FIRST: it is set by verified OTP and is not writable by the
  -- customer, whereas profiles.phone_number was in the `authenticated` update
  -- grant until this migration. Fall back to the profile so an account whose
  -- Auth row has already lost its phone still purges.
  select u.phone into v_raw_phone from auth.users u where u.id = p_user_id;
  if v_raw_phone is null or btrim(v_raw_phone) = '' then
    select p.phone_number into v_raw_phone from public.profiles p where p.id = p_user_id;
  end if;

  v_phone := public.normalize_ksa_e164(v_raw_phone);

  update public.orders
     set customer_name    = null,
         customer_phone   = null,
         notes            = null,
         address_snapshot = null
   where customer_id = p_user_id
     and (customer_name is not null
       or customer_phone is not null
       or notes is not null
       or address_snapshot is not null);
  get diagnostics v_orders_anon = row_count;

  delete from public.addresses where customer_id = p_user_id;
  get diagnostics v_addresses = row_count;

  delete from public.push_devices where customer_id = p_user_id;
  get diagnostics v_devices = row_count;

  delete from public.checkout_sessions where customer_id = p_user_id;
  get diagnostics v_sessions = row_count;

  delete from public.loyalty_transactions where profile_id = p_user_id;
  get diagnostics v_loyalty = row_count;

  -- Phone-keyed rows carry no FK to the user, so they are matched by value.
  -- BOTH sides are normalized: the stored column may predate the normalizer, and
  -- the source may or may not carry a '+' depending on which trigger wrote it.
  if v_phone is not null then
    delete from public.otp_challenges
     where public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_otp = row_count;

    delete from public.whatsapp_message_logs
     where public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_logs = row_count;
  end if;

  return jsonb_build_object(
    'orders_anonymized', v_orders_anon,
    'addresses_deleted', v_addresses,
    'push_devices_deleted', v_devices,
    'checkout_sessions_deleted', v_sessions,
    'loyalty_transactions_deleted', v_loyalty,
    'otp_challenges_purged', v_otp,
    'whatsapp_logs_purged', v_logs,
    -- Was `phone_purged`, which reported true whenever a phone STRING existed
    -- rather than when anything was deleted — a purge the summary claimed but
    -- had not performed. The two counts above are the honest record; this flag
    -- now says only whether a usable Saudi mobile was resolved to purge BY.
    'phone_purge_attempted', (v_phone is not null)
  );
end $$;

revoke all on function public.anonymize_account_data(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account_data(uuid) to service_role;

comment on function public.anonymize_account_data(uuid) is
  'Transactional, idempotent erasure for ONE user. Keys phone-keyed purges on auth.users.phone (falling back to the profile), normalized through normalize_ksa_e164 on both sides so a stored format difference cannot silently skip them. Returns real row counts; never claims a purge it did not perform.';

-- ---------------------------------------------------------------------------
-- 3. The phone is established by verified OTP, not by the customer
-- ---------------------------------------------------------------------------
-- 20260707120100:82 granted `update (full_name, phone_number, email)` to
-- `authenticated`. Nothing in either app writes phone_number directly — it is
-- set by handle_new_user / handle_auth_user_phone_confirmed from the verified
-- Auth record. Leaving it writable let a customer point their profile at another
-- customer's number, which the erasure then keyed on.
revoke update (phone_number) on public.profiles from authenticated;

comment on column public.profiles.phone_number is
  'Verified mobile, mirrored from auth.users.phone by the auth triggers. NOT customer-writable: the update grant was revoked on 2026-08-06 because erasure keys phone-keyed purges on this value.';

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- grant update (phone_number) on public.profiles to authenticated;
-- ...and restore the previous anonymize_account_data body from
-- 20260715120000_account_deletion.sql:228-295. Note that doing so reinstates the
-- silent skip, so prefer fixing forward.
