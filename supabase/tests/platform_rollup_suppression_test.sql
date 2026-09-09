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
-- IT CALLS `operations_alerts_derive`, THE PUBLIC ENTRY POINT, not the internal
-- `_pre_stranded` builder -- because the wrapper APPENDS a critical condition
-- (`order_integrity:stranded_orders`) after the builder returns, so the builder
-- alone never sees the complete set. Testing the builder would have passed while
-- the thing the evaluator calls still emitted the duplicate. Review found that
-- on #354; cases 10 and 11 are the two findings.
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
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
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
  v_res := public.operations_alerts_derive(v_snap, pg_temp.muted('order_flow'));
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
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 3: a warning-severity subsystem condition suppressed the critical rollup (got %)', pg_temp.fps(v_res);
  end if;

  -- ---- 4. A NON-ROLLUP SUBSYSTEM MUST NOT SILENCE IT EITHER. branch_availability
  -- can emit critical but is deliberately excluded from overall_state, so it
  -- cannot be the thing that explains a failing platform.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','branch_availability','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if not pg_temp.has_fp(v_res, 'branch_availability:health') then
    raise exception 'case 4a: the branch_availability condition was lost';
  end if;
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 4b: branch_availability (not a rollup input) suppressed the platform rollup';
  end if;

  -- ---- 5. configuration_error takes the same path as failing.
  v_snap := pg_temp.snap('configuration_error', jsonb_build_array(
    jsonb_build_object('id','account_deletion','state','configuration_error','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 5: a configuration_error rollup duplicated its subsystem (got %)', pg_temp.fps(v_res);
  end if;

  -- ---- 6. THE PLATFORM MUTE STILL WINS on its own terms.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','branch_availability','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, pg_temp.muted('platform'));
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 6: platform muted, but the rollup was emitted anyway';
  end if;

  -- ---- 7. A HEALTHY PLATFORM EMITS NO ROLLUP, with or without the new path.
  v_snap := pg_temp.snap('healthy', jsonb_build_array(
    jsonb_build_object('id','order_flow','state','healthy','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 7: a healthy platform emitted a rollup condition';
  end if;

  -- ---- 8. MULTIPLE FAILING ROLLUP SUBSYSTEMS still suppress, and all their own
  -- conditions survive — the responder gets N specific alerts, not N+1.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','order_flow','state','failing','details','{}'::jsonb),
    jsonb_build_object('id','account_deletion','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
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
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if v_res -> 0 ->> 'fingerprint' <> 'platform:health' then
    raise exception 'case 9: the surviving rollup is no longer first in the array (got %)', v_res -> 0 ->> 'fingerprint';
  end if;

  -- ---- 10. THE #354 P1 CASE: an unrelated critical must not silence a MUTED
  -- higher-precedence driver.
  --
  -- `operations_health_overall_state` ranks configuration_error above failing.
  -- So with lazywait=configuration_error (MUTED) and order_flow=failing, the
  -- platform reports CONFIGURATION_ERROR -- driven by lazywait. order_flow's
  -- critical is about a different state and explains nothing.
  --
  -- Under the first version's "any rollup critical suppresses" rule the rollup
  -- was dropped and the lazywait configuration error was reported by NOTHING:
  -- not its own condition (muted), not the safety net (suppressed). That is the
  -- blind spot the whole design exists to avoid, one level deeper.
  v_snap := pg_temp.snap('configuration_error', jsonb_build_array(
    jsonb_build_object('id','lazywait','state','configuration_error','details','{}'::jsonb),
    jsonb_build_object('id','order_flow','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, pg_temp.muted('lazywait'));
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 10a: a muted configuration_error driver was silenced by an unrelated order_flow critical — reported by nothing at all';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_res) c
                  where c ->> 'fingerprint' = 'platform:health'
                    and c -> 'safe_evidence' ->> 'driver_subsystems' like '%lazywait%') then
    raise exception 'case 10b: the surviving rollup does not name lazywait as the driver';
  end if;
  -- The order_flow condition itself must be untouched.
  if not pg_temp.has_fp(v_res, 'order_flow:health') then
    raise exception 'case 10c: the unrelated order_flow condition was lost';
  end if;

  -- 10d. THE SAME SHAPE WITH TWO DRIVERS. Both in the driving state, one muted:
  -- the muted one is unexplained, so the rollup must survive. "Any driver
  -- explained" would wrongly suppress here; "every driver explained" does not.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','order_flow','state','failing','details','{}'::jsonb),
    jsonb_build_object('id','account_deletion','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, pg_temp.muted('account_deletion'));
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 10d: one of two failing drivers was muted and the rollup was suppressed anyway — that driver is now reported nowhere';
  end if;

  -- ---- 11. THE #354 P2 CASE: a critical the WRAPPER adds must count.
  --
  -- With open_warning_count > 0 the order_integrity arm takes the *incidents*
  -- branch at WARNING and never reaches its critical health branch, so at
  -- `_pre_stranded` time the only condition is a warning. The wrapper then
  -- appends `order_integrity:stranded_orders` at CRITICAL. Judging the rollup
  -- before that append restores the exact duplication this suite exists to
  -- prevent -- which is why the correlation runs in the wrapper.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','order_integrity','state','failing','details',
      jsonb_build_object('open_warning_count',1,'open_critical_count',0,
                         'stranded_order_count',3))));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if not pg_temp.has_fp(v_res, 'order_integrity:stranded_orders') then
    raise exception 'case 11a precondition: the wrapper-added critical is absent, so this case proves nothing (got %)', pg_temp.fps(v_res);
  end if;
  if pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 11b: the rollup survived alongside a wrapper-added critical that already explains it (got %)', pg_temp.fps(v_res);
  end if;

  -- 11c. The same subsystem WITHOUT stranded orders keeps only the warning, so
  -- nothing critical explains the rollup and it must fire. This is what makes
  -- 11b a real discrimination rather than a coincidence.
  v_snap := pg_temp.snap('failing', jsonb_build_array(
    jsonb_build_object('id','order_integrity','state','failing','details',
      jsonb_build_object('open_warning_count',1,'open_critical_count',0,
                         'stranded_order_count',0))));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if not pg_temp.has_fp(v_res, 'platform:health') then
    raise exception 'case 11c: only a WARNING explained the rollup and it was suppressed anyway (got %)', pg_temp.fps(v_res);
  end if;

  raise notice 'platform_rollup_suppression: all cases passed';
end $$;

rollback;
