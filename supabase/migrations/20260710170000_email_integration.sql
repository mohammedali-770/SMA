-- ============================================================================
-- Email/SMTP integration slot. ADDITIVE + reversible. Ships DISABLED — this only
-- lets an admin STORE SMTP settings (host/port/tls/user/from/reply-to + a
-- write-only password) securely under integration_settings, exactly like the
-- other providers. No email is sent by this migration; the SMTP password lives
-- only in secret_config (RLS-revoked) and never reaches the browser.
-- ============================================================================

-- Allow the 'email' provider_type.
alter table public.integration_settings drop constraint if exists integration_settings_provider_type_check;
alter table public.integration_settings add constraint integration_settings_provider_type_check
  check (provider_type in ('payment', 'sms', 'push', 'lazywait', 'whatsapp', 'email'));

-- Re-emit upsert_integration_settings with 'email' allowed. Body is identical to
-- 20260710160000 (MERGE secret_config), only the guard list changes.
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
  if p_provider_type not in ('payment', 'sms', 'push', 'lazywait', 'whatsapp', 'email') then
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

-- Seed the disabled 'email' slot with sensible non-secret defaults.
insert into public.integration_settings (provider_type, provider_name, enabled, public_config) values
  ('email', 'smtp', false, jsonb_build_object(
    'port', '587',
    'secure', true,
    'from_name', 'Spicy Meal'
  ))
on conflict (provider_type) do nothing;
