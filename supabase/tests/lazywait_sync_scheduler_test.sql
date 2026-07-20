-- ============================================================================
-- Structural + fail-closed test for the lazywait-sync pg_cron driver
-- (migration 20260720120000_lazywait_sync_scheduler.sql).
--
-- Runs against a throwaway Supabase Postgres with all migrations applied (same
-- harness as lazywait_reap_test.sql — it needs pg_cron, pg_net and vault, which
-- the account-deletion scheduler migrations already require). Each case RAISES
-- EXCEPTION on failure so the script aborts non-zero; a clean run prints NOTICEs
-- and commits nothing (wrapped in a rollback).
--
-- The trigger secret is the single source of truth in integration_settings
-- (provider_type='lazywait'); it is NEVER in Vault. Only the non-secret
-- lazywait_sync_project_url lives in Vault.
--
-- The worker's runtime behaviour (429/timeout/5xx retryable, duplicate/
-- already-synced no-resend, stale-claim recovery) is covered by the UNCHANGED
-- tests supabase/functions/_shared/lazywait.test.ts and
-- supabase/tests/lazywait_reap_test.sql — this migration adds no worker logic.
--
-- Covers:
--   1. Exactly one active, every-minute 'lazywait-sync' cron job.
--   2. cron.job stores ONLY the bare function call — NO secret/URL literal.
--   3. invoke_lazywait_sync_processor is SECURITY DEFINER + pinned search_path +
--      service-role-only EXECUTE (clients cannot execute it).
--   4. The function reads the AUTHORITATIVE integration setting and takes the
--      secret from integration_settings, never from Vault.
--   5. Empty/blank secret fails closed with the documented error and no HTTP call.
--   6. Missing integration row fails closed (no HTTP call).
--   7. Secret rotation is a pure integration_settings UPDATE — no migration,
--      Vault change or redeploy: after setting the secret the driver advances
--      PAST the secret check (proving a live read) and only then needs the URL.
--   8. Observability view exists, exposes no secret, and is not client-readable.
-- ============================================================================
begin;

do $$
declare
  v_count      int;
  v_command    text;
  v_active     boolean;
  v_schedule   text;
  v_secdef     boolean;
  v_config     text[];
  v_oid        oid;
  v_has_path   boolean;
  v_bad_grants int;
  v_def        text;
  v_raised     boolean;
  v_col_secret int;
begin
  -- Case 1: exactly one active, every-minute job named 'lazywait-sync'.
  select count(*) into v_count from cron.job where jobname = 'lazywait-sync';
  if v_count <> 1 then
    raise exception 'CASE 1 FAILED: expected exactly 1 lazywait-sync job, found %', v_count;
  end if;
  select schedule, active, command
    into v_schedule, v_active, v_command
    from cron.job where jobname = 'lazywait-sync';
  if v_schedule <> '* * * * *' then
    raise exception 'CASE 1 FAILED: schedule is % (expected every minute)', v_schedule;
  end if;
  if not v_active then
    raise exception 'CASE 1 FAILED: job is not active';
  end if;

  -- Case 2: the scheduled command carries NO credential/URL — just the call.
  if v_command !~ 'invoke_lazywait_sync_processor' then
    raise exception 'CASE 2 FAILED: command does not call the driver function -> %', v_command;
  end if;
  if v_command ~* 'secret|token|bearer|https?://|x-sync-secret' then
    raise exception 'CASE 2 FAILED: command appears to embed a credential/URL -> %', v_command;
  end if;

  -- Case 3: SECURITY DEFINER + pinned search_path + service-role-only EXECUTE.
  select p.oid, p.prosecdef, p.proconfig
    into v_oid, v_secdef, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoke_lazywait_sync_processor';
  if v_secdef is distinct from true then
    raise exception 'CASE 3 FAILED: invoke_lazywait_sync_processor is not SECURITY DEFINER';
  end if;
  v_has_path := exists (
    select 1 from unnest(coalesce(v_config, array[]::text[])) c where c like 'search_path=%'
  );
  if not v_has_path then
    raise exception 'CASE 3 FAILED: invoke_lazywait_sync_processor has no pinned search_path';
  end if;
  select count(*) into v_bad_grants
    from information_schema.routine_privileges
   where routine_schema = 'public'
     and routine_name = 'invoke_lazywait_sync_processor'
     and grantee in ('PUBLIC', 'anon', 'authenticated')
     and privilege_type = 'EXECUTE';
  if v_bad_grants <> 0 then
    raise exception 'CASE 3 FAILED: client roles hold EXECUTE on the driver (% grants)', v_bad_grants;
  end if;

  -- Case 4: reads the AUTHORITATIVE integration setting; secret NOT from Vault.
  v_def := pg_get_functiondef(v_oid);
  if v_def !~ 'integration_settings' or v_def !~ 'sync_trigger_secret' then
    raise exception 'CASE 4 FAILED: driver does not read sync_trigger_secret from integration_settings';
  end if;
  if v_def ~ 'lazywait_sync_trigger_secret' then
    raise exception 'CASE 4 FAILED: driver still references a Vault trigger secret';
  end if;
  -- Provider row is selected by the canonical unique key, not a bare LIMIT 1.
  if v_def !~ 'provider_type' then
    raise exception 'CASE 4 FAILED: driver does not key on provider_type';
  end if;

  -- Case 5: empty/blank secret fails closed (seeded lazywait row has secret_config '{}').
  update public.integration_settings set secret_config = '{}'::jsonb where provider_type = 'lazywait';
  v_raised := false;
  begin
    perform public.invoke_lazywait_sync_processor();
  exception when others then
    v_raised := true;
    if sqlerrm !~ 'sync_trigger_secret' then
      raise exception 'CASE 5 FAILED: unexpected error for empty secret -> %', sqlerrm;
    end if;
  end;
  if not v_raised then
    raise exception 'CASE 5 FAILED: driver did not fail closed on empty secret';
  end if;
  -- Blank/whitespace-only is also treated as unconfigured.
  update public.integration_settings set secret_config = '{"sync_trigger_secret":"   "}'::jsonb
   where provider_type = 'lazywait';
  v_raised := false;
  begin
    perform public.invoke_lazywait_sync_processor();
  exception when others then
    v_raised := true;
    if sqlerrm !~ 'sync_trigger_secret' then
      raise exception 'CASE 5 FAILED: unexpected error for blank secret -> %', sqlerrm;
    end if;
  end;
  if not v_raised then
    raise exception 'CASE 5 FAILED: driver did not fail closed on blank secret';
  end if;

  -- Case 7 (rotation proof): setting a real secret is a pure UPDATE. The driver
  -- then reads it LIVE and advances past the secret check, failing only at the
  -- (absent) project URL — proving no migration/Vault/redeploy is needed to
  -- rotate the secret, and that no HTTP call is made without the URL.
  update public.integration_settings set secret_config = '{"sync_trigger_secret":"rotated-value"}'::jsonb
   where provider_type = 'lazywait';
  v_raised := false;
  begin
    perform public.invoke_lazywait_sync_processor();
  exception when others then
    v_raised := true;
    if sqlerrm !~ 'lazywait_sync_project_url' then
      raise exception 'CASE 7 FAILED: expected project URL error after secret set, got -> %', sqlerrm;
    end if;
  end;
  if not v_raised then
    raise exception 'CASE 7 FAILED: driver did not stop at the missing project URL';
  end if;

  -- Case 6: missing integration row fails closed.
  delete from public.integration_settings where provider_type = 'lazywait';
  v_raised := false;
  begin
    perform public.invoke_lazywait_sync_processor();
  exception when others then
    v_raised := true;
    if sqlerrm !~ 'integration_settings row is missing' then
      raise exception 'CASE 6 FAILED: unexpected error for missing row -> %', sqlerrm;
    end if;
  end;
  if not v_raised then
    raise exception 'CASE 6 FAILED: driver did not fail closed on missing row';
  end if;

  -- Case 8: observability view exists, exposes no secret, not client-readable.
  if not exists (
    select 1 from information_schema.views
     where table_schema = 'public' and table_name = 'lazywait_sync_cron_health'
  ) then
    raise exception 'CASE 8 FAILED: lazywait_sync_cron_health view missing';
  end if;
  select count(*) into v_col_secret
    from information_schema.columns
   where table_schema = 'public' and table_name = 'lazywait_sync_cron_health'
     and column_name ~* 'secret|token|x_sync';
  if v_col_secret <> 0 then
    raise exception 'CASE 8 FAILED: health view exposes a secret-like column';
  end if;
  select count(*) into v_bad_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'lazywait_sync_cron_health'
     and grantee in ('PUBLIC', 'anon', 'authenticated')
     and privilege_type = 'SELECT';
  if v_bad_grants <> 0 then
    raise exception 'CASE 8 FAILED: client roles can read lazywait_sync_cron_health (% grants)', v_bad_grants;
  end if;

  raise notice 'ALL LAZYWAIT SYNC SCHEDULER CASES PASSED';
end $$;

rollback;
