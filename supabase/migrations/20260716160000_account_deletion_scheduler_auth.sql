-- ==========================================================================
-- Account deletion scheduler authentication
--
-- Verifies the dedicated scheduler secret against Supabase Vault without
-- exposing the decrypted value to Edge Functions, clients, cron.job, or logs.
-- Only service_role may invoke this RPC.
-- ==========================================================================

create or replace function public.verify_account_deletion_process_secret(
  p_secret text
)
returns boolean
language sql
stable
security definer
set search_path = public, vault, extensions
as $$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'account_deletion_process_secret'
      and extensions.digest(
            convert_to(coalesce(decrypted_secret, ''), 'UTF8'),
            'sha256'
          ) = extensions.digest(
            convert_to(coalesce(p_secret, ''), 'UTF8'),
            'sha256'
          )
  );
$$;

revoke all on function public.verify_account_deletion_process_secret(text)
  from public, anon, authenticated;

grant execute on function public.verify_account_deletion_process_secret(text)
  to service_role;

comment on function public.verify_account_deletion_process_secret(text) is
  'Service-role-only constant-time-style digest comparison for the account deletion scheduler secret stored in Supabase Vault.';
