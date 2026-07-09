-- ============================================================================
-- WhatsApp OTP infrastructure (Meta Cloud API) — phone verification.
--
-- ADDITIVE + reversible. Ships DISABLED: the 'whatsapp' integration row is
-- seeded enabled=false, so nothing sends until an admin configures Meta creds +
-- templates and flips it on. Existing email/password auth is untouched. All OTP
-- creation/verification happens ONLY through service-role RPCs (customers can
-- neither read OTP hashes nor mark themselves verified).
-- ============================================================================

-- ---- profiles: phone-verification flags (service-role writes only) ----------
alter table public.profiles add column if not exists phone_verified    boolean not null default false;
alter table public.profiles add column if not exists phone_verified_at  timestamptz;
-- NOTE: phone_verified is intentionally NOT added to the
-- `grant update (full_name, phone_number, email)` list — only mark_phone_verified
-- (SECURITY DEFINER, service_role) may set it.

-- ---- otp_challenges: one row per OTP send (hash only, never plaintext) -------
create table if not exists public.otp_challenges (
  id                  uuid primary key default gen_random_uuid(),
  phone_e164          text not null,
  channel             text not null check (channel in ('whatsapp')),
  purpose             text not null check (purpose in ('login','signup','phone_verification','passwordless_login')),
  otp_hash            text not null,
  otp_salt            text,
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  attempt_count       integer not null default 0,
  max_attempts        integer not null default 5,
  send_count          integer not null default 1,
  status              text not null default 'pending' check (status in ('pending','verified','blocked','expired')),
  provider_message_id text,
  ip_hash             text,
  device_hash         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists otp_challenges_lookup_idx
  on public.otp_challenges (phone_e164, purpose, channel, created_at desc);
create index if not exists otp_challenges_expires_idx on public.otp_challenges (expires_at);

drop trigger if exists set_otp_challenges_updated_at on public.otp_challenges;
create trigger set_otp_challenges_updated_at
  before update on public.otp_challenges
  for each row execute function public.set_updated_at();

-- No client access at all. Only SECURITY DEFINER RPCs + the service role touch it.
alter table public.otp_challenges enable row level security;
revoke all on public.otp_challenges from anon, authenticated;

-- ---- whatsapp_message_logs: sanitized provider audit (no OTP / no token) -----
create table if not exists public.whatsapp_message_logs (
  id                   uuid primary key default gen_random_uuid(),
  phone_e164           text,
  message_type         text not null,
  template_name        text,
  provider_message_id  text,
  provider_status      text,
  error_code           text,
  error_message_safe   text,
  raw_provider_response jsonb,   -- sanitized before insert
  created_at           timestamptz not null default now()
);
create index if not exists whatsapp_message_logs_phone_idx on public.whatsapp_message_logs (phone_e164, created_at desc);
create index if not exists whatsapp_message_logs_created_idx on public.whatsapp_message_logs (created_at desc);

alter table public.whatsapp_message_logs enable row level security;
revoke all on public.whatsapp_message_logs from anon, authenticated;
grant select on public.whatsapp_message_logs to authenticated;
drop policy if exists whatsapp_message_logs_staff_read on public.whatsapp_message_logs;
create policy whatsapp_message_logs_staff_read on public.whatsapp_message_logs
  for select to authenticated using (public.is_staff());

-- ---- integration_settings: allow the 'whatsapp' provider ---------------------
alter table public.integration_settings drop constraint if exists integration_settings_provider_type_check;
alter table public.integration_settings add constraint integration_settings_provider_type_check
  check (provider_type in ('payment', 'sms', 'push', 'lazywait', 'whatsapp'));

-- Re-emit upsert_integration_settings with 'whatsapp' allowed (guard is the only
-- change; body mirrors 20260707121000_integration_settings.sql exactly).
create or replace function public.upsert_integration_settings(
  p_provider_type text,
  p_provider_name text,
  p_enabled       boolean,
  p_public_config jsonb default '{}'::jsonb,
  p_secret_config jsonb default null
)
returns table (
  provider_type text,
  provider_name text,
  enabled       boolean,
  public_config jsonb,
  has_secret    boolean,
  updated_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row public.integration_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit integration settings' using errcode = '42501';
  end if;
  if p_provider_type not in ('payment', 'sms', 'push', 'lazywait', 'whatsapp') then
    raise exception 'Unknown integration provider_type: %', p_provider_type;
  end if;

  insert into public.integration_settings as s
    (provider_type, provider_name, enabled, public_config, secret_config, updated_by, updated_at)
  values
    (p_provider_type, p_provider_name, coalesce(p_enabled, false),
     coalesce(p_public_config, '{}'::jsonb), coalesce(p_secret_config, '{}'::jsonb),
     auth.uid(), now())
  on conflict (provider_type) do update set
    provider_name = excluded.provider_name,
    enabled       = excluded.enabled,
    public_config = excluded.public_config,
    secret_config = case when p_secret_config is not null then p_secret_config else s.secret_config end,
    updated_by    = auth.uid(),
    updated_at    = now()
  returning * into v_row;

  return query
    select v_row.provider_type, v_row.provider_name, v_row.enabled, v_row.public_config,
           (v_row.secret_config is not null and v_row.secret_config <> '{}'::jsonb) as has_secret,
           v_row.updated_at;
end $$;
revoke all on function public.upsert_integration_settings(text, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.upsert_integration_settings(text, text, boolean, jsonb, jsonb) to authenticated;

-- Seed the disabled 'whatsapp' slot with sensible non-secret defaults.
insert into public.integration_settings (provider_type, provider_name, enabled, public_config) values
  ('whatsapp', 'meta_cloud', false, jsonb_build_object(
    'graph_api_version', 'v21.0',
    'otp_template_language_ar', 'ar',
    'otp_template_language_en', 'en_US',
    'otp_template_has_copy_button', true,
    'resend_cooldown_seconds', 60,
    'otp_ttl_minutes', 5,
    'max_attempts', 5,
    'sms_otp_fallback_enabled', false,
    'otp_channel_default', 'whatsapp'
  ))
on conflict (provider_type) do nothing;

-- ============================================================================
-- Service-role RPCs (edge functions call these as the service role). All:
-- security definer + pinned search_path + revoke from public/anon/authenticated
-- + grant to service_role. Customers can never call them.
-- ============================================================================

-- Atomic rate-limit check + challenge insert. Rate windows are per phone+channel.
create or replace function public.otp_begin_send(
  p_phone text, p_channel text, p_purpose text,
  p_otp_hash text, p_salt text, p_expires_at timestamptz,
  p_max_attempts int, p_cooldown_seconds int, p_max_per_hour int, p_max_per_day int,
  p_ip_hash text default null, p_device_hash text default null, p_provider_message_id text default null
)
returns table (allowed boolean, reason text, challenge_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_last timestamptz;
  v_hour int;
  v_day  int;
  v_id   uuid;
begin
  select max(created_at) into v_last from public.otp_challenges
    where phone_e164 = p_phone and channel = p_channel;
  if v_last is not null and v_last > now() - make_interval(secs => greatest(0, coalesce(p_cooldown_seconds, 60))) then
    return query select false, 'cooldown', null::uuid; return;
  end if;

  select count(*) into v_hour from public.otp_challenges
    where phone_e164 = p_phone and channel = p_channel and created_at > now() - interval '1 hour';
  if v_hour >= greatest(1, coalesce(p_max_per_hour, 5)) then
    return query select false, 'hourly_limit', null::uuid; return;
  end if;

  select count(*) into v_day from public.otp_challenges
    where phone_e164 = p_phone and channel = p_channel and created_at > now() - interval '1 day';
  if v_day >= greatest(1, coalesce(p_max_per_day, 10)) then
    return query select false, 'daily_limit', null::uuid; return;
  end if;

  insert into public.otp_challenges
    (phone_e164, channel, purpose, otp_hash, otp_salt, expires_at, max_attempts,
     status, ip_hash, device_hash, provider_message_id)
  values
    (p_phone, p_channel, p_purpose, p_otp_hash, p_salt, p_expires_at, coalesce(p_max_attempts, 5),
     'pending', p_ip_hash, p_device_hash, p_provider_message_id)
  returning id into v_id;

  return query select true, 'ok', v_id;
end $$;
revoke all on function public.otp_begin_send(text,text,text,text,text,timestamptz,int,int,int,int,text,text,text) from public, anon, authenticated;
grant execute on function public.otp_begin_send(text,text,text,text,text,timestamptz,int,int,int,int,text,text,text) to service_role;

-- Latest still-pending, unconsumed challenge for a phone/purpose/channel.
create or replace function public.otp_get_active_challenge(
  p_phone text, p_purpose text, p_channel text
)
returns table (id uuid, otp_hash text, otp_salt text, attempt_count int, max_attempts int, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.id, c.otp_hash, c.otp_salt, c.attempt_count, c.max_attempts, c.expires_at
    from public.otp_challenges c
    where c.phone_e164 = p_phone and c.purpose = p_purpose and c.channel = p_channel
      and c.consumed_at is null and c.status = 'pending'
    order by c.created_at desc
    limit 1;
end $$;
revoke all on function public.otp_get_active_challenge(text,text,text) from public, anon, authenticated;
grant execute on function public.otp_get_active_challenge(text,text,text) to service_role;

-- Mark a challenge consumed (single-use).
create or replace function public.otp_consume(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.otp_challenges
    set consumed_at = now(), status = 'verified', updated_at = now()
    where id = p_id and consumed_at is null;
end $$;
revoke all on function public.otp_consume(uuid) from public, anon, authenticated;
grant execute on function public.otp_consume(uuid) to service_role;

-- Increment a failed verify attempt; block the challenge at the cap.
create or replace function public.otp_increment_attempt(p_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update public.otp_challenges
    set attempt_count = attempt_count + 1,
        status = case when attempt_count + 1 >= max_attempts then 'blocked' else status end,
        updated_at = now()
    where id = p_id
    returning attempt_count into v_count;
  return coalesce(v_count, 0);
end $$;
revoke all on function public.otp_increment_attempt(uuid) from public, anon, authenticated;
grant execute on function public.otp_increment_attempt(uuid) to service_role;

-- Mark a signed-in user's phone verified (only that user's row).
create or replace function public.mark_phone_verified(p_user_id uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
    set phone_verified = true,
        phone_verified_at = now(),
        phone_number = coalesce(nullif(btrim(p_phone), ''), phone_number),
        updated_at = now()
    where id = p_user_id;
end $$;
revoke all on function public.mark_phone_verified(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_phone_verified(uuid, text) to service_role;

-- Sanitized provider log row (never OTP, never token).
create or replace function public.record_whatsapp_message(
  p_phone text, p_message_type text, p_template_name text,
  p_provider_message_id text, p_provider_status text,
  p_error_code text, p_error_message_safe text, p_raw jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.whatsapp_message_logs
    (phone_e164, message_type, template_name, provider_message_id, provider_status,
     error_code, error_message_safe, raw_provider_response)
  values
    (p_phone, p_message_type, p_template_name, p_provider_message_id, p_provider_status,
     p_error_code, p_error_message_safe, p_raw);
end $$;
revoke all on function public.record_whatsapp_message(text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_whatsapp_message(text,text,text,text,text,text,text,jsonb) to service_role;
