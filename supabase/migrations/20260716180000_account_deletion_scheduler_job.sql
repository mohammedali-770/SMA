-- ============================================================================
-- Account deletion scheduler job
--
-- Invokes the account-delete-scheduler GATEWAY Edge Function every minute using
-- the dedicated Vault-backed processor secret. The gateway re-verifies that
-- secret inside Postgres (verify_account_deletion_process_secret) and then calls
-- account-delete-process with its own built-in service-role bearer — so the
-- service-role key never appears in cron.job or Vault, and the scheduler secret
-- is never stored in Edge Function environment variables. The secret value is
-- never stored in cron.job and is read only at execution time inside this
-- restricted function.
-- ============================================================================

create or replace function public.invoke_account_deletion_processor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $$
declare
  v_project_url text;
  v_process_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'account_deletion_project_url';

  select decrypted_secret
    into v_process_secret
    from vault.decrypted_secrets
   where name = 'account_deletion_process_secret';

  if v_project_url is null or v_process_secret is null then
    raise exception 'account deletion scheduler Vault configuration is incomplete';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/account-delete-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-process-secret', v_process_secret
    ),
    body := jsonb_build_object(
      'source', 'pg_cron',
      'scheduled_at', now()
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_account_deletion_processor()
  from public, anon, authenticated;

grant execute on function public.invoke_account_deletion_processor()
  to service_role;

select cron.schedule(
  'account-deletion-processor',
  '* * * * *',
  'select public.invoke_account_deletion_processor();'
);
