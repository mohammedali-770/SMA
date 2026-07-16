-- ==========================================================================
-- Account deletion processor scheduler
--
-- Runs the service-role processor once per minute through pg_cron + pg_net.
-- The endpoint URL and dedicated scheduler credential are read from Supabase
-- Vault at execution time; no decrypted value is stored in cron.job.
-- ==========================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.invoke_account_deletion_processor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, net, pg_catalog
as $$
declare
  v_project_url text;
  v_process_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
    into strict v_project_url
    from vault.decrypted_secrets
   where name = 'account_deletion_project_url';

  select decrypted_secret
    into strict v_process_secret
    from vault.decrypted_secrets
   where name = 'account_deletion_process_secret';

  if nullif(btrim(v_project_url), '') is null
     or nullif(v_process_secret, '') is null then
    raise exception using
      errcode = '22023',
      message = 'account deletion scheduler configuration missing';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/account-delete-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-process-secret', v_process_secret
    ),
    body := jsonb_build_object(
      'source', 'pg_cron',
      'scheduled_at', clock_timestamp()
    ),
    timeout_milliseconds := 10000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_account_deletion_processor()
  from public, anon, authenticated;

grant execute on function public.invoke_account_deletion_processor()
  to service_role;

comment on function public.invoke_account_deletion_processor() is
  'Invokes the account deletion scheduler wrapper using Vault-backed configuration; intended for pg_cron and trusted service-role diagnostics only.';

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
      from cron.job
     where jobname = 'account-deletion-processor'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'account-deletion-processor',
    '* * * * *',
    'select public.invoke_account_deletion_processor();'
  );
end;
$$;
