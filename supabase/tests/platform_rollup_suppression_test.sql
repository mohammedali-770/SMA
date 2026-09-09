-- ============================================================================
-- Operations alerts — the platform rollup must not duplicate the subsystem that
-- caused it, and must not go silent when that subsystem is muted
-- (migration 20260914120000_platform_rollup_suppression).
--
-- WHY THIS EXISTS. `overall_state` is derived from five subsystems, so a single
-- failing subsystem opened TWO critical alerts on the same tick — measured live
-- on 2026-09-09, two incidents, four critical opens, identical timestamps. The
-- rollup carried `{"overall_state":"failing"}` and nothing else.
--
-- The cases are weighted toward what must NOT happen, because both failure modes
-- are silent. Suppressing too eagerly loses the ONLY alert about a muted
-- subsystem; suppressing too little restores the duplicate this exists to remove.
--
-- Runs on a disposable local DB with all migrations applied. RAISES on failure.
-- ============================================================================
begin;

create or replace function pg_temp.fps(p_res jsonb)
returns text language sql as $f$
  select coalesce(string_agg(c ->> 'fingerprint', ',' order by c ->> 'fingerprint'), '')
    from jsonb_array_elements(p_res) c;
$f$;

create or replace function pg_temp.has_fp(p_res jsonb, p_fp text)
returns boolean language sql as $f$
  select exists (select 1 from jsonb_array_elements(p_res) c where c ->> 'fingerprint' = p_fp);
$f$;

create or replace function pg_temp.snap(p_overall text, p_systems jsonb)
returns jsonb language sql as $f$
  select jsonb_build_object('overall_state', p_overall, 'systems', p_systems);
$f$;

create or replace function pg_temp.muted(p_id text)
returns jsonb language sql as $f$
  select jsonb_build_object('system_rule_overrides',
    jsonb_build_object(p_id, jsonb_build_object('muted', true)));
$f$;

do $$
declare
  v_res jsonb;
  v_snap jsonb;
begin
  -- ---- 1. THE DUPLICATE. A failing rollup subsystem explains the rollup, so
  -- exactly one critical alert should come out, not two.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','order_flow','state','failing','details',
      jsonb_build_object('orders_in_window',0,'window_minutes',60))));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 1a: the rollup duplicated order_flow (got %)', pg_temp.fps(v_res);
  end if;
  if not pg_temp.has_fp(v_res, 'order_flow:health') then
    raise exception 'case 1b: the subsystem condition was lost (got %)', pg_temp.fps(v_res);
  end if;

  -- ---- 2. THE SAFETY NET, and the case that makes this fix non-trivial. The
  -- same failure with order_flow MUTED emits no subsystem condition, so nothing
  -- explains the rollup and it MUST survive. Suppressing on raw state instead of
  -- on emitted conditions would lose both alerts to one mute.
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, pg_temp.muted('order_flow'));
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 2a: muting order_flow ALSO silenced the platform rollup — the failure would now be reported nowhere';
  end if;
  if pg_temp.has_fp(v_res, 'order_flow:health') then
    raise exception 'case 2b: a muted subsystem still emitted its own condition';
  end if;
  -- The survivor must say what drove it; bare overall_state is at its least
  -- adequate exactly when it is the only thing being said.
  if not exists (select 1 from jsonb_array_elements(v_res) c
                  where c ->> 'fingerprint' = 'platform:health'
                    and c -> 'safe_evidence' ->> 'driver_subsystems' like '%order_flow%') then
    raise exception 'case 2c: the surviving rollup does not name order_flow as its driver';
  end if;

  -- ---- 3. A WARNING MUST NOT SILENCE A CRITICAL. order_integrity `degraded`
  -- emits a warning; that does not explain a critical platform state.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','order_integrity','state','degraded','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 3: a warning-severity subsystem condition suppressed the critical rollup (got %)', pg_temp.fps(v_res);
  end if;

  -- ---- 4. A NON-ROLLUP SUBSYSTEM MUST NOT SILENCE IT EITHER. branch_availability
  -- can emit critical but is deliberately excluded from overall_state, so it
  -- cannot be the thing that explains a failing platform.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','branch_availability','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if not pg_temp.has_fp(v_res, 'branch_availability:health') then
    raise exception 'case 4a: the branch_availability condition was lost';
  end if;
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 4b: branch_availability (not a rollup input) suppressed the platform rollup';
  end if;

  -- ---- 5. configuration_error takes the same path as failing.
  v_snap := pg_temp.snap('configuration_error', jsonb_build_array(
    jsonb_build_object('id','account_deletion','state','configuration_error','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 5: a configuration_error rollup duplicated its subsystem (got %)', pg_temp.fps(v_res);
  end if;

  -- ---- 6. THE PLATFORM MUTE STILL WINS on its own terms.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','branch_availability','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, pg_temp.muted('platform'));
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 6: platform muted, but the rollup was emitted anyway';
  end if;

  -- ---- 7. A HEALTHY PLATFORM EMITS NO ROLLUP, with or without the new path.
  v_snap := pg_temp.snap('healthy', jsonb_build_array(
    jsonb_build_object('id','order_flow','state','healthy','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 7: a healthy platform emitted a rollup condition';
  end if;

  -- ---- 8. MULTIPLE FAILING ROLLUP SUBSYSTEMS still suppress, and all their own
  -- conditions survive — the responder gets N specific alerts, not N+1.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','order_flow','state','failing','details','{}'::jsonb),
    jsonb_build_object('id','account_deletion','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 8a: the rollup fired alongside two explaining subsystems';
  end if;
  if not (pg_temp.has_fp(v_res, 'order_flow:health')
          and pg_temp.has_fp(v_res, 'account_deletion:health')) then
    raise exception 'case 8b: a subsystem condition was lost when two failed together (got %)', pg_temp.fps(v_res);
  end if;

  -- ---- 9. ORDERING. The rollup led the array before this change; when it
  -- survives it must still lead, so nothing downstream sees a reshuffle.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','branch_availability','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if v_res -> 0 ->> 'fingerprint' <> 'platform:health' then
    raise exception 'case 9: the surviving rollup is no longer first in the array (got %)', v_res -> 0 ->> 'fingerprint';
  end if;

  raise notice 'platform_rollup_suppression: all cases passed';
end $$;

rollback;
