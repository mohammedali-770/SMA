-- ============================================================================
-- Operations Health — internal automation cron monitoring tests
-- (migration 20260723140000_operations_automation_cron_health).
--
-- Verifies that the scheduled-jobs card now also observes the two INTERNAL
-- automation crons — operations-alerts-evaluator (*/5) and
-- operations-digest-generator (hourly) — with PER-CADENCE staleness windows,
-- as NON-CRITICAL jobs that never affect the overall platform state, and that
-- the alert engine derives WARNING (not critical) per-job conditions for them.
--
-- Transactional, deterministic, no external provider calls.
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

-- ---- fixtures helpers -------------------------------------------------------
create function pg_temp.oac_ready(p_name text, p_schedule text) returns void language sql as $$
  update cron.job set active = true, schedule = p_schedule where jobname = p_name;
  delete from cron.job_run_details
   where jobid in (select jobid from cron.job where jobname = p_name);
$$;
create function pg_temp.oac_success(p_name text, p_age interval) returns void language sql as $$
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  select jobid, 'succeeded', now() - p_age - interval '10 seconds', now() - p_age
  from cron.job where jobname = p_name;
$$;
create function pg_temp.oac_fail(p_name text, p_age interval) returns void language sql as $$
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  select jobid, 'failed', now() - p_age - interval '10 seconds', now() - p_age
  from cron.job where jobname = p_name;
$$;
-- Reset the three CRITICAL application crons to a fresh, healthy state so any
-- movement in database_jobs / overall is attributable to the automation crons.
create function pg_temp.oac_critical_healthy() returns void language sql as $$
  select pg_temp.oac_ready('account-deletion-processor','* * * * *');
  select pg_temp.oac_success('account-deletion-processor', interval '60 seconds');
  select pg_temp.oac_ready('lazywait-sync','* * * * *');
  select pg_temp.oac_success('lazywait-sync', interval '60 seconds');
  select pg_temp.oac_ready('order-integrity-watchdog','*/2 * * * *');
  select pg_temp.oac_success('order-integrity-watchdog', interval '60 seconds');
$$;
create function pg_temp.oac_jobstate(p_name text) returns text language sql as $$
  select j->>'state'
  from jsonb_array_elements(public.operations_health_summary()->'jobs') j
  where j->>'job_name' = p_name;
$$;
create function pg_temp.oac_dbjobs_state() returns text language sql as $$
  select x->>'state'
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id' = 'database_jobs';
$$;
create function pg_temp.oac_automation_state() returns text language sql as $$
  select x->'details'->>'automation_state'
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id' = 'database_jobs';
$$;
create function pg_temp.oac_overall() returns text language sql as $$
  select public.operations_health_summary()->>'overall_state';
$$;
create function pg_temp.oac_has_attention(p_code text) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(public.operations_health_summary()->'attention') a
    where a->>'code' = p_code);
$$;
create function pg_temp.oac_attention_sev(p_code text) returns text language sql as $$
  select a->>'severity'
  from jsonb_array_elements(public.operations_health_summary()->'attention') a
  where a->>'code' = p_code
  limit 1;
$$;

-- ---- A. ALLOWLIST SHAPE: 5 JOBS, 2 NON-CRITICAL AUTOMATION CRONS ------------
do $$
declare
  s jsonb;
  dbj jsonb;
  ev jsonb;
  dg jsonb;
begin
  perform pg_temp.oac_critical_healthy();
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '3 minutes');
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '30 minutes');

  s := public.operations_health_summary();

  if jsonb_array_length(s->'jobs') <> 5 then
    raise exception 'expected 5 allowlisted jobs, got %', jsonb_array_length(s->'jobs');
  end if;

  select x->'details' into dbj
  from jsonb_array_elements(s->'systems') x where x->>'id' = 'database_jobs';
  if (dbj->>'expected_jobs')::int <> 5
     or (dbj->>'critical_jobs')::int <> 3
     or (dbj->>'automation_jobs')::int <> 2 then
    raise exception 'database_jobs counts wrong: %', dbj;
  end if;
  if dbj->>'automation_state' is null then
    raise exception 'database_jobs.details.automation_state missing';
  end if;

  select j into ev from jsonb_array_elements(s->'jobs') j where j->>'job_name'='operations-alerts-evaluator';
  select j into dg from jsonb_array_elements(s->'jobs') j where j->>'job_name'='operations-digest-generator';
  if ev is null or dg is null then
    raise exception 'automation crons missing from jobs[]';
  end if;
  if (ev->>'critical')::boolean or (dg->>'critical')::boolean then
    raise exception 'automation crons must be non-critical';
  end if;
  -- The three application crons stay critical.
  if (select count(*) from jsonb_array_elements(s->'jobs') j
      where j->>'job_name' in ('account-deletion-processor','lazywait-sync','order-integrity-watchdog')
        and (j->>'critical')::boolean) <> 3 then
    raise exception 'the three application crons must remain critical';
  end if;

  raise notice 'ALLOWLIST SHAPE OK';
end $$;

-- ---- B. PER-CADENCE STALENESS: HEALTHY-BUT-IDLE IS NOT FAILING --------------
-- The whole point of the migration: the flat 6-minute stale rule would mark a
-- healthy hourly digest failing between ticks. With per-cadence windows an
-- idle-but-recent success stays healthy.
do $$
begin
  perform pg_temp.oac_critical_healthy();

  -- Evaluator (*/5, 15m window): a success 3 min ago is healthy...
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '3 minutes');
  if pg_temp.oac_jobstate('operations-alerts-evaluator') <> 'healthy' then
    raise exception 'evaluator 3m-old success must be healthy, got %',
      pg_temp.oac_jobstate('operations-alerts-evaluator');
  end if;
  -- ...a success 12 min ago (< 15m) is still healthy...
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '12 minutes');
  if pg_temp.oac_jobstate('operations-alerts-evaluator') <> 'healthy' then
    raise exception 'evaluator 12m-old success must be healthy (within 15m), got %',
      pg_temp.oac_jobstate('operations-alerts-evaluator');
  end if;
  -- ...but 20 min ago (> 15m) is failing.
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '20 minutes');
  if pg_temp.oac_jobstate('operations-alerts-evaluator') <> 'failing' then
    raise exception 'evaluator 20m-old success must be failing (beyond 15m), got %',
      pg_temp.oac_jobstate('operations-alerts-evaluator');
  end if;

  -- Digest (hourly, 130m window): 90 min ago is HEALTHY (flat 6m rule would have
  -- called this failing — the bug this migration fixes)...
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '90 minutes');
  if pg_temp.oac_jobstate('operations-digest-generator') <> 'healthy' then
    raise exception 'hourly digest 90m-old success must be healthy, got %',
      pg_temp.oac_jobstate('operations-digest-generator');
  end if;
  -- ...125 min ago (< 130m) still healthy...
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '125 minutes');
  if pg_temp.oac_jobstate('operations-digest-generator') <> 'healthy' then
    raise exception 'hourly digest 125m-old success must be healthy (within 130m), got %',
      pg_temp.oac_jobstate('operations-digest-generator');
  end if;
  -- ...140 min ago (> 130m) is failing.
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '140 minutes');
  if pg_temp.oac_jobstate('operations-digest-generator') <> 'failing' then
    raise exception 'hourly digest 140m-old success must be failing (beyond 130m), got %',
      pg_temp.oac_jobstate('operations-digest-generator');
  end if;

  raise notice 'PER-CADENCE STALENESS OK';
end $$;

-- ---- C. NON-CRITICAL ISOLATION: AUTOMATION NEVER FLIPS THE PLATFORM ---------
do $$
declare
  ov_base text;
  db_base text;
begin
  perform pg_temp.oac_critical_healthy();
  -- Both automation crons healthy -> capture the baseline overall/database_jobs.
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '3 minutes');
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '30 minutes');
  ov_base := pg_temp.oac_overall();
  db_base := pg_temp.oac_dbjobs_state();
  if db_base <> 'healthy' then
    raise exception 'with all crons healthy, database_jobs must be healthy, got %', db_base;
  end if;
  if pg_temp.oac_automation_state() <> 'healthy' then
    raise exception 'automation_state must be healthy, got %', pg_temp.oac_automation_state();
  end if;

  -- Now drive the DIGEST cron to failing (stale) — a NON-critical job.
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '140 minutes');

  if pg_temp.oac_jobstate('operations-digest-generator') <> 'failing' then
    raise exception 'digest must be failing after 140m staleness';
  end if;
  if pg_temp.oac_automation_state() <> 'failing' then
    raise exception 'automation_state must reflect the failing automation cron, got %',
      pg_temp.oac_automation_state();
  end if;
  -- CRITICAL rollup and overall state must be UNCHANGED by the automation cron.
  if pg_temp.oac_dbjobs_state() <> db_base then
    raise exception 'automation failure must not change database_jobs state (% -> %)',
      db_base, pg_temp.oac_dbjobs_state();
  end if;
  if pg_temp.oac_overall() <> ov_base then
    raise exception 'automation failure must not change overall state (% -> %)',
      ov_base, pg_temp.oac_overall();
  end if;
  -- It is surfaced as a WARNING attention item, never a critical one.
  if not pg_temp.oac_has_attention('OPERATIONS_AUTOMATION_JOBS_FAILING') then
    raise exception 'failing automation cron must raise OPERATIONS_AUTOMATION_JOBS_FAILING';
  end if;
  if pg_temp.oac_attention_sev('OPERATIONS_AUTOMATION_JOBS_FAILING') <> 'warning' then
    raise exception 'automation attention must be warning severity, got %',
      pg_temp.oac_attention_sev('OPERATIONS_AUTOMATION_JOBS_FAILING');
  end if;
  -- With all three critical crons healthy there must be NO critical scheduled-job
  -- attention item caused by the automation cron.
  if pg_temp.oac_has_attention('SCHEDULED_JOBS_FAILING') then
    raise exception 'automation cron must not raise a critical SCHEDULED_JOBS_FAILING item';
  end if;

  raise notice 'NON-CRITICAL ISOLATION OK';
end $$;

-- ---- D. DEGRADED AUTOMATION (no completed success yet) ----------------------
do $$
begin
  perform pg_temp.oac_critical_healthy();
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '3 minutes');
  -- Digest active but with no completed run at all -> degraded (no_success_yet).
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');

  if pg_temp.oac_jobstate('operations-digest-generator') <> 'degraded' then
    raise exception 'digest with no success ever must be degraded, got %',
      pg_temp.oac_jobstate('operations-digest-generator');
  end if;
  if pg_temp.oac_automation_state() <> 'degraded' then
    raise exception 'automation_state must be degraded, got %', pg_temp.oac_automation_state();
  end if;
  if pg_temp.oac_dbjobs_state() <> 'healthy' then
    raise exception 'a degraded automation cron must not degrade the critical rollup, got %',
      pg_temp.oac_dbjobs_state();
  end if;
  if pg_temp.oac_attention_sev('OPERATIONS_AUTOMATION_JOBS_DEGRADED') <> 'warning' then
    raise exception 'degraded automation attention must be warning, got %',
      pg_temp.oac_attention_sev('OPERATIONS_AUTOMATION_JOBS_DEGRADED');
  end if;

  raise notice 'DEGRADED AUTOMATION OK';
end $$;

-- ---- E. CRITICAL REGRESSION: A FAILING CRITICAL CRON STILL FLIPS THE ROLLUP -
do $$
begin
  perform pg_temp.oac_critical_healthy();
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '3 minutes');
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '30 minutes');

  -- Make a CRITICAL cron stale (>6m) -> database_jobs must go failing.
  perform pg_temp.oac_ready('lazywait-sync','* * * * *');
  perform pg_temp.oac_success('lazywait-sync', interval '10 minutes');

  if pg_temp.oac_jobstate('lazywait-sync') <> 'failing' then
    raise exception 'stale critical cron must be failing, got %',
      pg_temp.oac_jobstate('lazywait-sync');
  end if;
  if pg_temp.oac_dbjobs_state() <> 'failing' then
    raise exception 'a failing critical cron MUST flip database_jobs to failing, got %',
      pg_temp.oac_dbjobs_state();
  end if;
  if not pg_temp.oac_has_attention('SCHEDULED_JOBS_FAILING')
     or pg_temp.oac_attention_sev('SCHEDULED_JOBS_FAILING') <> 'critical' then
    raise exception 'failing critical cron must raise a critical SCHEDULED_JOBS_FAILING item';
  end if;

  raise notice 'CRITICAL REGRESSION OK';
end $$;

-- ---- F. DERIVE: PER-JOB ALERT SEVERITY FOLLOWS THE CRITICAL FLAG ------------
do $$
declare
  s jsonb;
  conds jsonb;
  dg_sev text;
  lw_sev text;
begin
  perform pg_temp.oac_critical_healthy();
  perform pg_temp.oac_ready('operations-alerts-evaluator','*/5 * * * *');
  perform pg_temp.oac_success('operations-alerts-evaluator', interval '3 minutes');
  -- Non-critical digest failing (stale) + critical lazywait-sync failing (stale).
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  perform pg_temp.oac_success('operations-digest-generator', interval '140 minutes');
  perform pg_temp.oac_ready('lazywait-sync','* * * * *');
  perform pg_temp.oac_success('lazywait-sync', interval '10 minutes');

  s := public.operations_health_summary();
  conds := public.operations_alerts_derive(s, '{}'::jsonb);

  select c->>'severity' into dg_sev
  from jsonb_array_elements(conds) c
  where c->>'fingerprint' = 'database_jobs:job_health:operations-digest-generator';
  select c->>'severity' into lw_sev
  from jsonb_array_elements(conds) c
  where c->>'fingerprint' = 'database_jobs:job_health:lazywait-sync';

  if dg_sev is null then
    raise exception 'derive must emit a per-job condition for the failing digest cron';
  end if;
  if dg_sev <> 'warning' then
    raise exception 'failing NON-critical automation cron must derive a WARNING alert, got %', dg_sev;
  end if;
  if lw_sev is null or lw_sev <> 'critical' then
    raise exception 'failing CRITICAL cron must derive a critical alert, got %', lw_sev;
  end if;

  raise notice 'DERIVE SEVERITY BY CRITICAL FLAG OK';
end $$;

-- ---- G. SAFETY: STILL NO CRON COMMANDS / SECRETS IN THE OUTPUT --------------
do $$
declare
  txt text;
begin
  perform pg_temp.oac_critical_healthy();
  perform pg_temp.oac_ready('operations-digest-generator','0 * * * *');
  update cron.job set command = 'AUTOMSENTINELCMD' where jobname = 'operations-digest-generator';
  perform pg_temp.oac_fail('operations-digest-generator', interval '5 minutes');
  txt := public.operations_health_summary()::text;
  if txt like '%AUTOMSENTINELCMD%'
     or lower(txt) like '%"command"%'
     or lower(txt) like '%"username"%'
     or lower(txt) like '%"return_message"%' then
    raise exception 'automation cron projection leaked command/username/return_message';
  end if;
  raise notice 'SAFE PROJECTION OK';
end $$;

do $$ begin raise notice 'ALL AUTOMATION CRON HEALTH CASES PASSED'; end $$;
rollback;
