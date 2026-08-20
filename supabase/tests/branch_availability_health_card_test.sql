-- ============================================================================
-- The `branch_availability` Operations Health card and its alert condition
-- (migration 20260820160000_branch_availability_health_card).
--
-- WHAT THIS CARD IS FOR, and why it is not the cron entry beside it.
-- `branch_availability_sweep` catches its own exceptions: it writes
-- status='failed' to `branch_availability_runs` and then RETURNS NORMALLY, so
-- pg_cron records the run as `succeeded`. The `database_jobs` card therefore
-- reads the sweeper healthy while every sweep fails. Case C asserts exactly
-- that contrast — if both cards ever go red together, this one has started
-- reading pg_cron by mistake and is no longer worth having.
--
-- Transactional, deterministic, no external provider calls.
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

\set branch  '''b0000000-0000-0000-0000-000000000001'''
\set beef    '''a0000000-0000-0000-0000-000000000001'''
\set mild    '''80000000-0000-0000-0000-000000000001'''

-- ---- helpers ---------------------------------------------------------------
create function pg_temp.bah_card() returns jsonb language sql as $$
  select x from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id' = 'branch_availability';
$$;
create function pg_temp.bah_state() returns text language sql as $$
  select pg_temp.bah_card()->>'state';
$$;
create function pg_temp.bah_detail(p_key text) returns text language sql as $$
  select pg_temp.bah_card()->'details'->>p_key;
$$;
create function pg_temp.bah_overall() returns text language sql as $$
  select public.operations_health_summary()->>'overall_state';
$$;
create function pg_temp.bah_dbjobs_state() returns text language sql as $$
  select x->>'state' from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id' = 'database_jobs';
$$;
create function pg_temp.bah_sweep_job_state() returns text language sql as $$
  select j->>'state' from jsonb_array_elements(public.operations_health_summary()->'jobs') j
  where j->>'job_name' = 'branch-availability-sweep';
$$;
-- The alert the engine would raise for this card, as a whole condition object.
create function pg_temp.bah_cond(p_settings jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select c from jsonb_array_elements(
    public.operations_alerts_derive(public.operations_health_summary(), p_settings)) c
  where c->>'fingerprint' = 'branch_availability:health';
$$;
-- Park every OTHER cron healthy so nothing else moves database_jobs.
create function pg_temp.bah_crons_healthy() returns void language sql as $$
  update cron.job set active = true;
  delete from cron.job_run_details;
  insert into cron.job_run_details (jobid, status, start_time, end_time)
  select jobid, 'succeeded', now() - interval '70 seconds', now() - interval '60 seconds'
  from cron.job;
$$;
-- Reset every availability axis to "nothing closed".
create function pg_temp.bah_reset() returns void language sql as $$
  delete from public.branch_product_availability;
  delete from public.branch_modifier_availability;
  delete from public.branch_delivery_areas;
  delete from public.branch_availability_runs;
  update public.branches
     set delivery_temporarily_closed = false, delivery_closed_until = null;
$$;
create function pg_temp.bah_close_product(p_due timestamptz) returns void language sql as $$
  insert into public.branch_product_availability
    (branch_id, product_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
          false, p_due)
  on conflict (branch_id, product_id) do update
    set is_available = false, snoozed_until = excluded.snoozed_until;
$$;

-- ---------------------------------------------------------------------------
-- A. IDLE: nothing closed, no sweep recorded. The fail-quiet warm-up.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.bah_crons_healthy();
  perform pg_temp.bah_reset();

  if pg_temp.bah_state() <> 'idle' then
    raise exception 'a fresh database with nothing closed must be idle, got %', pg_temp.bah_state();
  end if;
  -- Alerting during warm-up is what teaches people to ignore an alert.
  if pg_temp.bah_cond() is not null then
    raise exception 'idle must derive NO condition, got %', pg_temp.bah_cond();
  end if;

  -- One successful sweep and still nothing closed is healthy, not idle: the
  -- mechanism has proven itself.
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '30 seconds');
  if pg_temp.bah_state() <> 'healthy' then
    raise exception 'a swept, all-open branch must be healthy, got %', pg_temp.bah_state();
  end if;
  if pg_temp.bah_cond() is not null then
    raise exception 'healthy must derive NO condition, got %', pg_temp.bah_cond();
  end if;

  raise notice 'IDLE / HEALTHY OK';
end $$;

-- ---------------------------------------------------------------------------
-- B. THE ESCALATION. One fingerprint, severity following the backlog's age.
-- ---------------------------------------------------------------------------
do $$
declare c jsonb;
begin
  perform pg_temp.bah_crons_healthy();
  perform pg_temp.bah_reset();
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '30 seconds');

  -- Inside the grace window: a single missed tick is not a backlog.
  perform pg_temp.bah_close_product(now() - interval '2 minutes');
  if pg_temp.bah_state() <> 'healthy' then
    raise exception 'a 2-minute-late restore is within grace and must be healthy, got %',
      pg_temp.bah_state();
  end if;

  -- Past the grace window: late.
  perform pg_temp.bah_close_product(now() - interval '6 minutes');
  if pg_temp.bah_state() <> 'degraded' then
    raise exception '6 minutes overdue must be degraded, got %', pg_temp.bah_state();
  end if;
  c := pg_temp.bah_cond();
  if c is null or c->>'condition_code' <> 'restores_overdue' or c->>'severity' <> 'warning' then
    raise exception 'expected a WARNING restores_overdue condition, got %', c;
  end if;
  if (pg_temp.bah_detail('overdue_restores'))::int <> 1 then
    raise exception 'overdue_restores wrong: %', pg_temp.bah_detail('overdue_restores');
  end if;

  -- Still only late well past the grace window. This pins the escalation
  -- boundary FROM BELOW: without it, narrowing the stalled threshold to the
  -- grace window would pass unnoticed and every late restore would page.
  perform pg_temp.bah_close_product(now() - interval '20 minutes');
  if pg_temp.bah_state() <> 'degraded' then
    raise exception '20 minutes overdue is late, not stalled; expected degraded, got %',
      pg_temp.bah_state();
  end if;

  -- Plainly stopped: the SAME fingerprint escalates rather than recovering one
  -- identity and opening another. That is this function's whole contract.
  perform pg_temp.bah_close_product(now() - interval '31 minutes');
  if pg_temp.bah_state() <> 'failing' then
    raise exception '31 minutes overdue must be failing, got %', pg_temp.bah_state();
  end if;
  c := pg_temp.bah_cond();
  if c is null or c->>'condition_code' <> 'restores_stalled' or c->>'severity' <> 'critical' then
    raise exception 'expected a CRITICAL restores_stalled condition, got %', c;
  end if;
  if c->>'fingerprint' <> 'branch_availability:health' then
    raise exception 'escalation must reuse ONE fingerprint, got %', c->>'fingerprint';
  end if;

  raise notice 'ESCALATION ON ONE FINGERPRINT OK';
end $$;

-- ---------------------------------------------------------------------------
-- C. THE REASON THIS CARD EXISTS.
--    The sweeper swallows its own errors and returns normally, so pg_cron
--    reports `succeeded`. Only the ledger can see a sweep that runs and fails.
-- ---------------------------------------------------------------------------
do $$
declare c jsonb;
begin
  perform pg_temp.bah_crons_healthy();   -- pg_cron says every run succeeded
  perform pg_temp.bah_reset();

  insert into public.branch_availability_runs (status, completed_at, safe_error_code)
  values ('success', now() - interval '10 minutes', null),
         ('failed',  now() - interval '30 seconds', '23505');

  if pg_temp.bah_sweep_job_state() <> 'healthy' then
    raise exception 'precondition: pg_cron must still read the sweep job healthy, got %',
      pg_temp.bah_sweep_job_state();
  end if;
  if pg_temp.bah_dbjobs_state() <> 'healthy' then
    raise exception 'precondition: database_jobs must still be healthy, got %',
      pg_temp.bah_dbjobs_state();
  end if;

  -- ...and yet:
  if pg_temp.bah_state() <> 'degraded' then
    raise exception 'a failing ledger run must degrade the card, got %', pg_temp.bah_state();
  end if;
  c := pg_temp.bah_cond();
  if c is null or c->>'condition_code' <> 'sweep_failing' or c->>'severity' <> 'warning' then
    raise exception 'expected a WARNING sweep_failing condition, got %', c;
  end if;

  -- A later success clears it: that success becomes the most recent run.
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '10 seconds');
  if pg_temp.bah_state() <> 'healthy' then
    raise exception 'a later success must clear an older failure, got %', pg_temp.bah_state();
  end if;

  raise notice 'LEDGER SEES WHAT PG_CRON CANNOT OK';
end $$;

-- ---------------------------------------------------------------------------
-- D. An UNTIMED admin closure is a decision, not a fault.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.bah_crons_healthy();
  perform pg_temp.bah_reset();
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '30 seconds');

  perform pg_temp.bah_close_product(null);
  update public.branches set delivery_temporarily_closed = true, delivery_closed_until = null
   where id = 'b0000000-0000-0000-0000-000000000001';

  if pg_temp.bah_state() <> 'healthy' then
    raise exception 'untimed closures must never be overdue, got %', pg_temp.bah_state();
  end if;
  if (pg_temp.bah_detail('overdue_restores'))::int <> 0 then
    raise exception 'an untimed closure was counted as overdue';
  end if;
  -- It is still REPORTED, so the board can say how much is off the menu.
  if (pg_temp.bah_detail('untimed_closures'))::int <> 1 then
    raise exception 'untimed_closures wrong: %', pg_temp.bah_detail('untimed_closures');
  end if;
  if (pg_temp.bah_detail('paused_branches'))::int <> 1 then
    raise exception 'paused_branches wrong: %', pg_temp.bah_detail('paused_branches');
  end if;
  if pg_temp.bah_cond() is not null then
    raise exception 'an untimed closure must derive no condition, got %', pg_temp.bah_cond();
  end if;

  raise notice 'UNTIMED CLOSURES ARE NOT FAULTS OK';
end $$;

-- ---------------------------------------------------------------------------
-- E. Every axis is counted, and delivery/area timers are overdue too.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.bah_crons_healthy();
  perform pg_temp.bah_reset();
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '30 seconds');

  perform pg_temp.bah_close_product(now() + interval '20 minutes');
  insert into public.branch_modifier_availability
    (branch_id, modifier_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
          false, now() + interval '20 minutes');
  insert into public.branch_delivery_areas (branch_id, name_ar, is_disabled, disabled_until)
  values ('b0000000-0000-0000-0000-000000000001','النسيم', true, now() + interval '20 minutes');

  if pg_temp.bah_state() <> 'healthy' then
    raise exception 'closures still within their timers must be healthy, got %', pg_temp.bah_state();
  end if;
  if (pg_temp.bah_detail('closed_products'))::int <> 1
     or (pg_temp.bah_detail('closed_options'))::int <> 1
     or (pg_temp.bah_detail('disabled_areas'))::int <> 1 then
    raise exception 'per-axis counts wrong: %', pg_temp.bah_card()->'details';
  end if;

  -- A stranded DELIVERY pause is the worst of the four: the branch silently
  -- drops out of the delivery list and customers are told we cannot reach them.
  update public.branches
     set delivery_temporarily_closed = true, delivery_closed_until = now() - interval '45 minutes'
   where id = 'b0000000-0000-0000-0000-000000000001';
  if pg_temp.bah_state() <> 'failing' then
    raise exception 'a 45-minute stranded delivery pause must be failing, got %', pg_temp.bah_state();
  end if;

  raise notice 'ALL FOUR AXES COUNTED OK';
end $$;

-- ---------------------------------------------------------------------------
-- F. NON-CRITICAL: loud, but it can never turn the platform red.
-- ---------------------------------------------------------------------------
do $$
declare base text;
begin
  perform pg_temp.bah_crons_healthy();
  perform pg_temp.bah_reset();
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '30 seconds');
  base := pg_temp.bah_overall();

  perform pg_temp.bah_close_product(now() - interval '90 minutes');
  if pg_temp.bah_state() <> 'failing' then
    raise exception 'precondition: the card must be failing here';
  end if;
  if (pg_temp.bah_card()->>'critical')::boolean then
    raise exception 'the branch_availability card must be non-critical';
  end if;
  if pg_temp.bah_overall() <> base then
    raise exception 'a failing branch_availability card must not change overall state (% -> %)',
      base, pg_temp.bah_overall();
  end if;
  if exists (select 1 from jsonb_array_elements_text(
               public.operations_health_summary()->'critical_systems') v
             where v = 'branch_availability') then
    raise exception 'branch_availability must not be in critical_systems';
  end if;

  raise notice 'NON-CRITICAL ISOLATION OK';
end $$;

-- ---------------------------------------------------------------------------
-- G. Mute, and the alert engine's other conditions are undisturbed.
-- ---------------------------------------------------------------------------
do $$
declare conds jsonb;
begin
  perform pg_temp.bah_crons_healthy();
  perform pg_temp.bah_reset();
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '30 seconds');
  perform pg_temp.bah_close_product(now() - interval '90 minutes');

  if pg_temp.bah_cond('{"system_rule_overrides":{"branch_availability":{"muted":true}}}'::jsonb)
     is not null then
    raise exception 'the mute override must suppress this condition';
  end if;
  -- Muting one card must not silence the rest.
  conds := public.operations_alerts_derive(
    public.operations_health_summary(),
    '{"system_rule_overrides":{"branch_availability":{"muted":true}}}'::jsonb);
  if jsonb_typeof(conds) <> 'array' then
    raise exception 'derive must still return an array when this card is muted';
  end if;

  raise notice 'MUTE OK';
end $$;

-- ---------------------------------------------------------------------------
-- H. REGRESSION: the arms live in operations_alerts_derive_pre_stranded.
--
-- 20260810113500 renamed the arms function and made operations_alerts_derive a
-- wrapper that appends the independent order_integrity:stranded_orders critical
-- condition. Re-emitting the arms under the WRAPPER's name deletes that alert
-- silently — a critical condition whose entire purpose is that a warning cannot
-- mask it. This was done once while writing 20260820160000; it is asserted here
-- so it cannot be done again.
-- ---------------------------------------------------------------------------
do $$
declare v_snapshot jsonb; v_derived jsonb;
begin
  if to_regprocedure('public.operations_alerts_derive_pre_stranded(jsonb,jsonb)') is null then
    raise exception 'the renamed arms function has disappeared';
  end if;

  v_snapshot := jsonb_build_object(
    'overall_state','failing',
    'systems', jsonb_build_array(jsonb_build_object(
      'id','order_integrity','critical',true,'state','failing',
      'source','order_integrity_health_summary',
      'details', jsonb_build_object(
        'open_critical_count',0,'open_warning_count',1,
        'stranded_order_count',1,'stranded_missing_mapping_count',1,
        'stranded_dead_letter_count',0,
        'oldest_stranded_order_at', now() - interval '3 hours'))),
    'jobs','[]'::jsonb);

  v_derived := public.operations_alerts_derive(v_snapshot, '{}'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_derived) c
                  where c.value->>'fingerprint' = 'order_integrity:stranded_orders') then
    raise exception 'the stranded-order condition was lost: %', v_derived;
  end if;

  raise notice 'STRANDED-ORDER WRAPPER INTACT OK';
end $$;

-- ---------------------------------------------------------------------------
-- I. NO BRANCH IDENTITY. Operations Health is read-only and answers "how much",
--    never "which branch" — that is the call-centre console's job.
-- ---------------------------------------------------------------------------
do $$
declare txt text; conds text;
begin
  perform pg_temp.bah_crons_healthy();
  perform pg_temp.bah_reset();
  insert into public.branch_availability_runs (status, completed_at)
  values ('success', now() - interval '30 seconds');
  perform pg_temp.bah_close_product(now() - interval '90 minutes');
  insert into public.branch_delivery_areas (branch_id, name_ar, name_en, is_disabled)
  values ('b0000000-0000-0000-0000-000000000001','النسيم','Naseem', true);

  txt := public.operations_health_summary()::text;
  conds := public.operations_alerts_derive(
    public.operations_health_summary(), '{}'::jsonb)::text;

  if txt like '%Riyadh%' or txt like '%Olaya%' or txt like '%Naseem%'
     or txt like '%النسيم%' or txt like '%b0000000-0000-0000-0000-000000000001%'
     or txt like '%Spicy Double Beef%' then
    raise exception 'branch, area or product identity leaked into the snapshot';
  end if;
  if conds like '%Riyadh%' or conds like '%Naseem%'
     or conds like '%b0000000-0000-0000-0000-000000000001%' then
    raise exception 'branch identity leaked into the alert evidence';
  end if;

  raise notice 'COUNTS ONLY, NO IDENTITY OK';
end $$;

do $$ begin raise notice 'ALL BRANCH AVAILABILITY HEALTH CARD CASES PASSED'; end $$;
rollback;
