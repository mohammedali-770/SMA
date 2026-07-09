-- ============================================================================
-- WhatsApp customer LOGIN (Supabase Phone Auth + Send SMS Hook) — DB support.
--
-- The actual login is issued by Supabase Auth (GoTrue) via signInWithOtp /
-- verifyOtp; the OTP is DELIVERED over WhatsApp by the `auth-send-sms-whatsapp`
-- Send SMS Hook. This migration only makes the PROFILE side safe + correct for
-- phone-auth users. It is ADDITIVE and reversible and changes NO existing auth.
--
-- Guarantees preserved here:
--   * Phone-auth signups get role 'customer' (the profiles.role default) — this
--     path never sets role, and customers cannot update role (column grants).
--   * Existing profiles are never overwritten (`on conflict do nothing`); an
--     admin/accountant who happens to confirm a phone keeps their role.
--   * `phone_verified` still moves ONLY through SECURITY DEFINER code, never a
--     client write.
-- ============================================================================

-- ---- handle_new_user: also seed phone_verified for phone-first signups -------
-- Supabase phone signups arrive with `new.phone` set; `phone_confirmed_at` is
-- set once verifyOtp succeeds. Reflect it on the freshly-created profile. Role
-- is intentionally NOT set here → stays 'customer' by column default.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
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
  return new;
end $$;

-- ---- Sync phone_verified when a phone gets confirmed on an EXISTING user -----
-- verifyOtp confirms the phone by UPDATING auth.users.phone_confirmed_at (the
-- INSERT trigger already ran with it null). This propagates that one transition
-- to the profile. It only ever sets phone-verification fields — never role — so
-- it can't escalate anyone. The WHEN clause keeps it off the hot path (it fires
-- only on the null → not-null transition, not on every auth.users update).
create or replace function public.handle_auth_user_phone_confirmed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
    set phone_verified = true,
        phone_verified_at = coalesce(phone_verified_at, new.phone_confirmed_at, now()),
        phone_number = coalesce(nullif(btrim(new.phone), ''), phone_number),
        updated_at = now()
    where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_phone_confirmed on auth.users;
create trigger on_auth_user_phone_confirmed
  after update of phone_confirmed_at on auth.users
  for each row
  when (old.phone_confirmed_at is null and new.phone_confirmed_at is not null)
  execute function public.handle_auth_user_phone_confirmed();

-- ---- integration_settings: login config keys (non-secret, admin-editable) ----
-- Add the login master flag + default OTP language to the existing 'whatsapp'
-- row WITHOUT clobbering any admin-set values (`defaults || existing` keeps the
-- existing key when present). The Send SMS Hook SECRET is write-only via the
-- admin UI (secret_config.send_sms_hook_secret) — never seeded here.
update public.integration_settings
  set public_config =
        jsonb_build_object(
          'whatsapp_login_enabled', false,   -- master switch for phone-OTP LOGIN
          'otp_default_language', 'en'       -- hook has no locale; default template lang
        ) || coalesce(public_config, '{}'::jsonb)
  where provider_type = 'whatsapp';

-- Keep fresh environments consistent: seed the row (if the earlier migration
-- hasn't) already includes the base defaults; ensure the login keys exist there
-- too via the same merge, which is a no-op when the row is absent.
