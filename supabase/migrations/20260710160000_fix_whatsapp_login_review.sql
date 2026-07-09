-- ============================================================================
-- Follow-up fixes for the WhatsApp-login review (PR #19). All ADDITIVE +
-- behavior-preserving except where noted; no feature flags change, nothing is
-- enabled, no secret is ever returned to a client.
--
-- P1 upsert_integration_settings: MERGE secret_config instead of replacing it,
--    so typing one secret (e.g. the Send SMS hook secret) can't wipe the other
--    Meta secrets already stored.
-- P2 whatsapp_login_enabled(): also require the Send SMS hook secret.
-- P3 whatsapp_login_enabled(): require the template for the CONFIGURED default
--    language, not "any template".
-- ============================================================================

-- ---- P1: merge (not replace) secret_config ---------------------------------
-- Only the DO UPDATE `secret_config` line changes vs 20260710140000; the rest
-- of the body is identical. The admin UI already omits empty secret fields, so
-- merging never erases a stored secret and an explicitly re-typed key still
-- overwrites just that key. Clearing a secret is intentionally not supported
-- here (there is no "delete secret" UI and none is added).
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
    -- MERGE: keep existing keys, overlay the ones the admin just typed.
    secret_config = case
                      when p_secret_config is not null
                        then coalesce(s.secret_config, '{}'::jsonb) || p_secret_config
                      else s.secret_config
                    end,
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

-- ---- P2 + P3: tighten the pre-login readiness flag -------------------------
-- Returns true ONLY when login can actually succeed on the dashboard-managed
-- secret path: provider enabled + admin login flag + Meta phone id + access
-- token + **Send SMS hook secret** (P2) + the template for the configured
-- default language (P3). Still returns a boolean only — no secret is exposed.
--
-- CAVEAT (documented in docs/WHATSAPP_LOGIN.md): if the hook secret is provided
-- via the `SEND_SMS_HOOK_SECRET` Edge Function env var instead of secret_config,
-- SQL cannot see it, so this flag stays false and the app shows the email
-- fallback even though the hook would work. To surface WhatsApp login in that
-- setup, also store the hook secret in secret_config (the app never reads it).
create or replace function public.whatsapp_login_enabled()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select s.enabled
       and coalesce((s.public_config ->> 'whatsapp_login_enabled')::boolean, false)
       and nullif(s.public_config ->> 'phone_number_id', '') is not null
       and nullif(s.secret_config ->> 'access_token', '') is not null
       and nullif(s.secret_config ->> 'send_sms_hook_secret', '') is not null   -- P2
       and case                                                                  -- P3
             when lower(coalesce(nullif(s.public_config ->> 'otp_default_language', ''), 'en')) = 'ar'
               then nullif(s.public_config ->> 'otp_template_name_ar', '') is not null
             else nullif(s.public_config ->> 'otp_template_name_en', '') is not null
           end
    from public.integration_settings s
    where s.provider_type = 'whatsapp'
  ), false);
$$;
revoke all on function public.whatsapp_login_enabled() from public;
grant execute on function public.whatsapp_login_enabled() to anon, authenticated;
