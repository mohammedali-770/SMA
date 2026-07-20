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
-- These are the properties that keep the driver safe. The worker's runtime
-- behaviour (429/timeout/5xx retryable, duplicate/already-synced no-resend,
-- stale-claim recovery) is covered by the UNCHANGED tests
-- supabase/functions/_shared/lazywait.test.ts and supabase/tests/lazywait_reap_test.sql
-- — this migration adds no worker logic, so that coverage still applies.
--
-- Covers:
--   1. Exactly one 'lazywait-sync' cron job exists, active, every-minute.
--   2. cron.job stores ONLY the bare function call — NO secret/URL literal.
--   3. invoke_lazywait_sync_processor is SECURITY DEFINER with a pinned
--      search_path and is service-role-only (no public/anon/authenticated EXECUTE).
--   4. The driver FAILS CLOSED: with no Vault config it raises the documented
--      'incomplete' error and makes no HTTP call.
--   5. The observability view exists and is not readable by client roles.
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
  v_has_path   boolean;
  v_bad_grants int;
  v_raised     boolean := false;
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
  select p.prosecdef, p.proconfig
    into v_secdef, v_config
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
  -- No EXECUTE for public/anon/authenticated (service_role only).
  select count(*) into v_bad_grants
    from information_schema.routine_privileges
   where routine_schema = 'public'
     and routine_name = 'invoke_lazywait_sync_processor'
     and grantee in ('PUBLIC', 'anon', 'authenticated')
     and privilege_type = 'EXECUTE';
  if v_bad_grants <> 0 then
    raise exception 'CASE 3 FAILED: client roles hold EXECUTE on the driver (% grants)', v_bad_grants;
  end if;

  -- Case 4: fail closed. With no Vault entries the driver must raise the
  -- documented 'incomplete' error BEFORE any net.http_post.
  begin
    perform public.invoke_lazywait_sync_processor();
  exception when others then
    v_raised := true;
    if sqlerrm !~ 'Vault configuration is incomplete' then
      raise exception 'CASE 4 FAILED: unexpected error from driver -> %', sqlerrm;
    end if;
  end;
  if not v_raised then
    raise exception 'CASE 4 FAILED: driver did not fail closed without Vault config';
  end if;

  -- Case 5: observability view exists and is not client-readable.
  if not exists (
    select 1 from information_schema.views
     where table_schema = 'public' and table_name = 'lazywait_sync_cron_health'
  ) then
    raise exception 'CASE 5 FAILED: lazywait_sync_cron_health view missing';
  end if;
  select count(*) into v_bad_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'lazywait_sync_cron_health'
     and grantee in ('PUBLIC', 'anon', 'authenticated')
     and privilege_type = 'SELECT';
  if v_bad_grants <> 0 then
    raise exception 'CASE 5 FAILED: client roles can read lazywait_sync_cron_health (% grants)', v_bad_grants;
  end if;

  raise notice 'ALL LAZYWAIT SYNC SCHEDULER CASES PASSED';
end $$;

rollback;
