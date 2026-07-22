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

  -- Applying the chain (including activation) must not have RUN either engine:
  -- every suite rolls back, so at suite start the ledgers reflect chain-apply
  -- state only.
  if (select count(*) from public.operations_alert_runs) <> 0 then
    raise exception 'migration application must not invoke the evaluator/digest engines';
  end if;
  if (select count(*) from public.operations_alert_state)
     + (select count(*) from public.operations_alert_events)
     + (select count(*) from public.operations_digest_runs)
     + (select count(*) from public.operations_alert_outbox) <> 0 then
    raise exception 'migration application must not create alert/digest/outbox rows';
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
  if (select count(*) from cron.job) <> 5 then
    raise exception 'expected exactly 5 cron jobs total, found %', (select count(*) from cron.job);
  end if;
  if not exists (select 1 from cron.job where jobname = 'account-deletion-processor' and schedule = '* * * * *') then
    raise exception 'account-deletion-processor job changed';
  end if;
  if not exists (select 1 from cron.job where jobname = 'lazywait-sync' and schedule = '* * * * *') then
    raise exception 'lazywait-sync job changed';
  end if;
  if not exists (select 1 from cron.job
                 where jobname = 'order-integrity-watchdog' and schedule = '*/2 * * * *'
                   and command ilike '%order_integrity_watchdog%') then
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
  -- External-dispatch hard reject unchanged (admin context via GUC override).
  begin
    perform public.operations_alert_settings_update('{"external_dispatch_enabled": true}'::jsonb);
  exception when sqlstate 'P0001' then v_raised := true; end;
  if not v_raised then
    raise exception 'settings RPC must still hard-reject enabling external dispatch';
  end if;
  if (select external_dispatch_enabled from public.operations_alert_settings) then
    raise exception 'external dispatch flipped on';
  end if;

  -- Outbox dormancy constraint still enforced structurally.
  if not exists (select 1 from pg_constraint where conname = 'operations_alert_outbox_v1_dormancy') then
    raise exception 'outbox dormancy constraint missing';
  end if;

  -- No dispatcher exists: nothing in public/cron references an outbound send.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname ~* 'dispatch|send_alert|send_digest') then
    raise exception 'unexpected dispatcher-like function exists';
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
