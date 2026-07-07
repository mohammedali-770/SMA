-- ============================================================================
-- Spicy Meal — secure integration settings (payment / SMS / push / Lazywait).
--
-- This ONLY provides secure storage + admin management. No third-party API is
-- implemented here. The table holds a non-secret `public_config` (safe to show)
-- and a `secret_config` (API keys/tokens) that MUST NEVER reach the browser.
--
-- Security model:
--   * The base table has NO direct client access (grants revoked). PostgREST
--     therefore can neither read nor write it — secrets cannot leak via the API.
--   * Admins manage it only through two SECURITY DEFINER RPCs that project away
--     secret_config and return `has_secret` (a boolean) instead.
--   * Server-side code (Edge Functions / service role) reads secret_config
--     directly when a real integration is later implemented.
-- ============================================================================

create table if not exists public.integration_settings (
  id            uuid primary key default gen_random_uuid(),
  provider_type text not null unique
                  check (provider_type in ('payment', 'sms', 'push', 'lazywait')),
  provider_name text,
  enabled       boolean not null default false,
  public_config jsonb   not null default '{}'::jsonb,   -- safe to expose
  secret_config jsonb   not null default '{}'::jsonb,   -- NEVER exposed to clients
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);

drop trigger if exists set_integration_settings_updated_at on public.integration_settings;
create trigger set_integration_settings_updated_at
  before update on public.integration_settings
  for each row execute function public.set_updated_at();

-- No client access at all. Only the SECURITY DEFINER RPCs (owned by postgres)
-- and the service role can touch this table. RLS is enabled as defense in depth.
alter table public.integration_settings enable row level security;
revoke all on public.integration_settings from anon, authenticated;

-- Placeholder rows so the admin UI always has the four slots to configure.
insert into public.integration_settings (provider_type, provider_name, enabled) values
  ('payment',  'sandbox', false),
  ('sms',      'sandbox', false),
  ('push',     'sandbox', false),
  ('lazywait', 'lazywait', false)
on conflict (provider_type) do nothing;

-- ---------------------------------------------------------------------------
-- list_integration_settings(): admin-only read of the NON-secret projection.
-- Returns `has_secret` instead of the secret itself, so secrets never transit.
-- ---------------------------------------------------------------------------
-- Drop first so the RETURNS TABLE shape can evolve on a re-run without the
-- "cannot change return type of existing function" error.
drop function if exists public.list_integration_settings();
create or replace function public.list_integration_settings()
returns table (
  provider_type text,
  provider_name text,
  enabled       boolean,
  public_config jsonb,
  has_secret    boolean,
  updated_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may view integration settings' using errcode = '42501';
  end if;
  return query
    select s.provider_type, s.provider_name, s.enabled, s.public_config,
           (s.secret_config is not null and s.secret_config <> '{}'::jsonb) as has_secret,
           s.updated_at
    from public.integration_settings s
    order by s.provider_type;
end $$;

-- ---------------------------------------------------------------------------
-- upsert_integration_settings(): admin-only write. A null p_secret_config keeps
-- the stored secret unchanged (so the UI never has to resend it); a non-null
-- value replaces it. Returns the same NON-secret projection as the list RPC.
-- ---------------------------------------------------------------------------
drop function if exists public.upsert_integration_settings(text, text, boolean, jsonb, jsonb);
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
-- The RETURNS TABLE out-params share names with integration_settings columns;
-- resolve bare names in the INSERT/ON CONFLICT to the table columns.
#variable_conflict use_column
declare
  v_row public.integration_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit integration settings' using errcode = '42501';
  end if;
  if p_provider_type not in ('payment', 'sms', 'push', 'lazywait') then
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
    -- keep the existing secret when the caller doesn't send a new one
    secret_config = case when p_secret_config is not null then p_secret_config else s.secret_config end,
    updated_by    = auth.uid(),
    updated_at    = now()
  returning * into v_row;

  return query
    select v_row.provider_type, v_row.provider_name, v_row.enabled, v_row.public_config,
           (v_row.secret_config is not null and v_row.secret_config <> '{}'::jsonb) as has_secret,
           v_row.updated_at;
end $$;

revoke all on function public.list_integration_settings() from public, anon;
grant execute on function public.list_integration_settings() to authenticated;
revoke all on function public.upsert_integration_settings(text, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.upsert_integration_settings(text, text, boolean, jsonb, jsonb) to authenticated;
