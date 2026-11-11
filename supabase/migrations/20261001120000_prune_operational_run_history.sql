-- ============================================================================
-- PRUNE OPERATIONAL RUN HISTORY
--
-- WHY THIS EXISTS. The project is on Supabase's Free plan, and a Free project
-- goes READ-ONLY when its database passes 500 MB: every INSERT then fails with
-- "cannot execute INSERT in a read-only transaction", which means no order can
-- be placed (https://supabase.com/docs/guides/platform/database-size, "Free
-- Plan behavior"). Measured read-only on 2026-11-11:
--
--   database                     207 MB
--   cron.job_run_details         124 MB   660,708 rows since 2026-07-16,
--                                         ~7,080 new rows a day, never pruned
--   public.operations_alert_runs  22 MB   ~115 days of 5-minute runs, never pruned
--   public.order_integrity_runs   19 MB   ~111 days of 2-minute runs, never pruned
--
-- pg_cron never cleans its own run log (Supabase's cron docs say so), and
-- nothing in this repository did either. Two other run tables already keep 14
-- days (branch_availability_runs since 20260822090000; lazywait_sync_requests),
-- which is why they are small. At the measured growth the cap is about six
-- months away.
--
-- WHAT IS KEPT, and why the rule is "recent, plus the newest of each kind".
-- Every reader of these three tables asks for the NEWEST row of some kind, never
-- for a count over a window:
--
--   cron.job_run_details   operations_health_snapshot_internal (20260925120000)
--                          reads, per job, the newest run, the newest COMPLETED
--                          run and the newest SUCCESS.
--   order_integrity_runs   the watchdog health card reads the newest run, the
--                          newest decisive run (success, or a failure that is not
--                          overlap_skipped) and the newest success.
--   operations_alert_runs  the summary and the digest read the newest run per
--                          kind; the activation guard (20260723120000) asks only
--                          whether ANY successful evaluate run exists.
--
-- So each table keeps every row newer than its window, AND every row that one of
-- those readers would pick, however old. A job that stopped running a month ago
-- therefore still shows its real last run and last success, and the health
-- center reads exactly what it read before. supabase/tests/
-- prune_operational_run_history_test.sql asserts that the whole
-- operations_health_summary() is byte-identical before and after a prune.
--
-- Rows that tie on a reader's sort key are all kept, since a reader with no
-- tie-breaker may pick any of them.
--
-- WINDOWS. 14 days for pg_cron's log, matching the two run tables that already
-- prune. 30 days for the two monitor ledgers: they are small, and they are what
-- someone reads when asking "how long has the watchdog been unhappy".
--
-- BOUNDED WORK. At most p_batch rows (default 200,000) leave each table per run,
-- oldest first, so the first runs clear the backlog over about three days
-- instead of in one large delete. Deleting frees space inside each table for new
-- rows, so the database stops growing; it does not shrink the files. Reclaiming
-- the 124 MB now would take a one-off VACUUM FULL, which is optional and an
-- owner action (docs/MIGRATIONS.md §53).
--
-- NOTHING ELSE CHANGES. No existing function is redefined; place_order and
-- compute_order_snapshot are asserted unchanged below.
-- ============================================================================

create extension if not exists pg_cron;

-- ---- 0. Foreign-job guard (idempotent) --------------------------------------
-- Raise only if a job with this name exists that is NOT ours. Re-applying is
-- safe: cron.schedule(name, ...) upserts by name.
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'operational-history-prune' limit 1;
  if v_cmd is not null and v_cmd not ilike '%prune_operational_run_history%' then
    raise exception 'a cron job named "operational-history-prune" already exists and is not this prune: %', v_cmd;
  end if;
end $$;

-- ---- 1. The prune ------------------------------------------------------------
create or replace function public.prune_operational_run_history(p_batch integer default 200000)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch     integer := greatest(coalesce(p_batch, 200000), 0);
  v_cron      integer := 0;
  v_integrity integer := 0;
  v_alerts    integer := 0;
begin
  -- pg_cron's run log: 14 days, plus each job's newest run, newest completed
  -- run and newest success (what operations_health_snapshot_internal reads).
  -- A row with no start_time is never older than the window, so it is kept.
  with keep as (
    select d.runid
      from cron.job_run_details d
      join (select jobid, max(start_time) as m
              from cron.job_run_details group by jobid) x
        on x.jobid = d.jobid and d.start_time = x.m
    union
    select d.runid
      from cron.job_run_details d
      join (select jobid, max(end_time) as m
              from cron.job_run_details where end_time is not null group by jobid) x
        on x.jobid = d.jobid and d.end_time = x.m
    union
    select d.runid
      from cron.job_run_details d
      join (select jobid, max(end_time) as m
              from cron.job_run_details
             where status = 'succeeded' and end_time is not null group by jobid) x
        on x.jobid = d.jobid and d.end_time = x.m and d.status = 'succeeded'
  ), doomed as (
    select d.runid
      from cron.job_run_details d
     where d.start_time < now() - interval '14 days'
       and not exists (select 1 from keep k where k.runid = d.runid)
     order by d.runid
     limit v_batch
  )
  delete from cron.job_run_details d
   using doomed z
   where d.runid = z.runid;
  get diagnostics v_cron = row_count;

  -- Watchdog ledger: 30 days, plus the newest run, the newest decisive run and
  -- the newest success (what the order-integrity health card reads).
  with keep as (
    select r.id from public.order_integrity_runs r
     where r.started_at = (select max(started_at) from public.order_integrity_runs)
    union
    select r.id from public.order_integrity_runs r
     where (r.status = 'success'
            or (r.status = 'failed' and coalesce(r.safe_error_code, '') <> 'overlap_skipped'))
       and r.started_at = (select max(started_at) from public.order_integrity_runs
                            where status = 'success'
                               or (status = 'failed' and coalesce(safe_error_code, '') <> 'overlap_skipped'))
    union
    select r.id from public.order_integrity_runs r
     where r.status = 'success'
       and r.completed_at = (select max(completed_at) from public.order_integrity_runs
                              where status = 'success')
    union
    select r.id from public.order_integrity_runs r
     where r.status = 'success'
       and r.started_at = (select max(started_at) from public.order_integrity_runs
                            where status = 'success')
  ), doomed as (
    select r.id
      from public.order_integrity_runs r
     where r.started_at < now() - interval '30 days'
       and not exists (select 1 from keep k where k.id = r.id)
     order by r.id
     limit v_batch
  )
  delete from public.order_integrity_runs r
   using doomed z
   where r.id = z.id;
  get diagnostics v_integrity = row_count;

  -- Alerts ledger: 30 days, plus per kind the newest run and the newest success
  -- (what the summary, the digest and the activation guard read).
  with keep as (
    select r.id
      from public.operations_alert_runs r
      join (select kind, max(started_at) as m
              from public.operations_alert_runs group by kind) x
        on x.kind = r.kind and r.started_at = x.m
    union
    select r.id
      from public.operations_alert_runs r
      join (select kind, max(started_at) as m
              from public.operations_alert_runs where status = 'success' group by kind) x
        on x.kind = r.kind and r.started_at = x.m and r.status = 'success'
  ), doomed as (
    select r.id
      from public.operations_alert_runs r
     where r.started_at < now() - interval '30 days'
       and not exists (select 1 from keep k where k.id = r.id)
     order by r.id
     limit v_batch
  )
  delete from public.operations_alert_runs r
   using doomed z
   where r.id = z.id;
  get diagnostics v_alerts = row_count;

  return jsonb_build_object(
    'ran', true,
    'batch', v_batch,
    'cron_runs_deleted', v_cron,
    'integrity_runs_deleted', v_integrity,
    'alert_runs_deleted', v_alerts
  );
end $$;

-- No client ever calls this. The cron job runs as the function's owner.
revoke all on function public.prune_operational_run_history(integer) from public, anon, authenticated;
grant execute on function public.prune_operational_run_history(integer) to service_role;

-- ---- 2. Schedule -------------------------------------------------------------
-- Daily at 01:10 UTC (04:10 in Riyadh), after the loyalty expiry job (00:20) and
-- the OTP sweep (00:40), well away from ordering traffic. cron.job stores only
-- this bare internal call: no credentials, no HTTP, no external target.
select cron.schedule(
  'operational-history-prune',
  '10 1 * * *',
  'select public.prune_operational_run_history();'
);

-- ---- 3. Self-verification -----------------------------------------------------
-- One transaction: if any check fails, the whole file rolls back.
do $verify$
declare
  v_src text;
  v_txt text;
begin
  -- The job is in its single canonical state.
  if (select count(*) from cron.job where jobname = 'operational-history-prune') <> 1
     or (select count(*) from cron.job
          where jobname = 'operational-history-prune'
            and schedule = '10 1 * * *'
            and btrim(command) = 'select public.prune_operational_run_history();') <> 1 then
    raise exception 'run-history prune verification failed: operational-history-prune is not in the canonical single-job state';
  end if;

  -- Exactly one overload, so the cron call binds to this body.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'prune_operational_run_history') <> 1 then
    raise exception 'run-history prune verification failed: expected exactly one prune_operational_run_history';
  end if;

  -- Closed to client roles. Named explicitly, because this project's default
  -- privileges grant EXECUTE to anon and authenticated directly (CLAUDE.md §8).
  if has_function_privilege('anon', 'public.prune_operational_run_history(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.prune_operational_run_history(integer)', 'execute') then
    raise exception 'run-history prune verification failed: a client role can execute the prune';
  end if;

  -- The windows are the documented ones. A shorter pg_cron window would still be
  -- safe for the health center, but it is not what was reviewed.
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'prune_operational_run_history';
  if v_src not like '%cron.job_run_details d%interval ''14 days''%' then
    raise exception 'run-history prune verification failed: the pg_cron window is not 14 days';
  end if;
  if (length(v_src) - length(replace(v_src, 'interval ''30 days''', ''))) / length('interval ''30 days''') <> 2 then
    raise exception 'run-history prune verification failed: the two ledger windows are not both 30 days';
  end if;

  -- A plpgsql body is not name-resolved when it is created, so a clean apply
  -- would prove nothing about whether it runs. Run it once with a batch of one
  -- row and roll that back, so every statement resolves every name it uses.
  begin
    perform public.prune_operational_run_history(1);
    raise exception using errcode = 'P0001', message = 'run-history prune probe: rolled back on purpose';
  exception when raise_exception then
    if sqlerrm <> 'run-history prune probe: rolled back on purpose' then
      raise;
    end if;
  end;

  -- The money path is untouched.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'run history: pg_cron log keeps 14 days, the two monitor ledgers 30, and every row a health reader picks';
end
$verify$;
