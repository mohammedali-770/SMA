-- ============================================================================
-- Spicy Meal — Activate INTERNAL Smart Operations Alerts + Daily Digest
-- automation (v1 activation).
--
-- Turns on the two internal engines delivered dormant by
-- 20260723090000_smart_operations_alerts_digest and schedules them:
--
--   * operations-alerts-evaluator   every 5 minutes  -> select public.operations_alerts_evaluate();
--   * operations-digest-generator   hourly (minute 0) -> select public.operations_digest_generate();
--
-- The digest cron is HOURLY on purpose (not one exact daily firing): the digest
-- function itself is the source of truth for WHEN a digest may be produced —
-- it skips with reason 'before_digest_time' until the configured local time
-- (08:00 Asia/Riyadh), covers the previous FULL local day, stores at most one
-- digest per (scope, date, language) idempotently, and takes an advisory lock
-- against overlap. Hourly scheduling therefore only adds recovery: if the
-- database or job runner is unavailable at 08:00, the digest is generated on
-- the next hourly tick instead of being lost for the day.
--
-- INTERNAL ONLY — this migration does NOT:
--   * enable external dispatch (guard below actively refuses to run if it is
--     enabled; the settings row's external_dispatch_enabled is not touched);
--   * weaken the outbox dormancy constraint or the settings-RPC hard reject;
--   * create any dispatcher, provider integration, or Edge Function;
--   * send any message of any kind;
--   * invoke the evaluator or digest generator itself (first execution happens
--     only via the schedules above);
--   * modify the baseline marker, alert/digest history, or any operational
--     source table;
--   * touch the three pre-existing cron jobs (account-deletion-processor,
--     lazywait-sync, order-integrity-watchdog).
--
-- IDEMPOTENCY: re-applying this migration is safe. The guards re-verify the
-- same invariants; the flag UPDATE is absolute (sets the same values); and the
-- two jobs are re-created via unschedule-then-schedule OF OUR OWN NAMES ONLY,
-- so exactly one job per name exists afterwards and a job under one of these
-- names that does NOT belong to this feature aborts the migration instead of
-- being hijacked. (pg_cron jobs are not commentable objects; the job contract
-- is documented here and in docs/OPERATIONS_ALERTS_DIGEST.md.)
--
-- BASELINE GATE: a system with prior evaluator activity must have completed
-- its baseline (operations_alert_settings.baseline_completed_at not null) —
-- activating an unbaselined, previously-active system could misclassify the
-- backlog. A COMPLETELY FRESH deployment (zero evaluator runs and zero alert
-- rows, e.g. a new environment applying the whole chain) is allowed: there the
-- FIRST scheduled enabled run performs the designed baseline-no-storm pass and
-- persists the marker itself.
--
-- ROLLBACK / SAFE DISABLE (non-destructive, reviewed procedure):
--   select cron.unschedule('operations-alerts-evaluator');
--   select cron.unschedule('operations-digest-generator');
--   update public.operations_alert_settings
--      set alert_evaluation_enabled = false,
--          digest_generation_enabled = false
--    where id;
-- (Keeps baseline, alert history, digest history, unrelated crons, and the
--  disabled external dispatch exactly as they are.)
-- ============================================================================

create extension if not exists pg_cron;  -- already present in Production

-- ---- 0. Fail-closed activation guards --------------------------------------
do $$
declare
  v_s public.operations_alert_settings%rowtype;
  v_runs bigint;
  v_state bigint;
  v_proc regprocedure;
begin
  -- The EXACT callables the cron commands invoke must exist with the reviewed
  -- security contract (SECURITY DEFINER + pinned search_path). Signature-level
  -- resolution matters: cron.schedule stores only command text, so a renamed /
  -- re-signatured function would otherwise activate jobs that fail every tick
  -- instead of fail-closing here.
  --
  -- Evaluator: the cron runs `select public.operations_alerts_evaluate();`
  -- -> the zero-argument signature must resolve.
  v_proc := to_regprocedure('public.operations_alerts_evaluate()');
  if v_proc is null then
    raise exception 'activation blocked: public.operations_alerts_evaluate() (zero-argument signature) does not resolve';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = v_proc::oid
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
  ) then
    raise exception 'activation blocked: operations_alerts_evaluate() security contract changed';
  end if;
  -- Digest generator: the cron runs `select public.operations_digest_generate();`
  -- -> the reviewed (timestamptz) signature must resolve AND its parameter must
  -- carry a default so the bare zero-argument call is valid.
  v_proc := to_regprocedure('public.operations_digest_generate(timestamptz)');
  if v_proc is null then
    raise exception 'activation blocked: public.operations_digest_generate(timestamptz) does not resolve';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = v_proc::oid
      and p.pronargdefaults >= 1
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
  ) then
    raise exception 'activation blocked: operations_digest_generate() lost its bare-call default or its security contract changed';
  end if;

  -- The v1 outbox dormancy CHECK must still be in force ON THE OUTBOX TABLE
  -- (a same-named constraint elsewhere must not satisfy this): internal
  -- activation is only safe while external delivery is structurally impossible.
  if not exists (
    select 1 from pg_constraint
    where conname = 'operations_alert_outbox_v1_dormancy'
      and conrelid = 'public.operations_alert_outbox'::regclass
      and contype = 'c'
  ) then
    raise exception 'activation blocked: outbox dormancy constraint operations_alert_outbox_v1_dormancy is missing from public.operations_alert_outbox';
  end if;

  select * into v_s from public.operations_alert_settings where id;
  if not found then
    raise exception 'activation blocked: operations_alert_settings singleton row is missing';
  end if;

  if v_s.external_dispatch_enabled then
    raise exception 'activation blocked: external_dispatch_enabled is true; internal activation refuses to run until it is false';
  end if;

  -- Only meaningful evaluator history blocks activation: successful evaluator
  -- runs (which always persist the baseline marker — success with a null
  -- marker means inconsistent state) or existing alert rows. Skipped/failed
  -- probe runs and digest-kind ledger rows (the digest generator records its
  -- ledger row even while disabled) are harmless and must not block.
  select count(*) into v_runs from public.operations_alert_runs
   where kind = 'evaluate' and status = 'success';
  select count(*) into v_state from public.operations_alert_state;
  if v_s.baseline_completed_at is null and (v_runs > 0 or v_state > 0) then
    raise exception 'activation blocked: evaluator history exists but baseline_completed_at is null — complete the baseline first';
  end if;

  -- Foreign/duplicate-job guards: never adopt, replace, or coexist with a job
  -- we do not own. pg_cron permits same-named jobs across owners, so EVERY
  -- visible row under a reserved name must carry exactly the canonical bare
  -- internal call, and at most ONE such row may exist — any other command
  -- (including wrappers that merely mention the function) or any ambiguity
  -- aborts the migration fail-closed instead of being unscheduled/replaced.
  if exists (select 1 from cron.job
             where jobname = 'operations-alerts-evaluator'
               and btrim(command) is distinct from 'select public.operations_alerts_evaluate();')
     or (select count(*) from cron.job where jobname = 'operations-alerts-evaluator') > 1 then
    raise exception 'activation blocked: a foreign or duplicate cron job named "operations-alerts-evaluator" exists; verify/remove it first';
  end if;
  if exists (select 1 from cron.job
             where jobname = 'operations-digest-generator'
               and btrim(command) is distinct from 'select public.operations_digest_generate();')
     or (select count(*) from cron.job where jobname = 'operations-digest-generator') > 1 then
    raise exception 'activation blocked: a foreign or duplicate cron job named "operations-digest-generator" exists; verify/remove it first';
  end if;
end $$;

-- ---- 1. Enable the two INTERNAL automations ---------------------------------
-- external_dispatch_enabled is deliberately NOT in the SET list: it stays
-- exactly as guarded above (false), and the settings RPC continues to
-- hard-reject enabling it.
update public.operations_alert_settings
   set alert_evaluation_enabled = true,
       digest_generation_enabled = true
 where id;

-- ---- 2. Schedule the two jobs (idempotent, own-names-only) ------------------
-- Remove any prior definition OF OUR OWN jobs (guard above proved ownership),
-- then create the canonical definition, so re-application can never duplicate
-- a job or drift its schedule/command.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'operations-alerts-evaluator') then
    perform cron.unschedule('operations-alerts-evaluator');
  end if;
  if exists (select 1 from cron.job where jobname = 'operations-digest-generator') then
    perform cron.unschedule('operations-digest-generator');
  end if;
end $$;

-- Every 5 minutes; the evaluator itself is transition-only, dedup-safe and
-- advisory-locked, so overlapping/frequent ticks cannot storm or duplicate.
select cron.schedule(
  'operations-alerts-evaluator',
  '*/5 * * * *',
  'select public.operations_alerts_evaluate();'
);

-- Hourly recovery cadence; the function enforces the 08:00 Asia/Riyadh gate,
-- previous-full-local-day window, one-per-day/language idempotency and the
-- advisory lock (see header). cron.job stores only this bare internal call —
-- no credentials, no HTTP, no external target.
select cron.schedule(
  'operations-digest-generator',
  '0 * * * *',
  'select public.operations_digest_generate();'
);

-- ---- 3. Post-schedule self-verification -------------------------------------
-- The whole migration is one transaction: if the end state is not EXACTLY one
-- canonical job per reserved name, raise and roll everything back.
do $$
begin
  if (select count(*) from cron.job where jobname = 'operations-alerts-evaluator') <> 1
     or (select count(*) from cron.job
         where jobname = 'operations-alerts-evaluator'
           and schedule = '*/5 * * * *'
           and btrim(command) = 'select public.operations_alerts_evaluate();') <> 1 then
    raise exception 'activation verification failed: operations-alerts-evaluator is not in the canonical single-job state';
  end if;
  if (select count(*) from cron.job where jobname = 'operations-digest-generator') <> 1
     or (select count(*) from cron.job
         where jobname = 'operations-digest-generator'
           and schedule = '0 * * * *'
           and btrim(command) = 'select public.operations_digest_generate();') <> 1 then
    raise exception 'activation verification failed: operations-digest-generator is not in the canonical single-job state';
  end if;
end $$;
