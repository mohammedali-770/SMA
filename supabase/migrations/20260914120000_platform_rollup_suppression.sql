-- ============================================================================
-- OPERATIONS ALERTS -- stop the platform rollup duplicating the subsystem that
-- caused it, WITHOUT ever silencing a driver nothing else reports
--
-- WHY THIS EXISTS. `platform:health` fires on `overall_state`, which is DERIVED
-- from five subsystems -- lazywait, order_integrity, account_deletion,
-- database_jobs and order_flow (`operations_health_overall_state`, the 5-arg
-- overload added by 20260807150000). So whenever one of those goes `failing`,
-- its own condition AND the rollup open in the same evaluation.
--
-- Measured live 2026-09-09 across the previous seven days: TWO incidents, four
-- critical opens, and in both cases `platform:health` and `order_flow:health`
-- opened and recovered at exactly the same second. The rollup was the LESS
-- useful of the pair -- its entire evidence payload is
-- `{"overall_state": "failing"}`, while the subsystem alert beside it carried
-- `orders_in_window`, `baseline_orders`, `open_branches` and the window. It did
-- not even name which subsystem was at fault.
--
-- ---------------------------------------------------------------------------
-- WHERE THIS LIVES, AND WHY IT IS NOT IN `_pre_stranded`
-- ---------------------------------------------------------------------------
-- The correlation runs in `operations_alerts_derive` -- the PUBLIC entry point
-- the evaluator actually calls -- and not in
-- `operations_alerts_derive_pre_stranded`, because only the wrapper sees the
-- complete condition set.
--
-- Review caught the first version doing it in the wrong place (#354). The
-- wrapper APPENDS `order_integrity:stranded_orders` at CRITICAL after
-- `_pre_stranded` returns. And the `order_integrity` arm inside `_pre_stranded`
-- is an if/ELSIF: when `open_warning_count > 0` it takes the *incidents* branch
-- at **warning** severity and never reaches the critical `health` branch. So for
-- a snapshot with `state=failing`, `open_warning_count>0` and
-- `stranded_order_count>0`, the only condition present at `_pre_stranded` time
-- is a WARNING -- the rollup would have been emitted, and the critical stranded
-- condition appended immediately afterwards, restoring the exact duplication
-- this migration exists to remove.
--
-- Deciding after every condition exists is the only placement that cannot be
-- wrong in that way. `_pre_stranded` is left completely untouched.
--
-- ---------------------------------------------------------------------------
-- THE PREDICATE: EVERY DRIVER MUST BE EXPLAINED, NOT MERELY SOME CRITICAL
-- ---------------------------------------------------------------------------
-- The first version suppressed whenever ANY rollup subsystem emitted a critical
-- condition. Review found the hole (#354), and it is the same blind spot this
-- design exists to avoid, one level deeper:
--
--     lazywait = configuration_error, MUTED
--     order_flow = failing, not muted
--     => overall_state = configuration_error   (config_error outranks failing)
--
-- The muted lazywait emits nothing. order_flow emits a critical -- about
-- `failing`, which is NOT what the platform is reporting. Under "any critical"
-- the rollup is suppressed, and the lazywait configuration error is then
-- reported by NOTHING: not its own condition (muted), not the safety net
-- (suppressed by an unrelated alert).
--
-- So the rule is stated in terms of the subsystems actually DRIVING the rollup:
--
--   drivers   = rollup subsystems whose state EQUALS `overall_state`
--   explained = drivers that emitted a CRITICAL condition
--   suppress  <=>  drivers is non-empty AND every driver is explained
--
-- Each clause is load-bearing:
--
--   * DRIVERS, not any rollup member -- an alert about a different state cannot
--     explain this one. That is the #354 P1 finding.
--   * EVERY driver, not any -- two subsystems in the driving state with one
--     muted would otherwise lose the muted one entirely.
--   * NON-EMPTY -- if no system row matches `overall_state` the rollup is
--     unexplained by construction, so it must fire. Fail loud on the impossible.
--   * CRITICAL -- a warning does not explain a critical platform state.
--
-- A MUTED subsystem emits no condition, so it can never appear in `explained`
-- and the rollup always survives for it. That is the whole point: muting one
-- card must not silence the platform alert about it too.
--
-- ---------------------------------------------------------------------------
-- AND WHEN IT SURVIVES, IT SAYS WHY
-- ---------------------------------------------------------------------------
-- After this change the rollup fires precisely when something is NOT otherwise
-- being reported, so bare `overall_state` is at its least adequate exactly when
-- it is all a responder gets. `driver_subsystems` names the drivers.
--
-- A COMMA-SEPARATED STRING, NOT AN ARRAY, and that is the sanitizer's contract
-- rather than a style choice: `operations_alerts_sanitize_evidence` keeps only
-- strings, numbers and booleans and DROPS objects and arrays by design, so that
-- nothing structured can carry unreviewed content into an alert body. An earlier
-- draft used a jsonb array and it vanished silently -- caught by this file's own
-- verification block. Conform to the sanitizer; do not widen it.
--
-- WHAT THIS DOES NOT CHANGE: the `platform:health` fingerprint (changing it
-- would recover the open alert and open a new identity), its severity, the mute
-- override, any subsystem arm, `_pre_stranded`, the in-app inbox, or
-- `overall_state` itself -- the Operations Health Center still shows the
-- platform red. This changes what is ALERTED, not what is measured.
--
-- No money path. Nothing is sent: `external_dispatch_enabled` is false.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The correlation, as its own function so it is testable in isolation
-- ---------------------------------------------------------------------------
create or replace function public.operations_alerts_apply_rollup_correlation(
  p_snapshot   jsonb,
  p_conditions jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_overall   text;
  v_drivers   text[];
  v_explained text[];
begin
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    return coalesce(p_conditions, '[]'::jsonb);
  end if;

  -- Nothing to correlate unless the rollup is actually present. It may be absent
  -- because the platform is healthy, or because `platform` is muted -- either
  -- way this function has no opinion.
  if not exists (
    select 1 from jsonb_array_elements(p_conditions) c
     where c ->> 'fingerprint' = 'platform:health'
  ) then
    return p_conditions;
  end if;

  if p_snapshot is null
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'systems') is distinct from 'array' then
    return p_conditions;   -- cannot identify drivers; keep the alert
  end if;

  v_overall := p_snapshot ->> 'overall_state';
  if v_overall is null then
    return p_conditions;
  end if;

  -- The subsystems actually driving the rollup: a ROLLUP member whose state is
  -- the state being reported. `operations_health_overall_state` picks
  -- configuration_error over failing over degraded, so matching on the state
  -- itself is what ties the explanation to the right condition.
  select array_agg(distinct s ->> 'id')
    into v_drivers
    from jsonb_array_elements(p_snapshot -> 'systems') s
   where s ->> 'id' in ('lazywait', 'order_integrity', 'account_deletion',
                        'database_jobs', 'order_flow')
     and s ->> 'state' = v_overall;

  if v_drivers is null or cardinality(v_drivers) = 0 then
    return p_conditions;   -- unexplained by construction: fail loud
  end if;

  select coalesce(array_agg(distinct c ->> 'subsystem'), '{}')
    into v_explained
    from jsonb_array_elements(p_conditions) c
   where c ->> 'severity' = 'critical'
     and c ->> 'subsystem' = any(v_drivers);

  if v_drivers <@ v_explained then
    -- Every driver is already reported at critical by its own condition. Drop
    -- the rollup; it can add nothing.
    return coalesce((
      select jsonb_agg(c order by ord)
        from jsonb_array_elements(p_conditions) with ordinality t(c, ord)
       where c ->> 'fingerprint' <> 'platform:health'
    ), '[]'::jsonb);
  end if;

  -- At least one driver is unreported -- typically because it is muted. The
  -- rollup survives AND gains attribution, since it is now the only thing being
  -- said about that driver.
  return coalesce((
    select jsonb_agg(
             case when c ->> 'fingerprint' = 'platform:health'
                  then c || jsonb_build_object(
                    'safe_evidence',
                    public.operations_alerts_sanitize_evidence(
                      (c -> 'safe_evidence') || jsonb_build_object(
                        'driver_subsystems', array_to_string(v_drivers, ','))))
                  else c end
             order by ord)
      from jsonb_array_elements(p_conditions) with ordinality t(c, ord)
  ), '[]'::jsonb);
end;
$$;

comment on function public.operations_alerts_apply_rollup_correlation(jsonb, jsonb) is
  'Drops platform:health when EVERY subsystem driving overall_state already reports it at critical; otherwise keeps it and adds driver_subsystems attribution. Applied by operations_alerts_derive once the full condition set exists.';

revoke all on function public.operations_alerts_apply_rollup_correlation(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_apply_rollup_correlation(jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. The wrapper, routing EVERY return through the correlation
-- ---------------------------------------------------------------------------
-- All five exits matter, not only the stranded one: the early returns (null
-- snapshot, no order_integrity card, order_integrity muted, no stranded orders)
-- are the ORDINARY paths, and a duplicate emitted on those would be the common
-- case rather than the edge.
create or replace function public.operations_alerts_derive(
  p_snapshot jsonb,
  p_settings jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_out jsonb;
  v_sys jsonb;
  v_details jsonb := '{}'::jsonb;
  v_stranded integer := 0;
  v_missing integer := 0;
  v_dead integer := 0;
  v_oldest text;
begin
  v_out := coalesce(
    public.operations_alerts_derive_pre_stranded(p_snapshot, p_settings),
    '[]'::jsonb
  );

  if p_snapshot is null
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'systems') is distinct from 'array' then
    return public.operations_alerts_apply_rollup_correlation(p_snapshot, v_out);
  end if;

  select e.value into v_sys
    from jsonb_array_elements(p_snapshot -> 'systems') e(value)
   where e.value ->> 'id' = 'order_integrity'
   limit 1;

  if v_sys is null then
    return public.operations_alerts_apply_rollup_correlation(p_snapshot, v_out);
  end if;

  -- Honor the same subsystem mute override as the base derivation.
  if public.operations_alerts_safe_bool(
       case when jsonb_typeof(p_settings -> 'system_rule_overrides') = 'object'
            then p_settings -> 'system_rule_overrides' -> 'order_integrity'
            else '{}'::jsonb end,
       'muted') then
    return public.operations_alerts_apply_rollup_correlation(p_snapshot, v_out);
  end if;

  v_details := case when jsonb_typeof(v_sys -> 'details') = 'object'
                    then v_sys -> 'details' else '{}'::jsonb end;
  v_stranded := public.operations_alerts_safe_int(v_details, 'stranded_order_count');
  if v_stranded <= 0 then
    return public.operations_alerts_apply_rollup_correlation(p_snapshot, v_out);
  end if;

  v_missing := public.operations_alerts_safe_int(v_details, 'stranded_missing_mapping_count');
  v_dead := public.operations_alerts_safe_int(v_details, 'stranded_dead_letter_count');
  v_oldest := v_details ->> 'oldest_stranded_order_at';

  -- When no watchdog incident exists, the older implementation emits a generic
  -- order_integrity:health alert for the failing state. Replace that generic
  -- fingerprint with the precise stranded-order condition. When warning/critical
  -- incidents DO exist, retain them and append this independent condition so a
  -- warning can never mask a critical stranded queue.
  select coalesce(jsonb_agg(e.value), '[]'::jsonb)
    into v_out
    from jsonb_array_elements(v_out) e(value)
   where e.value ->> 'fingerprint' <> 'order_integrity:health';

  v_out := v_out || jsonb_build_array(jsonb_build_object(
    'fingerprint', 'order_integrity:stranded_orders',
    'subsystem', 'order_integrity',
    'condition_code', 'stranded_orders',
    'severity', 'critical',
    'safe_evidence', public.operations_alerts_sanitize_evidence(
      jsonb_build_object(
        'state', coalesce(v_sys ->> 'state', 'failing'),
        'stranded_order_count', v_stranded,
        'stranded_missing_mapping_count', v_missing,
        'stranded_dead_letter_count', v_dead,
        'oldest_stranded_order_at', v_oldest))));

  return public.operations_alerts_apply_rollup_correlation(p_snapshot, v_out);
end;
$$;

comment on function public.operations_alerts_derive(jsonb, jsonb) is
  'Public condition derivation: the pre-stranded conditions, plus the stranded-order condition, with platform rollup correlation applied last so the complete set is known before the rollup is judged.';

revoke all on function public.operations_alerts_derive(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_derive(jsonb, jsonb)
  to service_role;

-- ---- Self-verification -------------------------------------------------------
do $verify$
declare
  v_src  text;
  v_acl  text;
  v_res  jsonb;
  v_snap jsonb;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_apply_rollup_correlation';
  if v_src is null then
    raise exception 'rollup correlation verification failed: the helper is missing';
  end if;

  -- EVERY exit of the wrapper must route through the correlation. A single bare
  -- `return v_out` would leave one path emitting the duplicate -- and the early
  -- returns are the ordinary paths, not the edges.
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_derive';
  if v_src like '%return v_out;%' then
    raise exception 'rollup correlation verification failed: operations_alerts_derive still has a return path that bypasses the correlation';
  end if;
  if (length(v_src) - length(replace(v_src, 'operations_alerts_apply_rollup_correlation', '')))
     / length('operations_alerts_apply_rollup_correlation') <> 5 then
    raise exception 'rollup correlation verification failed: expected 5 correlated return paths in operations_alerts_derive';
  end if;

  -- `_pre_stranded` must be UNTOUCHED by this migration: it still emits the
  -- rollup inline, and the correlation is applied above it.
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_derive_pre_stranded';
  if v_src not like '%platform:health%' then
    raise exception 'rollup correlation verification failed: _pre_stranded no longer emits the rollup candidate';
  end if;

  select array_to_string(p.proacl, ' | ') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_apply_rollup_correlation';
  if v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception 'rollup correlation verification failed: the helper is reachable by anon or authenticated';
  end if;

  -- BEHAVIOURAL. A `create or replace` that parses is not a function that works.

  -- (a) The duplicate is gone.
  v_snap := jsonb_build_object('overall_state','failing','systems', jsonb_build_array(
    jsonb_build_object('id','order_flow','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_res) c where c ->> 'fingerprint' = 'platform:health') then
    raise exception 'rollup correlation verification failed: the rollup duplicated its only driver';
  end if;

  -- (b) THE #354 P1 CASE. A muted higher-precedence driver must NOT be silenced
  -- by an unrelated critical from a different rollup subsystem.
  v_snap := jsonb_build_object('overall_state','configuration_error','systems', jsonb_build_array(
    jsonb_build_object('id','lazywait','state','configuration_error','details','{}'::jsonb),
    jsonb_build_object('id','order_flow','state','failing','details','{}'::jsonb)));
  v_res := public.operations_alerts_derive(
    v_snap, jsonb_build_object('system_rule_overrides',
      jsonb_build_object('lazywait', jsonb_build_object('muted', true))));
  if not exists (select 1 from jsonb_array_elements(v_res) c where c ->> 'fingerprint' = 'platform:health') then
    raise exception 'rollup correlation verification failed: a muted configuration_error driver was silenced by an unrelated order_flow critical -- reported by nothing at all';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_res) c
                  where c ->> 'fingerprint' = 'platform:health'
                    and c -> 'safe_evidence' ->> 'driver_subsystems' like '%lazywait%') then
    raise exception 'rollup correlation verification failed: the surviving rollup does not name lazywait as its driver';
  end if;

  -- (c) THE #354 P2 CASE. The stranded condition is appended by the wrapper
  -- AFTER _pre_stranded returns, and with open_warning_count > 0 the
  -- order_integrity arm emits only a WARNING at that point. The rollup must
  -- still be suppressed, because the critical exists in the final set.
  v_snap := jsonb_build_object('overall_state','failing','systems', jsonb_build_array(
    jsonb_build_object('id','order_integrity','state','failing','details',
      jsonb_build_object('open_warning_count',1,'open_critical_count',0,
                         'stranded_order_count',3))));
  v_res := public.operations_alerts_derive(v_snap, '{}'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_res) c
                  where c ->> 'fingerprint' = 'order_integrity:stranded_orders') then
    raise exception 'rollup correlation verification failed: the stranded-order condition was lost';
  end if;
  if exists (select 1 from jsonb_array_elements(v_res) c where c ->> 'fingerprint' = 'platform:health') then
    raise exception 'rollup correlation verification failed: the rollup survived alongside a wrapper-added critical that already explains it';
  end if;
end $verify$;
