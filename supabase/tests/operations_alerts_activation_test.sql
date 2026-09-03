-- ============================================================================
-- Internal activation tests (migration 20260723120000_activate_operations_
-- alerts_digest_cron). Transactional, rolled back; asserts the CHAIN-APPLIED
-- end state plus the still-effective runtime protections.
--
-- Guard-failure and re-apply/duplicate-job behavior is exercised at the
-- harness level (negative re-apply with external dispatch force-enabled,
-- negative re-apply with unbaselined history, and repeated re-application),
-- because the migration file itself cannot be \i-included transactionally
-- here. The dblink advisory-lock overlap test lives in the main alerts suite.
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);
select set_config('test.is_staff', '', true);
select set_config('test.auth_uid', '', true);

-- ---- A. ACTIVATION END STATE ------------------------------------------------
do $$
declare
  r record;
begin
  -- Settings: both internal engines enabled, external dispatch still false.
  select * into r from public.operations_alert_settings;
  if not r.alert_evaluation_enabled then
    raise exception 'activation must enable alert_evaluation_enabled';
  end if;
  if not r.digest_generation_enabled then
    raise exception 'activation must enable digest_generation_enabled';
  end if;
  if r.external_dispatch_enabled then
    raise exception 'activation must NOT enable external dispatch';
  end if;
  if r.timezone <> 'Asia/Riyadh' or r.digest_local_time <> time '08:00' then
    raise exception 'activation must not change timezone/digest time';
  end if;
  if r.warning_reminder_minutes <> 1440 or r.critical_reminder_minutes <> 240 then
    raise exception 'activation must not change reminder cooldowns';
  end if;

  -- Applying the chain (including activation) must not have RUN either engine.
  -- Live pg_cron may legitimately have executed the newly scheduled jobs by
  -- the time this suite runs, so the empty-ledger assertion applies only when
  -- the scheduler shows no execution of the new jobs (always true in the
  -- harness, whose cron stub never executes commands).
  if not exists (
    select 1 from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname in ('operations-alerts-evaluator', 'operations-digest-generator')
  ) then
    if (select count(*) from public.operations_alert_runs) <> 0 then
      raise exception 'migration application must not invoke the evaluator/digest engines';
    end if;
    if (select count(*) from public.operations_alert_state)
       + (select count(*) from public.operations_alert_events)
       + (select count(*) from public.operations_digest_runs)
       + (select count(*) from public.operations_alert_outbox) <> 0 then
      raise exception 'migration application must not create alert/digest/outbox rows';
    end if;
  end if;

  raise notice 'ACTIVATION END STATE OK';
end $$;

-- ---- B. CRON CONTRACT -------------------------------------------------------
do $$
declare
  n integer;
  r record;
begin
  select count(*) into n from cron.job where jobname = 'operations-alerts-evaluator';
  if n <> 1 then
    raise exception 'expected exactly 1 evaluator cron, found %', n;
  end if;
  select * into r from cron.job where jobname = 'operations-alerts-evaluator';
  if r.schedule <> '*/5 * * * *' then
    raise exception 'evaluator schedule must be every 5 minutes, got %', r.schedule;
  end if;
  if btrim(r.command) <> 'select public.operations_alerts_evaluate();' then
    raise exception 'evaluator command must be the bare internal call, got %', r.command;
  end if;

  select count(*) into n from cron.job where jobname = 'operations-digest-generator';
  if n <> 1 then
    raise exception 'expected exactly 1 digest cron, found %', n;
  end if;
  select * into r from cron.job where jobname = 'operations-digest-generator';
  if r.schedule <> '0 * * * *' then
    raise exception 'digest schedule must be hourly, got %', r.schedule;
  end if;
  if btrim(r.command) <> 'select public.operations_digest_generate();' then
    raise exception 'digest command must be the bare internal call, got %', r.command;
  end if;

  -- The three pre-existing jobs are untouched (name + schedule + own command).
  --
  -- THIS DELIBERATELY NO LONGER ASSERTS A TOTAL cron.job COUNT. It used to
  -- require exactly 5, which was true the day it was written and then wrong
  -- twice over, on jobs that were supposed to be there: payment-refund-worker
  -- (20260729090000) and branch-availability-sweep (20260820111000). A count
  -- every unrelated feature has to re-bump is a tripwire that cries wolf, and
  -- the cost was not theoretical — the suite sat quarantined and aborted HERE,
  -- so everything below this point, case C included, asserted nothing at all.
  --
  -- What is asserted instead: each of the five jobs this suite actually knows
  -- about exists exactly once, on its own schedule, running its own command.
  -- Exactly-once is safe to require because cron.schedule(name, ...) upserts by
  -- name, so a duplicate would mean something scheduled it by another route.
  --
  -- A sixth job from an unrelated feature is not this suite's business. A job
  -- that smuggles in credentials or an outbound call still fails the scan at
  -- the end of this block, which reads every row of cron.job and is unchanged.
  if (select count(*) from cron.job
      where jobname = 'account-deletion-processor'
        and schedule = '* * * * *'
        and command ilike '%invoke_account_deletion_processor%') <> 1 then
    raise exception 'account-deletion-processor job changed';
  end if;
  if (select count(*) from cron.job
      where jobname = 'lazywait-sync'
        and schedule = '* * * * *'
        and command ilike '%invoke_lazywait_sync_processor%') <> 1 then
    raise exception 'lazywait-sync job changed';
  end if;
  if (select count(*) from cron.job
      where jobname = 'order-integrity-watchdog'
        and schedule = '*/2 * * * *'
        and command ilike '%order_integrity_watchdog%') <> 1 then
    raise exception 'order-integrity-watchdog job changed';
  end if;

  -- No secrets / no external delivery mechanics inside any cron command.
  if exists (select 1 from cron.job
             where command ~* 'http|apikey|api_key|bearer|token|secret|eyJ|password') then
    raise exception 'cron command contains credential-or-HTTP material';
  end if;

  raise notice 'CRON CONTRACT OK';
end $$;

-- ---- C. PROTECTIONS STILL EFFECTIVE AFTER ACTIVATION ------------------------
do $$
declare
  v_res jsonb;
  v_raised boolean := false;
begin
  -- UPDATED FOR v2 (migration 20260903120000). These three assertions used to
  -- pin v1's refusal to dispatch at all: the settings RPC hard-rejecting the
  -- flag, the v1 dormancy constraint, and the absence of any dispatcher-like
  -- function. Email dispatch now exists, so each is replaced by the v2 property
  -- it became -- NOT deleted. What must still hold is that applying the
  -- migration changes no behaviour, and that only EMAIL was widened.

  -- The flag is now settable, and round-trips. It must still be OFF here,
  -- because the migration does not turn it on.
  if (select external_dispatch_enabled from public.operations_alert_settings) then
    raise exception 'external dispatch must be off after migration application';
  end if;
  perform public.operations_alert_settings_update('{"external_dispatch_enabled": true}'::jsonb);
  if not (select external_dispatch_enabled from public.operations_alert_settings) then
    raise exception 'v2 settings RPC must accept enabling external dispatch';
  end if;
  perform public.operations_alert_settings_update('{"external_dispatch_enabled": false}'::jsonb);
  if (select external_dispatch_enabled from public.operations_alert_settings) then
    raise exception 'external dispatch could not be turned back off';
  end if;

  -- The v1 constraint is REPLACED, not merely dropped.
  if exists (select 1 from pg_constraint
              where conname = 'operations_alert_outbox_v1_dormancy'
                and conrelid = 'public.operations_alert_outbox'::regclass) then
    raise exception 'v1 dormancy constraint should have been replaced by v2';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'operations_alert_outbox_v2_dispatch'
                    and conrelid = 'public.operations_alert_outbox'::regclass) then
    raise exception 'v2 dispatch constraint missing';
  end if;

  -- STRUCTURAL, not merely named: the other external channels must STILL be
  -- unable to leave blocked/cancelled. This is the assertion that would catch a
  -- v2 constraint written too loosely, which a name check never would.
  v_raised := false;
  begin
    insert into public.operations_alert_outbox
      (idempotency_key, digest_run_id, channel, language, subject_safe, body_safe, status, blocked_reason)
    values ('v2-guard-push', null, 'push', 'en', 's', 'b', 'pending', null);
  exception when check_violation then v_raised := true;
            when not_null_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'v2 constraint must still forbid a pending push row';
  end if;

  -- A dispatcher now exists BY DESIGN. What matters is that its functions are
  -- service-role only -- no anon/authenticated execute anywhere near them.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('operations_alerts_dispatch_recipients',
                        'claim_operations_alert_emails',
                        'finalize_operations_alert_email',
                        'release_operations_alert_email')
      and exists (select 1 from aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
                  where g.rolname in ('anon','authenticated'))
  ) then
    raise exception 'dispatch functions must not be executable by anon/authenticated';
  end if;

  -- Engines stay service-role-only SECURITY DEFINER with pinned search_path.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('operations_alerts_evaluate','operations_digest_generate')
      and (not p.prosecdef
           or not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
           or exists (select 1 from aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
                      where g.rolname in ('anon','authenticated')))
  ) then
    raise exception 'engine security contract changed';
  end if;

  -- Non-staff authorization unchanged after activation.
  perform set_config('test.is_admin', '', true);
  perform set_config('test.is_staff', '', true);
  v_raised := false;
  begin
    perform public.operations_alerts_admin_summary();
  exception when sqlstate '42501' then v_raised := true; end;
  if not v_raised then
    raise exception 'non-staff must still be denied the alerts summary';
  end if;
  perform set_config('test.is_admin', 'true', true);

  -- Digest before-time gate still effective with generation ENABLED:
  -- 21:00:01Z = 00:00:01 Asia/Riyadh -> before 08:00 -> skip, store nothing.
  v_res := public.operations_digest_generate('2026-03-10 21:00:01+00');
  if v_res ->> 'status' <> 'skipped' or v_res ->> 'reason' <> 'before_digest_time' then
    raise exception 'before-digest-time gate lost, got %', v_res;
  end if;
  if (select count(*) from public.operations_digest_runs) <> 0 then
    raise exception 'before-time run stored a digest';
  end if;

  -- One-per-day idempotency still effective: generate after the gate, twice.
  v_res := public.operations_digest_generate('2026-03-11 05:00:01+00');
  if v_res ->> 'status' <> 'ok' or jsonb_array_length(v_res -> 'generated') <> 2 then
    raise exception 'eligible digest generation failed: %', v_res;
  end if;
  v_res := public.operations_digest_generate('2026-03-11 06:00:01+00');
  if v_res -> 'generated' <> '[]'::jsonb then
    raise exception 'repeat hourly run must generate nothing, got %', v_res;
  end if;

  raise notice 'ACTIVATION PROTECTIONS OK';
end $$;

rollback;
