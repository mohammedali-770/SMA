-- ============================================================================
-- Operations alerts v2 — THE INVOCATION PATH.
--
-- WHY THIS EXISTS, AND WHY IT IS A SEPARATE FILE
-- 20260903120000 built the dispatcher and NOTHING CALLED IT. That was caught by
-- review on #328: a repo-wide search for `operations-alert-dispatch` found its
-- definition, its config entry, its test and the documents describing it -- no
-- caller. Enabling `external_dispatch_enabled` therefore filled the outbox and
-- left it full, while the documentation claimed enabling was "the only step that
-- sends mail". The documents were corrected; this file closes the gap itself.
--
-- Until this is applied AND its two Vault secrets exist, X3's real answer is
-- still the named human in INCIDENT_RESPONSE.md §1b. A dispatcher a person must
-- remember to run is still the person doing the remembering.
--
-- SHAPE, following 20260716180000 (account deletion) and 20260720120000
-- (lazywait sync): a SECURITY DEFINER driver reads Vault, posts to the function
-- over net.http_post with a dedicated trigger secret, and pg_cron calls the
-- driver. cron.job stores only a bare internal call -- no credentials, no URL.
--
-- WHY THE FUNCTION NEVER LEARNS THE EXPECTED SECRET
-- lazywait-sync reads its expected trigger secret out of
-- `integration_settings.secret_config` and compares in TypeScript. That works,
-- but it puts the secret somewhere a service-role client can read. Here the
-- secret stays in Vault and the Edge Function asks Postgres a yes/no question
-- (`verify_operations_alert_dispatch_secret`). The function can therefore
-- authenticate its caller without ever being able to read, log or leak the
-- value it is checking against.
--
-- STILL INERT ON APPLY. The driver returns early while
-- `external_dispatch_enabled` is false -- which this file does not change -- so
-- the cron job runs, does nothing, and makes no outbound request. It does not
-- even read Vault in that state, so applying this before the secrets exist is
-- safe and silent.
-- ============================================================================

-- ---- 1. Secret verification, without disclosing the secret ------------------
create or replace function public.verify_operations_alert_dispatch_secret(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  -- Fail CLOSED on every path: an empty candidate, a missing Vault entry, or an
  -- empty stored secret all deny. Never `p_secret = v_expected` alone, or an
  -- unconfigured deployment would accept an empty header.
  if p_secret is null or length(p_secret) = 0 then
    return false;
  end if;
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'operations_alert_dispatch_secret';
  if v_expected is null or length(v_expected) = 0 then
    return false;
  end if;
  return p_secret = v_expected;
end;
$$;

comment on function public.verify_operations_alert_dispatch_secret(text) is
  'Yes/no check of the dispatch trigger secret against Vault. Returns a boolean so the Edge Function can authenticate its caller without ever reading the secret.';

-- ---- 2. The driver pg_cron calls -------------------------------------------
create or replace function public.invoke_operations_alert_dispatch()
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_enabled     boolean;
  v_pending     bigint;
  v_project_url text;
  v_secret      text;
  v_request_id  bigint;
begin
  -- Gate 1: the master flag. Checked FIRST so that applying this migration
  -- before the feature is enabled costs one cheap select per tick and nothing
  -- else -- no Vault read, no HTTP, no log noise.
  select external_dispatch_enabled into v_enabled
    from public.operations_alert_settings where id;
  if not coalesce(v_enabled, false) then
    return null;
  end if;

  -- Gate 2: is there anything to do? The dispatcher is safe to call with an
  -- empty queue, but a request every five minutes forever to say "nothing"
  -- wastes an invocation and buries real activity in the logs.
  select count(*) into v_pending
    from public.operations_alert_outbox
   where channel = 'email'
     and status in ('pending', 'processing');
  if v_pending = 0 then
    return null;
  end if;

  select decrypted_secret into v_project_url
    from vault.decrypted_secrets where name = 'operations_alert_dispatch_project_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'operations_alert_dispatch_secret';

  -- Fail closed and LOUDLY: silence here would look identical to "nothing to
  -- send", which is the failure mode this whole subsystem exists to avoid.
  if v_project_url is null or v_secret is null then
    raise exception 'operations alert dispatch Vault configuration is incomplete';
  end if;

  -- Bounded: the dispatcher claims at most 20 rows and talks to SMTP, so a
  -- generous-but-finite timeout. Async fire-and-forget, like every other
  -- scheduler here; the outbox itself is the durable record of what happened.
  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/operations-alert-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alert-dispatch-secret', v_secret
    ),
    body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now()),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.invoke_operations_alert_dispatch() is
  'pg_cron driver for operations-alert-dispatch. No-ops while external dispatch is disabled or the email queue is empty; raises if Vault is incomplete once enabled.';

revoke all on function public.verify_operations_alert_dispatch_secret(text) from public, anon, authenticated;
revoke all on function public.invoke_operations_alert_dispatch() from public, anon, authenticated;
grant execute on function public.verify_operations_alert_dispatch_secret(text) to service_role;
grant execute on function public.invoke_operations_alert_dispatch() to service_role;

-- ---- 3. Schedule -------------------------------------------------------------
-- Five minutes matches the evaluator's own cadence, so an alert cannot sit
-- undelivered for longer than it took to be noticed. cron.schedule upserts by
-- name, so re-applying this file updates rather than duplicates the job.
select cron.schedule(
  'operations-alert-dispatch',
  '*/5 * * * *',
  'select public.invoke_operations_alert_dispatch();'
);

-- ---- 4. Self-verification ----------------------------------------------------
do $$
declare
  v_jobs integer;
  v_enabled boolean;
begin
  select count(*) into v_jobs from cron.job where jobname = 'operations-alert-dispatch';
  if v_jobs <> 1 then
    raise exception 'expected exactly one operations-alert-dispatch cron job, found %', v_jobs;
  end if;

  -- Applying an invocation path must not also switch the feature on.
  select external_dispatch_enabled into v_enabled
    from public.operations_alert_settings where id;
  if v_enabled is distinct from false then
    raise exception 'external_dispatch_enabled must remain false on apply (found %)', v_enabled;
  end if;

  if (select count(*) from public.operations_alert_outbox where channel = 'email') <> 0 then
    raise exception 'expected zero email outbox rows on apply';
  end if;
end $$;
