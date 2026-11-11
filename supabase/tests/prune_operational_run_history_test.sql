-- ============================================================================
-- prune_operational_run_history() (migration 20261001120000).
--
-- THE PROPERTY THAT MATTERS. Pruning must never change what the operations
-- health center shows. Every reader of these tables picks the NEWEST row of
-- some kind, so the prune keeps those rows at any age. Case A seeds histories
-- whose newest run, newest completed run, newest success and newest decisive run
-- are all OLDER than the windows, and asserts that operations_health_summary()
-- is identical before and after. Without the keepers it is not: a job that
-- stopped 20 days ago reads 'failing' with its history and 'degraded' without.
--
-- Transactional, deterministic, no external provider calls.
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

create temp table prune_before (summary jsonb, cron_recent bigint, integrity_recent bigint, alerts_recent bigint);
create temp table prune_keep (tbl text, id bigint, why text);
create temp table prune_gone (tbl text, id bigint, why text);

-- ---- fixture -----------------------------------------------------------------
do $$
declare
  v_wait    bigint := (select jobid from cron.job where jobname = 'lazywait-sync');
  v_watch   bigint := (select jobid from cron.job where jobname = 'order-integrity-watchdog');
  v_eval    bigint := (select jobid from cron.job where jobname = 'operations-alerts-evaluator');
  v_digest  bigint := (select jobid from cron.job where jobname = 'operations-digest-generator');
  v_gone    bigint := 999999;  -- a job that was unscheduled long ago
  v_id      bigint;
  d         integer;
begin
  if v_wait is null or v_watch is null or v_eval is null or v_digest is null then
    raise exception 'fixture: a monitored cron job is missing from cron.job';
  end if;

  delete from cron.job_run_details;
  delete from public.order_integrity_runs;
  delete from public.operations_alert_runs;

  -- lazywait-sync: healthy. One success a day for 60 days, and one a minute ago.
  for d in 1..60 loop
    insert into cron.job_run_details (jobid, status, start_time, end_time)
    values (v_wait, 'succeeded', now() - make_interval(days => d), now() - make_interval(days => d) + interval '1 second')
    returning runid into v_id;
    if d = 30 then insert into prune_gone values ('cron', v_id, 'old routine success'); end if;
    if d = 10 then insert into prune_keep values ('cron', v_id, 'inside the 14-day window'); end if;
  end loop;
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  values (v_wait, 'succeeded', now() - interval '70 seconds', now() - interval '60 seconds');

  -- order-integrity-watchdog: STOPPED 20 days ago. Its newest run is its newest
  -- success, and both are outside the window.
  for d in 20..60 loop
    insert into cron.job_run_details (jobid, status, start_time, end_time)
    values (v_watch, 'succeeded', now() - make_interval(days => d), now() - make_interval(days => d) + interval '1 second')
    returning runid into v_id;
    if d = 20 then insert into prune_keep values ('cron', v_id, 'stopped job: newest run and newest success'); end if;
    if d = 21 then insert into prune_gone values ('cron', v_id, 'stopped job: older success'); end if;
  end loop;

  -- operations-alerts-evaluator: failing now; last succeeded 30 days ago.
  for d in 30..60 loop
    insert into cron.job_run_details (jobid, status, start_time, end_time)
    values (v_eval, 'succeeded', now() - make_interval(days => d), now() - make_interval(days => d) + interval '1 second')
    returning runid into v_id;
    if d = 30 then insert into prune_keep values ('cron', v_id, 'failing job: newest success'); end if;
    if d = 31 then insert into prune_gone values ('cron', v_id, 'failing job: older success'); end if;
  end loop;
  for d in 1..29 loop
    insert into cron.job_run_details (jobid, status, start_time, end_time)
    values (v_eval, 'failed', now() - make_interval(days => d), now() - make_interval(days => d) + interval '1 second')
    returning runid into v_id;
    if d = 20 then insert into prune_gone values ('cron', v_id, 'failing job: old failure'); end if;
  end loop;
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  values (v_eval, 'failed', now() - interval '3 minutes', now() - interval '2 minutes');

  -- operations-digest-generator: three different "newest" rows, all old. Its
  -- newest run is STUCK (running, no end_time, 15 days ago); its newest
  -- completed run is a failure (16 days ago); its newest success is older still.
  for d in 17..60 loop
    insert into cron.job_run_details (jobid, status, start_time, end_time)
    values (v_digest, 'succeeded', now() - make_interval(days => d), now() - make_interval(days => d) + interval '1 second')
    returning runid into v_id;
    if d = 17 then insert into prune_keep values ('cron', v_id, 'stuck job: newest success'); end if;
    if d = 18 then insert into prune_gone values ('cron', v_id, 'stuck job: older success'); end if;
  end loop;
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  values (v_digest, 'failed', now() - interval '16 days', now() - interval '16 days' + interval '1 second')
  returning runid into v_id;
  insert into prune_keep values ('cron', v_id, 'stuck job: newest completed run (a failure)');
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  values (v_digest, 'running', now() - interval '15 days', null)
  returning runid into v_id;
  insert into prune_keep values ('cron', v_id, 'stuck job: newest run, still running');

  -- A run with no start_time is never "older than the window".
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  values (v_digest, 'starting', null, null)
  returning runid into v_id;
  insert into prune_keep values ('cron', v_id, 'no start_time');

  -- An unscheduled job: only its newest run, completed run and success survive.
  for d in 20..40 loop
    insert into cron.job_run_details (jobid, status, start_time, end_time)
    values (v_gone, 'succeeded', now() - make_interval(days => d), now() - make_interval(days => d) + interval '1 second')
    returning runid into v_id;
    if d = 20 then insert into prune_keep values ('cron', v_id, 'unscheduled job: newest'); end if;
    if d = 21 then insert into prune_gone values ('cron', v_id, 'unscheduled job: older'); end if;
  end loop;

  -- order_integrity_runs: successes 90..45 days ago, one decisive failure 40 days
  -- ago, then only benign overlap_skipped failures, the newest one day ago.
  for d in 45..90 loop
    insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now() - make_interval(days => d), now() - make_interval(days => d) + interval '2 seconds', 'success')
    returning id into v_id;
    if d = 45 then insert into prune_keep values ('integrity', v_id, 'newest success'); end if;
    if d = 46 then insert into prune_gone values ('integrity', v_id, 'older success'); end if;
  end loop;
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
  values (now() - interval '40 days', now() - interval '40 days' + interval '2 seconds', 'failed', 'boom')
  returning id into v_id;
  insert into prune_keep values ('integrity', v_id, 'newest decisive run');
  for d in 1..39 loop
    insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now() - make_interval(days => d), now() - make_interval(days => d) + interval '2 seconds', 'failed', 'overlap_skipped')
    returning id into v_id;
    if d = 1 then insert into prune_keep values ('integrity', v_id, 'newest run'); end if;
    if d = 29 then insert into prune_keep values ('integrity', v_id, 'inside the 30-day window'); end if;
    if d = 35 then insert into prune_gone values ('integrity', v_id, 'old benign failure'); end if;
  end loop;

  -- operations_alert_runs: evaluate succeeded until 35 days ago and has failed
  -- since; digest last ran, successfully, 31 days ago.
  for d in 35..90 loop
    insert into public.operations_alert_runs (kind, started_at, finished_at, status)
    values ('evaluate', now() - make_interval(days => d), now() - make_interval(days => d) + interval '2 seconds', 'success')
    returning id into v_id;
    if d = 35 then insert into prune_keep values ('alerts', v_id, 'evaluate: newest success'); end if;
    if d = 36 then insert into prune_gone values ('alerts', v_id, 'evaluate: older success'); end if;
  end loop;
  for d in 1..34 loop
    insert into public.operations_alert_runs (kind, started_at, finished_at, status)
    values ('evaluate', now() - make_interval(days => d), now() - make_interval(days => d) + interval '2 seconds', 'failed')
    returning id into v_id;
    if d = 1 then insert into prune_keep values ('alerts', v_id, 'evaluate: newest run'); end if;
    if d = 33 then insert into prune_gone values ('alerts', v_id, 'evaluate: old failure'); end if;
  end loop;
  for d in 31..60 loop
    insert into public.operations_alert_runs (kind, started_at, finished_at, status)
    values ('digest', now() - make_interval(days => d), now() - make_interval(days => d) + interval '2 seconds', 'success')
    returning id into v_id;
    if d = 31 then insert into prune_keep values ('alerts', v_id, 'digest: newest run and newest success'); end if;
    if d = 32 then insert into prune_gone values ('alerts', v_id, 'digest: older success'); end if;
  end loop;

  insert into prune_before values (
    public.operations_health_summary(),
    (select count(*) from cron.job_run_details where start_time >= now() - interval '14 days'),
    (select count(*) from public.order_integrity_runs where started_at >= now() - interval '30 days'),
    (select count(*) from public.operations_alert_runs where started_at >= now() - interval '30 days'));
end $$;

create function pg_temp.prune_present(p_tbl text, p_id bigint) returns boolean language sql as $$
  select case p_tbl
    when 'cron'      then exists (select 1 from cron.job_run_details where runid = p_id)
    when 'integrity' then exists (select 1 from public.order_integrity_runs where id = p_id)
    when 'alerts'    then exists (select 1 from public.operations_alert_runs where id = p_id)
  end;
$$;

-- ---------------------------------------------------------------------------
-- A. One prune: the old routine rows go, the health center does not move.
-- ---------------------------------------------------------------------------
do $$
declare
  v_res jsonb;
  r record;
  v_before jsonb := (select summary from prune_before);
  v_after jsonb;
begin
  v_res := public.prune_operational_run_history();
  if (v_res->>'cron_runs_deleted')::int = 0
     or (v_res->>'integrity_runs_deleted')::int = 0
     or (v_res->>'alert_runs_deleted')::int = 0 then
    raise exception 'A: every table holds prunable rows, got %', v_res;
  end if;

  for r in select * from prune_keep loop
    if not pg_temp.prune_present(r.tbl, r.id) then
      raise exception 'A: % row % was deleted but must be kept (%)', r.tbl, r.id, r.why;
    end if;
  end loop;
  for r in select * from prune_gone loop
    if pg_temp.prune_present(r.tbl, r.id) then
      raise exception 'A: % row % survived but should be pruned (%)', r.tbl, r.id, r.why;
    end if;
  end loop;

  -- Nothing newer than the windows was touched (counts taken before the prune).
  if (select count(*) from cron.job_run_details where start_time >= now() - interval '14 days')
     is distinct from (select cron_recent from prune_before) then
    raise exception 'A: the pg_cron rows inside 14 days changed';
  end if;
  if (select count(*) from public.order_integrity_runs where started_at >= now() - interval '30 days')
     is distinct from (select integrity_recent from prune_before) then
    raise exception 'A: the watchdog rows inside 30 days changed';
  end if;
  if (select count(*) from public.operations_alert_runs where started_at >= now() - interval '30 days')
     is distinct from (select alerts_recent from prune_before) then
    raise exception 'A: the alert rows inside 30 days changed';
  end if;
  if (select cron_recent from prune_before) = 0 or (select integrity_recent from prune_before) = 0
     or (select alerts_recent from prune_before) = 0 then
    raise exception 'A: the fixture must hold rows inside every window';
  end if;

  v_after := public.operations_health_summary();
  if v_after is distinct from v_before then
    raise exception 'A: the health summary changed: before % / after %', v_before, v_after;
  end if;

  -- The stopped job is the case the keepers exist for: still 'failing'.
  if (select j->>'state' from jsonb_array_elements(v_after->'jobs') j
       where j->>'job_name' = 'order-integrity-watchdog') <> 'failing' then
    raise exception 'A: the job that stopped 20 days ago must still read failing';
  end if;

  raise notice 'A: pruned %, health summary unchanged', v_res;
end $$;

-- ---------------------------------------------------------------------------
-- B. A second prune finds nothing more to do.
-- ---------------------------------------------------------------------------
do $$
declare v_res jsonb;
begin
  v_res := public.prune_operational_run_history();
  if (v_res->>'cron_runs_deleted')::int <> 0
     or (v_res->>'integrity_runs_deleted')::int <> 0
     or (v_res->>'alert_runs_deleted')::int <> 0 then
    raise exception 'B: a second prune must delete nothing, got %', v_res;
  end if;
  raise notice 'B: idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- C. The batch bounds the work per run, oldest first.
-- ---------------------------------------------------------------------------
do $$
declare
  v_res jsonb;
  v_job bigint := (select jobid from cron.job where jobname = 'lazywait-sync');
  v_oldest bigint;
begin
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  select v_job, 'succeeded', now() - make_interval(days => d), now() - make_interval(days => d) + interval '1 second'
    from generate_series(100, 104) d;
  select min(runid) into v_oldest from cron.job_run_details
   where jobid = v_job and start_time < now() - interval '99 days';

  v_res := public.prune_operational_run_history(2);
  if (v_res->>'cron_runs_deleted')::int <> 2 then
    raise exception 'C: a batch of 2 must delete exactly 2 rows, got %', v_res;
  end if;
  if exists (select 1 from cron.job_run_details where runid = v_oldest) then
    raise exception 'C: the batch must take the oldest rows first';
  end if;

  v_res := public.prune_operational_run_history();
  if (v_res->>'cron_runs_deleted')::int <> 3 then
    raise exception 'C: the next full prune must take the remaining 3, got %', v_res;
  end if;
  raise notice 'C: batch bound holds';
end $$;

-- ---------------------------------------------------------------------------
-- D. Closed to client roles, open to the scheduler's owner.
-- ---------------------------------------------------------------------------
do $$
declare v_state text;
begin
  if has_function_privilege('anon', 'public.prune_operational_run_history(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.prune_operational_run_history(integer)', 'execute') then
    raise exception 'D: a client role can execute the prune';
  end if;

  begin
    set local role authenticated;
    perform public.prune_operational_run_history();
    v_state := 'ran';
  exception when insufficient_privilege then
    v_state := '42501';
  end;
  reset role;
  if v_state <> '42501' then
    raise exception 'D: authenticated must be refused, got %', v_state;
  end if;

  if (select count(*) from cron.job
       where jobname = 'operational-history-prune'
         and schedule = '10 1 * * *'
         and btrim(command) = 'select public.prune_operational_run_history();') <> 1 then
    raise exception 'D: the daily job is not scheduled as documented';
  end if;
  raise notice 'D: privileges and schedule hold';
end $$;

rollback;
