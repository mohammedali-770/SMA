-- ============================================================================
-- whatsapp_login_enabled() — an anon-safe feature flag for the mobile login UI.
--
-- The pre-login app must decide whether to offer WhatsApp login, but
-- integration_settings is RLS-revoked (customers can't read it). This
-- SECURITY DEFINER function returns ONLY a computed boolean — never any secret
-- value. It is true only when login is fully wired: provider enabled + admin
-- login flag on + Meta phone id + access token + at least one template name.
-- ============================================================================
create or replace function public.whatsapp_login_enabled()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select s.enabled
       and coalesce((s.public_config ->> 'whatsapp_login_enabled')::boolean, false)
       and nullif(s.public_config ->> 'phone_number_id', '') is not null
       and nullif(s.secret_config ->> 'access_token', '') is not null
       and (
            nullif(s.public_config ->> 'otp_template_name_en', '') is not null
         or nullif(s.public_config ->> 'otp_template_name_ar', '') is not null
       )
    from public.integration_settings s
    where s.provider_type = 'whatsapp'
  ), false);
$$;

-- Callable by the pre-login app (anon) and signed-in users. Exposes a boolean
-- only; no secret ever leaves the function.
revoke all on function public.whatsapp_login_enabled() from public;
grant execute on function public.whatsapp_login_enabled() to anon, authenticated;
