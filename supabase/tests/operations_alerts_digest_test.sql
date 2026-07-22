-- ============================================================================
-- Smart Operations Alerts & Daily Digest v1 tests (migration 20260723090000).
-- Transactional, deterministic, no external provider calls, no real messages.
--
-- NOTE ON ORDERING: pg_advisory_xact_lock is transaction-scoped and this whole
-- suite is one transaction, so the dblink overlap test MUST run before the
-- first main-session evaluate() call (after that this transaction owns the
-- evaluator lock until rollback).
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);
select set_config('test.is_staff', '', true);
select set_config('test.auth_uid', '', true);

-- The activation migration (20260723120000) enables the internal engines at
-- chain-apply time. This suite tests the ENGINE lifecycle from its dormant
-- starting point, so restore the pre-activation row state for the duration of
-- this (rolled-back) transaction. Column DEFAULTS staying dormant is asserted
-- separately in the contract block below.
update public.operations_alert_settings
   set alert_evaluation_enabled = false,
       digest_generation_enabled = false,
       baseline_completed_at = null
 where id;

-- ---- fixtures helpers -------------------------------------------------------
create function pg_temp.oad_job_clear(p_name text) returns void language sql as $$
  delete from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname = p_name);
$$;
create function pg_temp.oad_job_ok(p_name text) returns void language sql as $$
  select pg_temp.oad_job_clear(p_name);
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  select jobid, 'succeeded', now() - interval '60 seconds', now() - interval '50 seconds'
  from cron.job where jobname = p_name;
$$;
create function pg_temp.oad_job_fail(p_name text) returns void language sql as $$
  select pg_temp.oad_job_clear(p_name);
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  select jobid, 'failed', now() - interval '60 seconds', now() - interval '50 seconds'
  from cron.job where jobname = p_name;
$$;
create function pg_temp.oad_open(p_fp text) returns public.operations_alert_state
language sql as $$
  select s from public.operations_alert_state s
  where s.fingerprint = p_fp and s.status = 'open';
$$;
create function pg_temp.oad_events(p_fp text, p_type text) returns integer
language sql as $$
  select count(*)::integer from public.operations_alert_events
  where fingerprint = p_fp and event_type = p_type;
$$;

-- ---- A. OBJECT / SECURITY CONTRACT -----------------------------------------
do $$
declare
  r record;
  v_expected constant jsonb := '{
    "operations_health_snapshot_internal()":                              {"vol":"s","secdef":true,  "anon":false,"auth":false,"svc":true},
    "operations_health_summary()":                                        {"vol":"s","secdef":true,  "anon":false,"auth":true, "svc":false},
    "operations_alerts_derive(jsonb,jsonb)":                              {"vol":"s","secdef":false, "anon":false,"auth":false,"svc":true},
    "operations_alerts_evaluate()":                                       {"vol":"v","secdef":true,  "anon":false,"auth":false,"svc":true},
    "operations_digest_build(text,timestamp with time zone,timestamp with time zone,date,text,boolean)": {"vol":"s","secdef":true,"anon":false,"auth":false,"svc":true},
    "operations_digest_generate(timestamp with time zone)":               {"vol":"v","secdef":true,  "anon":false,"auth":false,"svc":true},
    "operations_digest_preview(text)":                                    {"vol":"s","secdef":true,  "anon":false,"auth":true, "svc":false},
    "operations_alerts_admin_summary()":                                  {"vol":"s","secdef":true,  "anon":false,"auth":true, "svc":false},
    "operations_alerts_list(text,text,text,integer)":                     {"vol":"s","secdef":true,  "anon":false,"auth":true, "svc":false},
    "operations_alert_timeline(uuid)":                                    {"vol":"s","secdef":true,  "anon":false,"auth":true, "svc":false},
    "operations_digest_list(integer)":                                    {"vol":"s","secdef":true,  "anon":false,"auth":true, "svc":false},
    "operations_alert_settings_get()":                                    {"vol":"s","secdef":true,  "anon":false,"auth":true, "svc":false},
    "operations_alert_settings_update(jsonb)":                            {"vol":"v","secdef":true,  "anon":false,"auth":true, "svc":false}
  }'::jsonb;
  v_key text;
  v_spec jsonb;
  v_oid oid;
begin
  for v_key, v_spec in select key, value from jsonb_each(v_expected) loop
    v_oid := to_regprocedure('public.' || v_key);
    if v_oid is null then
      raise exception 'missing function public.%', v_key;
    end if;
    select p.provolatile::text as vol, p.prosecdef as secdef, p.proconfig as cfg
      into r from pg_proc p where p.oid = v_oid;
    if r.vol <> (v_spec ->> 'vol') then
      raise exception '% volatility % (expected %)', v_key, r.vol, v_spec ->> 'vol';
    end if;
    if r.secdef <> (v_spec ->> 'secdef')::boolean then
      raise exception '% security definer mismatch', v_key;
    end if;
    if not ('search_path=public' = any(coalesce(r.cfg, '{}'))) then
      raise exception '% search_path not pinned: %', v_key, r.cfg;
    end if;
    if has_function_privilege('anon', v_oid, 'execute') <> (v_spec ->> 'anon')::boolean then
      raise exception '% anon grant mismatch', v_key;
    end if;
    if has_function_privilege('authenticated', v_oid, 'execute') <> (v_spec ->> 'auth')::boolean then
      raise exception '% authenticated grant mismatch', v_key;
    end if;
    if has_function_privilege('service_role', v_oid, 'execute') <> (v_spec ->> 'svc')::boolean then
      raise exception '% service_role grant mismatch', v_key;
    end if;
  end loop;

  -- tables: RLS enabled + zero client privileges
  for r in
    select c.relname,
           c.relrowsecurity,
           has_table_privilege('anon', c.oid, 'select') as anon_sel,
           has_table_privilege('authenticated', c.oid, 'select') as auth_sel,
           has_table_privilege('authenticated', c.oid, 'insert') as auth_ins
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relname in ('operations_alert_settings', 'operations_alert_runs',
                        'operations_alert_state', 'operations_alert_events',
                        'operations_digest_runs', 'operations_alert_outbox')
  loop
    if not r.relrowsecurity then raise exception '% RLS disabled', r.relname; end if;
    if r.anon_sel or r.auth_sel or r.auth_ins then
      raise exception '% grants leak to clients', r.relname;
    end if;
  end loop;

  if (select count(*) from public.operations_alert_settings) <> 1 then
    raise exception 'settings singleton not seeded';
  end if;
  -- Column DEFAULTS must stay dormant (a fresh row can never start enabled),
  -- and external dispatch must be off even after the internal activation
  -- migration (which is forbidden from touching it).
  if exists (
    select 1 from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.operations_alert_settings'::regclass
      and a.attname in ('alert_evaluation_enabled','digest_generation_enabled','external_dispatch_enabled')
      and pg_get_expr(d.adbin, d.adrelid) is distinct from 'false'
  ) then
    raise exception 'engine/dispatch column defaults must be dormant (false)';
  end if;
  if (select external_dispatch_enabled from public.operations_alert_settings) then
    raise exception 'external dispatch must never be enabled';
  end if;

  raise notice 'OBJECT / SECURITY CONTRACT OK';
end $$;

-- ---- B. AUTHORIZATION MATRIX ------------------------------------------------
do $$
declare
  v_denied integer := 0;
  v_res jsonb;
begin
  -- customer / non-staff: everything staff-facing raises 42501
  perform set_config('test.is_admin', '', true);
  perform set_config('test.is_staff', '', true);
  begin perform public.operations_alerts_admin_summary();
  exception when sqlstate '42501' then v_denied := v_denied + 1; end;
  begin perform public.operations_alerts_list('open', null, null, 10);
  exception when sqlstate '42501' then v_denied := v_denied + 1; end;
  begin perform public.operations_alert_timeline(gen_random_uuid());
  exception when sqlstate '42501' then v_denied := v_denied + 1; end;
  begin perform public.operations_digest_list(5);
  exception when sqlstate '42501' then v_denied := v_denied + 1; end;
  begin perform public.operations_alert_settings_get();
  exception when sqlstate '42501' then v_denied := v_denied + 1; end;
  begin perform public.operations_digest_preview('en');
  exception when sqlstate '42501' then v_denied := v_denied + 1; end;
  begin perform public.operations_alert_settings_update('{}'::jsonb);
  exception when sqlstate '42501' then v_denied := v_denied + 1; end;
  if v_denied <> 7 then
    raise exception 'expected 7 customer denials, got %', v_denied;
  end if;

  -- the gate-free internal snapshot is callable regardless (grant-guarded only)
  if public.operations_health_snapshot_internal() is null then
    raise exception 'internal snapshot returned null';
  end if;

  -- staff (non-admin): reads work, settings update still denied
  perform set_config('test.is_staff', 'true', true);
  perform public.operations_alerts_admin_summary();
  perform public.operations_alert_settings_get();
  v_denied := 0;
  begin perform public.operations_alert_settings_update('{}'::jsonb);
  exception when sqlstate '42501' then v_denied := 1; end;
  if v_denied <> 1 then
    raise exception 'staff must not update settings';
  end if;

  -- one authoritative health path: staff wrapper output == internal core output
  perform set_config('test.is_admin', 'true', true);
  if public.operations_health_summary() <> public.operations_health_snapshot_internal() then
    raise exception 'summary wrapper diverged from the internal snapshot core';
  end if;

  raise notice 'AUTHORIZATION MATRIX OK';
end $$;

-- ---- C. CONCURRENT EVALUATION (dblink; must precede first real evaluate) ---
do $$
declare
  v_conninfo text;
  v_res jsonb;
  v_has_dblink boolean;
begin
  select exists (select 1 from pg_extension where extname = 'dblink') into v_has_dblink;
  if not v_has_dblink then
    begin
      create extension dblink;
    exception when others then
      raise notice 'SKIP CONCURRENCY (dblink unavailable)';
      return;
    end;
  end if;
  v_conninfo := coalesce(nullif(current_setting('test.dblink_conninfo', true), ''), '');
  if v_conninfo = '' then
    raise notice 'SKIP CONCURRENCY (no test.dblink_conninfo)';
    return;
  end if;

  perform dblink_connect('oad_hold', v_conninfo);
  perform dblink_exec('oad_hold', 'begin');
  perform t.x from dblink('oad_hold', 'select 1 from pg_advisory_xact_lock(829134602)') as t(x int);

  v_res := public.operations_alerts_evaluate();
  if v_res ->> 'status' <> 'skipped' or v_res ->> 'reason' <> 'overlap_skipped' then
    raise exception 'overlapping evaluate must skip, got %', v_res;
  end if;
  if exists (select 1 from public.operations_alert_state) then
    raise exception 'overlap-skip must not create alerts';
  end if;
  if (select count(*) from public.operations_alert_runs
      where kind = 'evaluate' and status = 'skipped' and skip_reason = 'overlap_skipped') < 1 then
    raise exception 'overlap skip not recorded on the run ledger';
  end if;

  perform dblink_exec('oad_hold', 'rollback');
  perform dblink_disconnect('oad_hold');
  raise notice 'CONCURRENCY OK';
end $$;

-- ---- D. DORMANT DEFAULTS ARE SAFE NO-OPS -----------------------------------
do $$
declare
  v_res jsonb;
begin
  v_res := public.operations_alerts_evaluate();
  if v_res ->> 'status' <> 'disabled' then
    raise exception 'default-disabled evaluate must no-op, got %', v_res;
  end if;
  v_res := public.operations_digest_generate();
  if v_res ->> 'status' <> 'disabled' then
    raise exception 'default-disabled digest must no-op, got %', v_res;
  end if;
  if exists (select 1 from public.operations_alert_state)
     or exists (select 1 from public.operations_alert_events)
     or exists (select 1 from public.operations_alert_outbox)
     or exists (select 1 from public.operations_digest_runs) then
    raise exception 'disabled engines must write nothing';
  end if;
  raise notice 'DORMANT NO-OP OK';
end $$;

-- ---- E. SETTINGS RPC (admin-only; external dispatch hard-rejected) ---------
do $$
declare
  v_raised integer := 0;
  v_out jsonb;
begin
  perform set_config('test.is_admin', 'true', true);

  -- enable the engines for the rest of the suite (short reminder intervals)
  v_out := public.operations_alert_settings_update(jsonb_build_object(
    'alert_evaluation_enabled', true,
    'digest_generation_enabled', true,
    'warning_reminder_minutes', 120,
    'critical_reminder_minutes', 30));
  if not (v_out ->> 'alert_evaluation_enabled')::boolean then
    raise exception 'settings update did not apply';
  end if;
  if (v_out ->> 'external_dispatch_enabled')::boolean then
    raise exception 'external dispatch must stay off';
  end if;

  begin
    perform public.operations_alert_settings_update('{"external_dispatch_enabled": true}'::jsonb);
  exception when sqlstate 'P0001' then v_raised := v_raised + 1; end;
  begin
    perform public.operations_alert_settings_update('{"no_such_key": 1}'::jsonb);
  exception when sqlstate 'P0001' then v_raised := v_raised + 1; end;
  begin
    perform public.operations_alert_settings_update('{"warning_reminder_minutes": "soon"}'::jsonb);
  exception when sqlstate 'P0001' then v_raised := v_raised + 1; end;
  begin
    perform public.operations_alert_settings_update('{"warning_reminder_minutes": 1}'::jsonb);
  exception when sqlstate 'P0001' then v_raised := v_raised + 1; end;
  begin
    perform public.operations_alert_settings_update('{"timezone": "Mars/Olympus_Mons"}'::jsonb);
  exception when sqlstate 'P0001' then v_raised := v_raised + 1; end;
  begin
    perform public.operations_alert_settings_update('"not an object"'::jsonb);
  exception when sqlstate 'P0001' then v_raised := v_raised + 1; end;
  if v_raised <> 6 then
    raise exception 'expected 6 validation rejections, got %', v_raised;
  end if;

  -- timezone round-trip stays functional
  perform public.operations_alert_settings_update('{"timezone": "UTC"}'::jsonb);
  perform public.operations_alert_settings_update('{"timezone": "Asia/Riyadh"}'::jsonb);
  if (select external_dispatch_enabled from public.operations_alert_settings) then
    raise exception 'external_dispatch_enabled flipped on';
  end if;

  raise notice 'SETTINGS RPC OK';
end $$;

-- ---- F. BASELINE: OBSERVE, DO NOT STORM ------------------------------------
do $$
declare
  v_res jsonb;
begin
  if (select baseline_completed_at from public.operations_alert_settings) is not null then
    raise exception 'baseline marker must start null';
  end if;

  -- Baseline mode must be decided by the durable settings marker, NOT by an
  -- empty state table: simulate an all-clear first run having already
  -- completed the baseline, and verify the next incident opens NORMALLY
  -- (notified, with outbox rows) even though no alert rows exist yet.
  update public.operations_alert_settings set baseline_completed_at = now() where id;
  v_res := public.operations_alerts_evaluate();
  if v_res ->> 'status' <> 'ok' or (v_res ->> 'baseline')::boolean then
    raise exception 'post-baseline-marker run must not be baseline, got %', v_res;
  end if;
  if (v_res ->> 'opened')::integer = 0
     or exists (select 1 from public.operations_alert_events
                where event_type <> 'opened' or notification_suppressed) then
    raise exception 'post-baseline first incident must open with notifications';
  end if;
  if not exists (select 1 from public.operations_alert_outbox) then
    raise exception 'post-baseline first incident must record outbox intents';
  end if;

  -- Rewind the simulation so the real baseline path below starts clean.
  delete from public.operations_alert_outbox;
  delete from public.operations_alert_events;
  delete from public.operations_alert_state;
  update public.operations_alert_settings set baseline_completed_at = null where id;

  -- Fresh harness: the three allowlisted jobs have no completed runs yet, so
  -- alertable conditions definitely exist before the first evaluation.
  v_res := public.operations_alerts_evaluate();
  if v_res ->> 'status' <> 'ok' or not (v_res ->> 'baseline')::boolean then
    raise exception 'first evaluation must be a baseline run, got %', v_res;
  end if;
  if (select baseline_completed_at from public.operations_alert_settings) is null then
    raise exception 'successful baseline run must persist baseline_completed_at';
  end if;
  if (select count(*) from public.operations_alert_state) = 0 then
    raise exception 'baseline observed no conditions (expected job no-success conditions)';
  end if;
  if exists (select 1 from public.operations_alert_state where not baseline) then
    raise exception 'baseline run must mark every alert baseline=true';
  end if;
  if exists (select 1 from public.operations_alert_events
             where event_type <> 'baseline_observed' or not notification_suppressed) then
    raise exception 'baseline run must emit only suppressed baseline_observed events';
  end if;
  if exists (select 1 from public.operations_alert_outbox) then
    raise exception 'baseline run must enqueue NO outbox rows (no storm)';
  end if;
  if exists (select 1 from public.operations_alert_state where last_notified_at is not null) then
    raise exception 'baseline alerts must not be marked notified';
  end if;
  raise notice 'BASELINE NO-STORM OK';
end $$;

-- ---- G. LIFECYCLE TRANSITIONS ----------------------------------------------
-- New warning transitions post-baseline: enable Push (expo) with recorded
-- failures -> two DISTINCT fingerprints (deliveries vs send events).
update public.integration_settings
   set enabled = true, provider_name = 'expo',
       public_config = '{"provider":"expo"}'::jsonb, secret_config = '{}'::jsonb
 where provider_type = 'push';
insert into public.notification_log (kind, send_status, targeted, sent, failed)
values ('order_status', 'sent', 3, 2, 1);
insert into public.notification_log (kind, send_status, targeted, sent, failed)
values ('order_status', 'failed', 0, 0, 0);

do $$
declare
  v_res jsonb;
  v_a public.operations_alert_state;
  v_outbox integer;
begin
  v_res := public.operations_alerts_evaluate();
  if (v_res ->> 'baseline')::boolean then
    raise exception 'second evaluation must not be baseline';
  end if;

  -- distinct fingerprints for distinct conditions (spec case: fingerprints)
  v_a := pg_temp.oad_open('push:failed_deliveries');
  if v_a.id is null or v_a.severity <> 'warning' or v_a.baseline then
    raise exception 'push:failed_deliveries not opened as a fresh warning';
  end if;
  if (pg_temp.oad_open('push:failed_send_events')).id is null then
    raise exception 'push:failed_send_events not opened';
  end if;
  if pg_temp.oad_events('push:failed_deliveries', 'opened') <> 1 then
    raise exception 'expected one opened event';
  end if;
  if v_a.last_notified_at is null then
    raise exception 'opened alert must be marked notified';
  end if;
  select count(*) into v_outbox from public.operations_alert_outbox o
  join public.operations_alert_events e on e.id = o.alert_event_id
  where e.fingerprint = 'push:failed_deliveries';
  if v_outbox <> 2 then
    raise exception 'opened event must record in_app outbox rows for en+ar, got %', v_outbox;
  end if;
  if exists (select 1 from public.operations_alert_outbox
             where channel <> 'in_app' or status <> 'recorded') then
    raise exception 'v1 outbox may contain only recorded in_app rows';
  end if;

  -- repeated identical evaluation: occurrence bump only, no new events/outbox
  v_res := public.operations_alerts_evaluate();
  if pg_temp.oad_events('push:failed_deliveries', 'opened') <> 1 then
    raise exception 'duplicate evaluation created a duplicate opened event';
  end if;
  v_a := pg_temp.oad_open('push:failed_deliveries');
  if v_a.occurrence_count < 2 then
    raise exception 'repeated condition must bump occurrence_count';
  end if;

  raise notice 'OPEN / DEDUP OK';
end $$;

-- Escalation: the ADP job gains a recent terminal failure -> the SAME
-- fingerprint escalates warning -> critical (no recover/open churn).
select pg_temp.oad_job_fail('account-deletion-processor');
do $$
declare
  v_res jsonb;
  v_a public.operations_alert_state;
  v_fp constant text := 'database_jobs:job_health:account-deletion-processor';
begin
  v_res := public.operations_alerts_evaluate();
  v_a := pg_temp.oad_open(v_fp);
  if v_a.id is null or v_a.severity <> 'critical' then
    raise exception 'job fingerprint must escalate to critical, got %', v_a.severity;
  end if;
  if v_a.condition_code <> 'terminal_failure' then
    raise exception 'condition_code must follow the classification, got %', v_a.condition_code;
  end if;
  if pg_temp.oad_events(v_fp, 'escalated') <> 1 then
    raise exception 'expected exactly one escalated event';
  end if;
  if pg_temp.oad_events(v_fp, 'recovered') <> 0 then
    raise exception 'escalation must not produce recovery';
  end if;
  if v_a.last_notified_at is null then
    raise exception 'escalation must mark the alert notified';
  end if;
  raise notice 'ESCALATION OK';
end $$;

-- Downgrade: failure evidence clears but the job still has no success ->
-- warning again. Must NOT look like a recovery.
select pg_temp.oad_job_clear('account-deletion-processor');
do $$
declare
  v_res jsonb;
  v_a public.operations_alert_state;
  v_fp constant text := 'database_jobs:job_health:account-deletion-processor';
begin
  v_res := public.operations_alerts_evaluate();
  v_a := pg_temp.oad_open(v_fp);
  if v_a.id is null or v_a.severity <> 'warning' or v_a.status <> 'open' then
    raise exception 'downgrade must keep the alert open at warning';
  end if;
  if v_a.condition_code <> 'no_success_yet' then
    raise exception 'downgrade classification wrong: %', v_a.condition_code;
  end if;
  if pg_temp.oad_events(v_fp, 'downgraded') <> 1 then
    raise exception 'expected one downgraded event';
  end if;
  if pg_temp.oad_events(v_fp, 'recovered') <> 0 then
    raise exception 'downgrade must never mark recovery';
  end if;
  if exists (select 1 from public.operations_alert_events e
             where e.fingerprint = 'database_jobs:job_health:account-deletion-processor'
               and e.event_type = 'downgraded' and not e.notification_suppressed) then
    raise exception 'downgrade events must be notification-suppressed';
  end if;
  raise notice 'DOWNGRADE OK';
end $$;

-- Recovery (exactly once) + reopen with a new lifecycle generation.
select pg_temp.oad_job_ok('account-deletion-processor');
do $$
declare
  v_res jsonb;
  v_fp constant text := 'database_jobs:job_health:account-deletion-processor';
  v_rec public.operations_alert_state;
begin
  v_res := public.operations_alerts_evaluate();
  if (pg_temp.oad_open(v_fp)).id is not null then
    raise exception 'healthy job must not stay open';
  end if;
  select s.* into v_rec from public.operations_alert_state s
  where s.fingerprint = v_fp and s.status = 'recovered';
  if v_rec.id is null or v_rec.recovered_at is null then
    raise exception 'recovery row missing or recovered_at unset';
  end if;
  if pg_temp.oad_events(v_fp, 'recovered') <> 1 then
    raise exception 'expected exactly one recovered event';
  end if;
  -- this alert WAS notified (escalation) -> recovery is not suppressed
  if exists (select 1 from public.operations_alert_events e
             where e.fingerprint = v_fp and e.event_type = 'recovered'
               and e.notification_suppressed) then
    raise exception 'notified alert recovery must notify';
  end if;

  -- idempotent: nothing new on the next clean evaluation
  v_res := public.operations_alerts_evaluate();
  if pg_temp.oad_events(v_fp, 'recovered') <> 1 then
    raise exception 'recovery fired twice';
  end if;
  raise notice 'RECOVERY ONCE OK';
end $$;

select pg_temp.oad_job_clear('account-deletion-processor');
do $$
declare
  v_res jsonb;
  v_fp constant text := 'database_jobs:job_health:account-deletion-processor';
  v_a public.operations_alert_state;
begin
  v_res := public.operations_alerts_evaluate();
  v_a := pg_temp.oad_open(v_fp);
  if v_a.id is null or v_a.generation <> 2 or v_a.baseline then
    raise exception 'reopen must create generation 2 (non-baseline), got gen=% baseline=%',
      v_a.generation, v_a.baseline;
  end if;
  if pg_temp.oad_events(v_fp, 'opened') <> 1 then
    raise exception 'reopen must emit an opened event';
  end if;
  if (select count(*) from public.operations_alert_state where fingerprint = v_fp) <> 2 then
    raise exception 'reopen must preserve the recovered generation';
  end if;
  raise notice 'REOPEN GENERATION OK';
end $$;

-- ---- H. REMINDER COOLDOWN (idempotent) -------------------------------------
do $$
declare
  v_res jsonb;
  v_fp constant text := 'database_jobs:job_health:account-deletion-processor';
  v_a public.operations_alert_state;
begin
  -- freshly notified (opened this transaction): no reminder yet
  v_res := public.operations_alerts_evaluate();
  if pg_temp.oad_events(v_fp, 'reminder') <> 0 then
    raise exception 'reminder fired inside the cooldown interval';
  end if;

  -- backdate the notification anchor beyond the warning interval (120 min)
  update public.operations_alert_state
     set last_notified_at = now() - interval '1 day'
   where fingerprint = v_fp and status = 'open';
  v_res := public.operations_alerts_evaluate();
  if pg_temp.oad_events(v_fp, 'reminder') <> 1 then
    raise exception 'expected one reminder after the interval elapsed';
  end if;
  v_a := pg_temp.oad_open(v_fp);
  if v_a.last_reminder_at is null then
    raise exception 'reminder must stamp last_reminder_at';
  end if;

  -- immediately evaluating again must not double-remind
  v_res := public.operations_alerts_evaluate();
  if pg_temp.oad_events(v_fp, 'reminder') <> 1 then
    raise exception 'reminder is not idempotent within the interval';
  end if;
  raise notice 'REMINDER COOLDOWN OK';
end $$;

-- ---- I. CORRELATED SUBSYSTEM GROUPING --------------------------------------
insert into public.order_integrity_incidents (fingerprint, rule_code, severity, entity_type, status)
values ('TEST_RULE_A:e1', 'TEST_RULE_A', 'critical', 'order', 'open'),
       ('TEST_RULE_A:e2', 'TEST_RULE_A', 'critical', 'order', 'open'),
       ('TEST_RULE_B:e3', 'TEST_RULE_B', 'warning',  'order', 'open');
do $$
declare
  v_res jsonb;
  v_a public.operations_alert_state;
begin
  v_res := public.operations_alerts_evaluate();
  v_a := pg_temp.oad_open('order_integrity:incidents');
  if v_a.id is null or v_a.severity <> 'critical' then
    raise exception 'incident evidence must group into one critical alert';
  end if;
  if public.operations_alerts_safe_int(v_a.safe_evidence, 'open_critical_count') <> 2
     or public.operations_alerts_safe_int(v_a.safe_evidence, 'open_warning_count') <> 1 then
    raise exception 'grouped evidence counts wrong: %', v_a.safe_evidence;
  end if;
  if (select count(*) from public.operations_alert_state
      where subsystem = 'order_integrity' and status = 'open') <> 1 then
    raise exception 'order_integrity conditions must group under ONE open alert';
  end if;
  raise notice 'GROUPING OK';
end $$;
delete from public.order_integrity_incidents where rule_code like 'TEST_RULE_%';

-- ---- J. SAFE EVIDENCE / MALFORMED INPUT ------------------------------------
do $$
declare
  v jsonb;
  v_txt text;
begin
  -- sanitizer: nested payloads dropped, strings truncated, non-objects rejected
  v := public.operations_alerts_sanitize_evidence(
    jsonb_build_object(
      'nested', jsonb_build_object('secret', 'x'),
      'arr', jsonb_build_array(1, 2),
      'long', repeat('x', 500),
      'n', 5, 'b', true, 'z', null));
  if v ? 'nested' or v ? 'arr' or v ? 'z' then
    raise exception 'sanitizer kept a non-scalar/null value: %', v;
  end if;
  if length(v ->> 'long') <> 200 then
    raise exception 'sanitizer did not truncate long strings';
  end if;
  if public.operations_alerts_sanitize_evidence('[1,2]'::jsonb) <> '{}'::jsonb
     or public.operations_alerts_sanitize_evidence(null) <> '{}'::jsonb
     or public.operations_alerts_sanitize_evidence('"str"'::jsonb) <> '{}'::jsonb then
    raise exception 'sanitizer must map malformed input to {}';
  end if;

  -- derive: malformed snapshots yield no conditions (never an error)
  if public.operations_alerts_derive(null, '{}'::jsonb) <> '[]'::jsonb
     or public.operations_alerts_derive('[]'::jsonb, '{}'::jsonb) <> '[]'::jsonb
     or public.operations_alerts_derive('{"overall_state":"failing"}'::jsonb, '{}'::jsonb) <> '[]'::jsonb then
    raise exception 'derive must return [] for malformed snapshots';
  end if;

  -- no PII / secret-ish fields anywhere in alert storage
  select lower(coalesce(string_agg(s.safe_evidence::text, ' '), '')
         || coalesce((select string_agg(e.safe_evidence::text, ' ')
                      from public.operations_alert_events e), '')
         || coalesce((select string_agg(o.subject_safe || ' ' || o.body_safe
                                        || ' ' || o.template_data::text, ' ')
                      from public.operations_alert_outbox o), ''))
    into v_txt
  from public.operations_alert_state s;
  if v_txt like '%"customer%' or v_txt like '%"email"%' or v_txt like '%"phone%'
     or v_txt like '%secret%' or v_txt like '%token%' or v_txt like '%password%'
     or v_txt like '%"order_id"%' or v_txt like '%@%' then
    raise exception 'alert storage leaked a forbidden field';
  end if;

  -- fingerprints obey the machine-safe charset
  if exists (select 1 from public.operations_alert_state
             where fingerprint !~ '^[a-z0-9_:-]{3,200}$') then
    raise exception 'non-machine-safe fingerprint found';
  end if;
  raise notice 'SAFE EVIDENCE OK';
end $$;

-- ---- K. OPTIONAL SYSTEMS: TRUTHFUL, OPT-IN ONLY -----------------------------
do $$
declare
  v_res jsonb;
begin
  -- default: informational states (disabled / not_configured / not_monitored)
  -- must NOT alert
  if exists (select 1 from public.operations_alert_state
             where subsystem in ('email', 'otp') and status = 'open') then
    raise exception 'optional informational states alerted without opt-in';
  end if;

  -- admin opt-in
  perform public.operations_alert_settings_update('{"optional_system_alerts_enabled": true}'::jsonb);
  v_res := public.operations_alerts_evaluate();
  if (pg_temp.oad_open('email:configuration')).id is null then
    raise exception 'opt-in must surface optional-system configuration alerts';
  end if;

  -- opt back out -> the condition disappears and recovers
  perform public.operations_alert_settings_update('{"optional_system_alerts_enabled": false}'::jsonb);
  v_res := public.operations_alerts_evaluate();
  if (pg_temp.oad_open('email:configuration')).id is not null then
    raise exception 'opt-out must clear optional-system alerts';
  end if;

  -- per-system mute override drops a subsystem entirely
  perform public.operations_alert_settings_update(
    '{"system_rule_overrides": {"push": {"muted": true}}}'::jsonb);
  v_res := public.operations_alerts_evaluate();
  if (pg_temp.oad_open('push:failed_deliveries')).id is not null then
    raise exception 'muted subsystem must recover its open alerts';
  end if;
  perform public.operations_alert_settings_update('{"system_rule_overrides": {}}'::jsonb);
  v_res := public.operations_alerts_evaluate();
  if (pg_temp.oad_open('push:failed_deliveries')).id is null then
    raise exception 'unmuting must re-open (new generation)';
  end if;
  raise notice 'OPTIONAL SYSTEMS OK';
end $$;

-- ---- L. DAILY DIGEST --------------------------------------------------------
do $$
declare
  v_res jsonb;
  d public.operations_digest_runs;
  v_before integer;
  v_as_of timestamptz;
  v_expect_open integer;
  v_expect_rec integer;
  v_expect_unres integer;
  v_prev jsonb;
begin
  -- Riyadh local-midnight boundary (UTC+3, no DST): 20:59:59Z vs 21:00:01Z
  v_res := public.operations_digest_generate('2026-03-10 20:59:59+00');
  if v_res ->> 'status' <> 'ok' or (v_res ->> 'digest_date')::date <> date '2026-03-09' then
    raise exception 'boundary(a): expected digest_date 2026-03-09, got %', v_res;
  end if;
  select * into d from public.operations_digest_runs
  where digest_date = date '2026-03-09' and language = 'en';
  if d.period_start_utc <> timestamptz '2026-03-08 21:00:00+00'
     or d.period_end_utc <> timestamptz '2026-03-09 21:00:00+00' then
    raise exception 'boundary(a): wrong UTC period % .. %', d.period_start_utc, d.period_end_utc;
  end if;

  -- 21:00:01Z = 00:00:01 local on 2026-03-11: past local midnight but BEFORE
  -- the configured 08:00 digest time -> must wait, not generate early.
  v_res := public.operations_digest_generate('2026-03-10 21:00:01+00');
  if v_res ->> 'status' <> 'skipped' or v_res ->> 'reason' <> 'before_digest_time' then
    raise exception 'boundary(b): pre-digest-time run must skip, got %', v_res;
  end if;
  if exists (select 1 from public.operations_digest_runs where digest_date = date '2026-03-10') then
    raise exception 'boundary(b): pre-digest-time run must not store a digest';
  end if;

  -- 05:00:01Z = 08:00:01 local on 2026-03-11: at/after the configured time,
  -- the previous full local day (2026-03-10) is generated.
  v_res := public.operations_digest_generate('2026-03-11 05:00:01+00');
  if v_res ->> 'status' <> 'ok' or (v_res ->> 'digest_date')::date <> date '2026-03-10' then
    raise exception 'boundary(b): expected digest_date 2026-03-10, got %', v_res;
  end if;

  -- exactly one digest per (scope, local day, language)
  select count(*) into v_before from public.operations_digest_runs;
  v_res := public.operations_digest_generate('2026-03-10 20:59:59+00');
  if v_res -> 'generated' <> '[]'::jsonb then
    raise exception 'repeat generation must skip, got %', v_res;
  end if;
  if (select count(*) from public.operations_digest_runs) <> v_before then
    raise exception 'repeat generation inserted rows';
  end if;

  -- historical period = clean no-incident digest, both languages
  select * into d from public.operations_digest_runs
  where digest_date = date '2026-03-09' and language = 'en';
  if d.opened_count <> 0 or d.recovered_count <> 0 or d.unresolved_count <> 0 then
    raise exception 'march digest expected zero counts';
  end if;
  if position('No incidents in this period.' in d.rendered_body) = 0 then
    raise exception 'english no-incident line missing';
  end if;
  select * into d from public.operations_digest_runs
  where digest_date = date '2026-03-09' and language = 'ar';
  if position('لا توجد حوادث خلال هذه الفترة.' in d.rendered_body) = 0 then
    raise exception 'arabic no-incident line missing';
  end if;

  -- current local day: counts must match the event/state tables exactly
  -- 09:00 local next day: past the 08:00 digest-time gate.
  v_as_of := (((now() at time zone 'Asia/Riyadh')::date + 1)::timestamp
              at time zone 'Asia/Riyadh') + interval '9 hours';
  v_res := public.operations_digest_generate(v_as_of);
  if v_res ->> 'status' <> 'ok' or jsonb_array_length(v_res -> 'generated') <> 2 then
    raise exception 'today-digest generation failed: %', v_res;
  end if;
  select * into d from public.operations_digest_runs
  where digest_date = (v_res ->> 'digest_date')::date and language = 'en';
  select count(*) filter (where event_type = 'opened'),
         count(*) filter (where event_type = 'recovered')
    into v_expect_open, v_expect_rec
  from public.operations_alert_events e
  where e.created_at >= d.period_start_utc and e.created_at < d.period_end_utc;
  select count(*) into v_expect_unres
  from public.operations_alert_state
  where status = 'open' and first_seen_at < d.period_end_utc;
  if d.opened_count <> v_expect_open or d.recovered_count <> v_expect_rec
     or d.unresolved_count <> v_expect_unres then
    raise exception 'digest counts diverge from tables: got %/%/%, expected %/%/%',
      d.opened_count, d.recovered_count, d.unresolved_count,
      v_expect_open, v_expect_rec, v_expect_unres;
  end if;
  if d.overall_state is null or length(d.rendered_body) < 50 then
    raise exception 'digest rendering incomplete';
  end if;

  -- digest outbox rows: in_app + recorded + idempotent
  if (select count(*) from public.operations_alert_outbox
      where digest_run_id is not null
        and (channel <> 'in_app' or status <> 'recorded')) > 0 then
    raise exception 'digest outbox rows must be recorded in_app only';
  end if;

  -- staff preview: read-only, bilingual, flagged, validated
  perform set_config('test.is_staff', 'true', true);
  select count(*) into v_before from public.operations_digest_runs;
  v_prev := public.operations_digest_preview('ar');
  if (select count(*) from public.operations_digest_runs) <> v_before then
    raise exception 'preview inserted digest rows';
  end if;
  if not (v_prev ->> 'preview')::boolean then
    raise exception 'preview must be flagged preview=true';
  end if;
  if position('ملخص' in (v_prev ->> 'rendered_subject')) = 0 then
    raise exception 'arabic preview subject wrong: %', v_prev ->> 'rendered_subject';
  end if;
  v_prev := public.operations_digest_preview('en');
  if position('Daily Operations Digest' in (v_prev ->> 'rendered_body')) = 0 then
    raise exception 'english preview body wrong';
  end if;
  begin
    perform public.operations_digest_preview('fr');
    raise exception 'unsupported preview language must raise';
  exception when sqlstate 'P0001' then null; end;

  -- staff digest history
  if jsonb_array_length(public.operations_digest_list(50)) < 6 then
    raise exception 'digest history incomplete';
  end if;
  raise notice 'DAILY DIGEST OK';
end $$;

-- ---- M. OUTBOX DORMANCY -----------------------------------------------------
do $$
declare
  v_event uuid;
  v_before integer;
  v_ct integer;
  v_id uuid;
begin
  select id into v_event from public.operations_alert_events
  where event_type = 'opened' limit 1;

  -- idempotency: replaying the enqueue helper inserts nothing new
  select count(*) into v_before from public.operations_alert_outbox;
  v_ct := public.operations_alerts_outbox_for_event(v_event, 'opened', 'push', 'failed_deliveries', 'warning');
  if v_ct <> 0 or (select count(*) from public.operations_alert_outbox) <> v_before then
    raise exception 'outbox enqueue is not idempotent';
  end if;

  -- an external-channel row can never be anything but blocked/cancelled
  begin
    insert into public.operations_alert_outbox
      (idempotency_key, alert_event_id, channel, language, subject_safe, body_safe,
       status, blocked_reason)
    values ('test:external:recorded', v_event, 'email', 'en', 's', 'b', 'recorded', null);
    raise exception 'external recorded row must violate the dormancy constraint';
  exception when check_violation then null; end;
  begin
    insert into public.operations_alert_outbox
      (idempotency_key, alert_event_id, channel, language, subject_safe, body_safe,
       status, blocked_reason)
    values ('test:external:sent', v_event, 'whatsapp', 'ar', 's', 'b', 'sent', null);
    raise exception 'external sent row must violate the dormancy constraint';
  exception when check_violation then null; end;

  -- defaults force an external row to blocked + reason
  insert into public.operations_alert_outbox
    (idempotency_key, alert_event_id, channel, language, subject_safe, body_safe)
  values ('test:external:default', v_event, 'push', 'en', 's', 'b')
  returning id into v_id;
  if (select status from public.operations_alert_outbox where id = v_id) <> 'blocked'
     or (select blocked_reason from public.operations_alert_outbox where id = v_id)
        <> 'external_dispatch_disabled' then
    raise exception 'external default row must land blocked/external_dispatch_disabled';
  end if;
  delete from public.operations_alert_outbox where id = v_id;

  -- duplicate ACTIVE fingerprint is structurally impossible
  begin
    insert into public.operations_alert_state (fingerprint, subsystem, condition_code, severity)
    select fingerprint, subsystem, condition_code, severity
    from public.operations_alert_state where status = 'open' limit 1;
    raise exception 'duplicate open fingerprint must violate the partial unique index';
  exception when unique_violation then null; end;
  raise notice 'OUTBOX DORMANCY OK';
end $$;

-- ---- N. READ-ONLY SOURCE GUARANTEE -----------------------------------------
do $$
declare
  b bigint[]; a bigint[];
begin
  select array[
    (select count(*) from public.orders),
    (select count(*) from public.payment_records),
    (select count(*) from public.account_deletion_requests),
    (select count(*) from public.push_devices),
    (select count(*) from public.notification_log),
    (select count(*) from public.integration_settings),
    (select count(*) from public.order_integrity_incidents),
    (select count(*) from cron.job)
  ] into b;

  perform public.operations_health_snapshot_internal();
  perform public.operations_alerts_evaluate();
  perform public.operations_digest_generate();
  perform public.operations_digest_preview('en');

  select array[
    (select count(*) from public.orders),
    (select count(*) from public.payment_records),
    (select count(*) from public.account_deletion_requests),
    (select count(*) from public.push_devices),
    (select count(*) from public.notification_log),
    (select count(*) from public.integration_settings),
    (select count(*) from public.order_integrity_incidents),
    (select count(*) from cron.job)
  ] into a;

  if b is distinct from a then
    raise exception 'engine touched operational source tables: % -> %', b, a;
  end if;
  raise notice 'SOURCE READ-ONLY OK';
end $$;

-- ---- O. MISSING HEALTH SOURCE FAILS SAFELY ---------------------------------
savepoint oad_failsafe;
drop function public.operations_health_snapshot_internal();
do $$
declare
  v_res jsonb;
  b bigint[]; a bigint[];
begin
  select array[
    (select count(*) from public.operations_alert_state),
    (select count(*) from public.operations_alert_events),
    (select count(*) from public.operations_alert_outbox)
  ] into b;

  v_res := public.operations_alerts_evaluate();
  if v_res ->> 'status' <> 'failed' or v_res ->> 'safe_error_code' is null then
    raise exception 'missing health source must fail safely, got %', v_res;
  end if;
  if v_res::text ~* '(function|does not exist|operations_health)' then
    raise exception 'failure response leaked raw error detail: %', v_res;
  end if;

  select array[
    (select count(*) from public.operations_alert_state),
    (select count(*) from public.operations_alert_events),
    (select count(*) from public.operations_alert_outbox)
  ] into a;
  if b is distinct from a then
    raise exception 'failed evaluation corrupted alert state';
  end if;
  if (select count(*) from public.operations_alert_runs
      where kind = 'evaluate' and status = 'failed') < 1 then
    raise exception 'failed run not recorded on the ledger';
  end if;
  raise notice 'FAIL-SAFE OK';
end $$;
rollback to savepoint oad_failsafe;

do $$ begin raise notice 'ALL OPERATIONS ALERTS + DIGEST CASES PASSED'; end $$;
rollback;
