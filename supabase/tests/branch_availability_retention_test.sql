-- ============================================================================
-- Branch-availability run-ledger retention coverage.
--
-- `branch_availability_runs` gets a row a minute forever, so 20260822090000
-- prunes it to 14 days on every productive tick, matching what
-- 20260720120000:150-159 already does for `lazywait_sync_requests`.
--
-- What is actually worth protecting here is not "old rows go away" — that is
-- the easy half. It is the three ways this could go wrong quietly:
--
--   * deleting a row that is still needed (the current run, or anything the
--     health card reads);
--   * a prune failure taking the SWEEP down with it, which would turn a
--     housekeeping fault into items that never reopen;
--   * the prune silently touching `branch_availability_events`, which is the
--     append-only audit of who closed what — a business record, not a run log.
--
-- Each has a case below. The sweeper runs under pg_cron with no JWT, so these
-- cases clear any claim before sweeping, exactly as the snooze suite does.
-- ============================================================================
begin;

-- Fixture ids (branch 1 = Riyadh, product 3 = Spicy Fries, from supabase/seed.sql)
-- are inlined inside every `do $$ ... $$` block below rather than set with
-- \set. psql does NOT substitute its variables inside a dollar-quoted body, so
-- a `:name` reference there is a syntax error rather than an id. The snooze
-- suite inlines them for the same reason.

select set_config('request.jwt.claim.sub', '', true);

-- 1. A row older than the 14-day window is removed, and the count is reported.
do $$
declare
  v_old bigint;
  v_run bigint;
  r public.branch_availability_runs;
begin
  insert into public.branch_availability_runs (started_at, status, completed_at)
  values (now() - interval '15 days', 'success', now() - interval '15 days')
  returning id into v_old;

  v_run := public.branch_availability_sweep();
  select * into r from public.branch_availability_runs where id = v_run;

  if exists (select 1 from public.branch_availability_runs where id = v_old) then
    raise exception 'RETENTION FAILED: a 15-day-old ledger row survived the sweep';
  end if;
  if r.rows_pruned < 1 then
    raise exception 'RETENTION FAILED: rows_pruned reported %, expected at least 1', r.rows_pruned;
  end if;
  if r.status <> 'success' then
    raise exception 'RETENTION FAILED: the sweep did not succeed alongside the prune (%)', r.status;
  end if;
end $$;

-- 2. A row INSIDE the window survives, and so does the sweep's own row. The
--    boundary is the whole design: prune too eagerly and the health card loses
--    the `latest_success_at` it reads to decide whether restores are working.
do $$
declare
  v_recent bigint;
  v_edge   bigint;
  v_run    bigint;
begin
  insert into public.branch_availability_runs (started_at, status)
  values (now() - interval '13 days 23 hours', 'success')
  returning id into v_edge;

  insert into public.branch_availability_runs (started_at, status)
  values (now() - interval '1 hour', 'success')
  returning id into v_recent;

  v_run := public.branch_availability_sweep();

  if not exists (select 1 from public.branch_availability_runs where id = v_edge) then
    raise exception 'RETENTION TOO EAGER: a row just inside the 14-day window was deleted';
  end if;
  if not exists (select 1 from public.branch_availability_runs where id = v_recent) then
    raise exception 'RETENTION TOO EAGER: a one-hour-old row was deleted';
  end if;
  if not exists (select 1 from public.branch_availability_runs where id = v_run) then
    raise exception 'RETENTION TOO EAGER: the sweep deleted its own run row';
  end if;
end $$;

-- 3. The prune does NOT disturb the work. An expired snooze in the same tick
--    still reopens, and its counter is still right — retention must be
--    invisible to everything the sweeper actually exists to do.
do $$
declare
  v_run bigint;
  r public.branch_availability_runs;
begin
  insert into public.branch_availability_runs (started_at, status)
  values (now() - interval '20 days', 'success');

  insert into public.branch_product_availability (branch_id, product_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', false, now() - interval '1 minute')
  on conflict (branch_id, product_id) do update
    set is_available = false, snoozed_until = now() - interval '1 minute';

  v_run := public.branch_availability_sweep();
  select * into r from public.branch_availability_runs where id = v_run;

  if r.products_reopened <> 1 then
    raise exception 'RETENTION INTERFERED: products_reopened was %, expected 1', r.products_reopened;
  end if;
  if r.rows_pruned < 1 then
    raise exception 'RETENTION INTERFERED: the prune did not run alongside the reopen';
  end if;
  if (select is_available from public.branch_product_availability
       where branch_id = 'b0000000-0000-0000-0000-000000000001' and product_id = 'a0000000-0000-0000-0000-000000000003') is not true then
    raise exception 'RETENTION INTERFERED: the expired snooze was not reopened';
  end if;
end $$;

-- 4. The AUDIT table is never touched. branch_availability_events records who
--    closed what and when; it is a business record with its own undecided
--    retention question, and pruning the run log must not quietly take it too.
do $$
declare
  v_before bigint;
  v_after  bigint;
begin
  insert into public.branch_availability_events
    (branch_id, product_id, action, source, created_at)
  values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'closed', 'manual', now() - interval '400 days');

  select count(*) into v_before from public.branch_availability_events;
  perform public.branch_availability_sweep();
  select count(*) into v_after from public.branch_availability_events;

  if v_after < v_before then
    raise exception 'AUDIT PRUNED: the sweep deleted % audit row(s); it must never touch them',
      v_before - v_after;
  end if;
end $$;

-- Helper for case 5b: a trigger body that always raises, used to force the
-- sweep's work to fail while leaving the retention delete alone.
create function pg_temp.force_sweep_failure() returns trigger language plpgsql as $f$
begin
  raise exception 'forced sweep failure (test fixture)';
end $f$;

-- 5. The guards the snooze suite pins are still present after the re-emission,
--    and the retention window is the intended one. Re-asserted here so this
--    migration cannot be the one that loses them.
do $$
declare v_def text := pg_get_functiondef('public.branch_availability_sweep()'::regprocedure);
begin
  if position('pg_try_advisory_xact_lock' in v_def) = 0 then
    raise exception 'WIRING FAILED: the retention re-emission dropped the overlap guard';
  end if;
  if position('snoozed_until is not null' in v_def) = 0 then
    raise exception 'WIRING FAILED: the retention re-emission dropped the untimed-closure exclusion';
  end if;
  if position('14 days' in v_def) = 0 then
    raise exception 'WIRING FAILED: the retention window is not 14 days';
  end if;
end $$;

-- 5b. THE ONE THAT MATTERS, and it has to be behavioural. The prune must sit
--     OUTSIDE the sweep's exception block: that handler is a savepoint, so a
--     prune inside it is rolled back whenever the sweep fails — and a database
--     whose sweeps are all failing is precisely the one that must keep pruning,
--     or the ledger grows without bound exactly when nobody is watching.
--
--     A text-position assertion cannot see this. Moving the prune to the top of
--     the sweep block still leaves it textually above the reopen work while
--     putting it inside the savepoint, and a first attempt at this case passed
--     against that mutant. So force the sweep to fail and check the prune stuck.
do $$
declare
  v_old bigint;
  v_run bigint;
  r public.branch_availability_runs;
begin
  insert into public.branch_availability_runs (started_at, status)
  values (now() - interval '30 days', 'success')
  returning id into v_old;

  -- Something for the sweep's first UPDATE to touch, so the trigger below fires.
  insert into public.branch_product_availability (branch_id, product_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003',
          false, now() - interval '1 minute')
  on conflict (branch_id, product_id) do update
    set is_available = false, snoozed_until = now() - interval '1 minute';

  create trigger zzz_force_sweep_failure
    before update on public.branch_product_availability
    for each row execute function pg_temp.force_sweep_failure();

  v_run := public.branch_availability_sweep();
  drop trigger zzz_force_sweep_failure on public.branch_product_availability;

  select * into r from public.branch_availability_runs where id = v_run;

  if r.status <> 'failed' then
    raise exception 'SETUP BROKEN: the sweep was expected to fail but reported %', r.status;
  end if;
  if exists (select 1 from public.branch_availability_runs where id = v_old) then
    raise exception
      'PRUNE ROLLED BACK: a failing sweep undid the retention delete, so a permanently failing database would never prune';
  end if;
end $$;

-- 6. The cron job was NOT re-scheduled. 20260820111000 asserted exactly one job
--    with this name, schedule and command; a retention change has no business
--    altering any of them.
do $$
begin
  if (select count(*) from cron.job where jobname = 'branch-availability-sweep') <> 1 then
    raise exception 'JOB CHANGED: branch-availability-sweep is no longer a single job';
  end if;
  if (select count(*) from cron.job
       where jobname = 'branch-availability-sweep'
         and schedule = '* * * * *'
         and btrim(command) = 'select public.branch_availability_sweep();') <> 1 then
    raise exception 'JOB CHANGED: the sweeper schedule or command was altered by the retention migration';
  end if;
end $$;

rollback;
