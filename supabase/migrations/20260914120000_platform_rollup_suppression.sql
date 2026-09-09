-- ============================================================================
-- OPERATIONS ALERTS -- stop the platform rollup duplicating the subsystem that
-- caused it
--
-- WHY THIS EXISTS. `platform:health` fires on `overall_state`, and
-- `overall_state` is itself DERIVED from five subsystems -- lazywait,
-- order_integrity, account_deletion, database_jobs and order_flow
-- (`operations_health_overall_state`, the 5-arg overload added by
-- 20260807150000). So whenever one of those five goes `failing`, its own
-- condition AND the rollup open in the same evaluation, on the same tick.
--
-- Measured live on 2026-09-09 across the previous seven days: TWO incidents, and
-- in both `platform:health` and `order_flow:health` opened and recovered at
-- exactly the same second (20:25:00 / 20:35:00 and 20:50:00 / 21:25:00). Four
-- critical opens for two incidents.
--
-- THE ROLLUP WAS THE LESS USEFUL OF THE PAIR, which is what makes this a defect
-- rather than a preference. Its whole evidence payload is:
--
--     {"overall_state": "failing"}
--
-- while the subsystem alert firing beside it carried `orders_in_window: 0`,
-- `baseline_orders: 1`, `open_branches: 1` and `window_minutes: 60`. The second
-- message told a responder nothing the first had not already said, and did not
-- even name which subsystem was at fault. That is how an alert channel earns the
-- habit of being ignored -- the same failure the recovery-pairing fix
-- (20260913120000) addressed from the other direction.
--
-- THE FIX IS SUPPRESSION, NOT DELETION. `platform:health` still exists and still
-- fires; it is withheld only when a rollup subsystem is ALREADY alerting at
-- critical, because only then is it certain to be redundant.
--
-- WHY THE PREDICATE READS THE EMITTED CONDITIONS RATHER THAN THE RAW STATES, and
-- this is the part that would be easy to get dangerously wrong: a MUTED
-- subsystem emits no condition at all (`system_rule_overrides -> <id> -> muted`
-- makes the loop `continue`) while still feeding `overall_state`. Suppressing on
-- raw state would therefore mean that muting one card ALSO silences the platform
-- alert for it -- two alerts lost to one mute, and a failing subsystem with
-- nothing said about it anywhere. Reading the emitted conditions keeps the
-- rollup as the safety net a mute is supposed to leave standing.
--
-- BOTH HALVES OF THE PREDICATE ARE LOAD-BEARING:
--
--   * CRITICAL only -- a `warning` from a rollup subsystem does not explain a
--     critical platform state and must not silence it.
--   * ROLLUP SUBSYSTEMS only -- `branch_availability` and `payment` can each
--     emit critical and are deliberately NOT inputs to `overall_state`
--     (branch_availability's omission is commented at its declaration: a
--     stalled sweeper over-blocks and never over-sells, so it must not be able
--     to turn the platform red). Neither can explain this rollup, so neither may
--     suppress it.
--
-- AND WHEN IT DOES SURVIVE, IT NOW SAYS WHY. After this change the rollup fires
-- precisely in the cases where nothing else is explaining the failure, so bare
-- `overall_state` is at its least adequate exactly when it is all a responder
-- gets. `driver_subsystems` names the rollup members actually in that state,
-- read from the snapshot rather than inferred.
--
-- WHAT THIS DOES NOT CHANGE: the `platform:health` fingerprint (changing it
-- would recover the open alert and open a new identity), the severity, the mute
-- override, any subsystem arm, the in-app inbox, or `overall_state` itself --
-- the Operations Health Center still shows the platform red. This changes what
-- is ALERTED, not what is measured.
--
-- No money path. No customer-facing behaviour. Nothing is sent:
-- `external_dispatch_enabled` is false, and in-app rows are a history a
-- responder reads deliberately rather than a message pushed at them.
-- ============================================================================

create or replace function public.operations_alerts_derive_pre_stranded(
  p_snapshot jsonb,
  p_settings jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  -- The platform rollup is now BUILT here and EMITTED at the end, once the
  -- subsystem conditions are known. See the block after the loop.
  v_platform jsonb := '[]'::jsonb;
  v_rollup_explained boolean;
  v_overall text;
  v_optional_alerts boolean;
  v_overrides jsonb;
  v_sys jsonb;
  v_id text;
  v_state text;
  v_details jsonb;
  v_job jsonb;
  v_jobname text;
  v_jstate text;
  v_code text;
  v_sev text;
  v_crit_ct integer;
  v_warn_ct integer;
  v_manual integer;
  v_due integer;
  v_deliv integer;
  v_events integer;
begin
  if p_snapshot is null
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'systems') is distinct from 'array' then
    return '[]'::jsonb;
  end if;

  v_optional_alerts := public.operations_alerts_safe_bool(p_settings, 'optional_system_alerts_enabled');
  v_overrides := case when jsonb_typeof(p_settings -> 'system_rule_overrides') = 'object'
                      then p_settings -> 'system_rule_overrides' else '{}'::jsonb end;
  v_overall := p_snapshot ->> 'overall_state';

  -- Platform-level condition (spec: overall failing / configuration_error).
  -- BUILT here, EMITTED after the loop -- it is suppressed when a rollup
  -- subsystem is already alerting at critical. See the block before `return`.
  if v_overall in ('failing', 'configuration_error')
     and not public.operations_alerts_safe_bool(v_overrides -> 'platform', 'muted') then
    v_platform := jsonb_build_array(jsonb_build_object(
      'fingerprint', 'platform:health',
      'subsystem', 'platform',
      'condition_code', v_overall,
      'severity', 'critical',
      'safe_evidence', public.operations_alerts_sanitize_evidence(
        jsonb_build_object('overall_state', v_overall))));
  end if;

  for v_sys in select * from jsonb_array_elements(p_snapshot -> 'systems') loop
    v_id := coalesce(v_sys ->> 'id', 'unknown');
    if v_id !~ '^[a-z0-9_]{2,40}$' then
      continue; -- refuse to fingerprint an unexpected subsystem id
    end if;
    if public.operations_alerts_safe_bool(v_overrides -> v_id, 'muted') then
      continue;
    end if;
    v_state := coalesce(v_sys ->> 'state', 'unavailable');
    v_details := case when jsonb_typeof(v_sys -> 'details') = 'object'
                      then v_sys -> 'details' else '{}'::jsonb end;

    if v_id = 'lazywait' then
      v_code := case v_state
        when 'failing' then 'sync_failing'
        when 'configuration_error' then 'configuration_error'
        when 'degraded' then 'sync_degraded'
        when 'unavailable' then 'unavailable'
        else null end;
      if v_code is not null then
        v_sev := case when v_state in ('failing', 'configuration_error')
                      then 'critical' else 'warning' end;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'lazywait:sync_health',
          'subsystem', 'lazywait', 'condition_code', v_code, 'severity', v_sev,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

    elsif v_id = 'order_integrity' then
      v_crit_ct := public.operations_alerts_safe_int(v_details, 'open_critical_count');
      v_warn_ct := public.operations_alerts_safe_int(v_details, 'open_warning_count');
      if v_crit_ct > 0 or v_warn_ct > 0 then
        -- Correlated: all unresolved incident evidence groups under ONE alert
        -- whose severity follows the worst open incident.
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'order_integrity:incidents',
          'subsystem', 'order_integrity',
          'condition_code', case when v_crit_ct > 0
                                 then 'critical_incidents' else 'warning_incidents' end,
          'severity', case when v_crit_ct > 0 then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('open_critical_count', v_crit_ct,
              'open_warning_count', v_warn_ct, 'state', v_state))));
      elsif v_state in ('failing', 'configuration_error', 'degraded', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'order_integrity:health',
          'subsystem', 'order_integrity', 'condition_code', v_state,
          'severity', case when v_state in ('failing', 'configuration_error')
                           then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

    elsif v_id = 'account_deletion' then
      v_manual := public.operations_alerts_safe_int(v_details, 'manual_review_count');
      v_due := public.operations_alerts_safe_int(v_details, 'due_count');
      if v_state in ('failing', 'configuration_error') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:health',
          'subsystem', 'account_deletion', 'condition_code', v_state,
          'severity', 'critical',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state, 'due_count', v_due,
              'manual_review_count', v_manual))));
      elsif v_state = 'degraded' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:health',
          'subsystem', 'account_deletion',
          'condition_code', case when v_due > 0 then 'due_backlog' else 'degraded' end,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state, 'due_count', v_due,
              'oldest_due_at', v_details ->> 'oldest_due_at'))));
      elsif v_state = 'unavailable' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:health',
          'subsystem', 'account_deletion', 'condition_code', 'unavailable',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;
      -- Manual-review backlog is a DISTINCT ongoing condition with its own
      -- identity (it can persist while the processor itself is healthy).
      if v_manual > 0 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:manual_review_backlog',
          'subsystem', 'account_deletion', 'condition_code', 'manual_review_backlog',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('manual_review_count', v_manual))));
      end if;

    elsif v_id = 'database_jobs' then
      if v_state = 'unavailable' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'database_jobs:unavailable',
          'subsystem', 'database_jobs', 'condition_code', 'unavailable',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;
      -- per-job conditions are derived from the jobs[] array below

    elsif v_id = 'order_flow' then
      -- Added 20260807. The order-flow card (migration 20260807150000) watches
      -- the business OUTCOME rather than a subsystem, so it is the one card that
      -- can be red while every other card is green. Until this arm existed it had
      -- no fingerprint here at all: the card would read `failing` in the
      -- Operations Health Center and on the sidebar badge while the alerts inbox
      -- stayed completely silent. That is the gap this closes.
      --
      -- `idle` and `healthy` deliberately produce NOTHING. `idle` is the card's
      -- fail-quiet state — no branch open, or fewer than its minimum comparable
      -- weeks of history — and alerting on it would defeat the whole design and
      -- teach people to ignore the alert during its own warm-up.
      --
      -- ONE fingerprint across all three alertable states, matching the
      -- convention documented on this function: a shortfall that worsens into a
      -- full stop ESCALATES the same alert rather than recovering one identity
      -- and opening another.
      if v_state in ('failing', 'degraded', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'order_flow:health',
          'subsystem', 'order_flow',
          'condition_code', case v_state
            when 'failing'  then 'flow_stopped'
            when 'degraded' then 'flow_below_baseline'
            else 'unavailable' end,
          'severity', case when v_state = 'failing' then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'orders_in_window', public.operations_alerts_safe_int(v_details, 'orders_in_window'),
              'baseline_orders', v_details -> 'baseline_orders',
              'baseline_samples', public.operations_alerts_safe_int(v_details, 'baseline_samples'),
              'open_branches', public.operations_alerts_safe_int(v_details, 'open_branches'),
              'window_minutes', public.operations_alerts_safe_int(v_details, 'window_minutes'),
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

    elsif v_id = 'branch_availability' then
      -- Added 20260820. The card watches whether closures actually REOPEN, which
      -- the database_jobs card structurally cannot see: branch_availability_sweep
      -- catches its own exceptions and returns normally, so pg_cron records every
      -- failed sweep as `succeeded`.
      --
      -- `idle` and `healthy` produce NOTHING. `idle` is the card's fail-quiet
      -- warm-up — nothing closed anywhere and no sweep recorded yet.
      --
      -- ONE fingerprint across all three alertable states, per this function's
      -- contract: a backlog that grows from overdue to stalled ESCALATES the same
      -- alert instead of recovering one identity and opening another. Severity
      -- follows it up — warning while restores are merely late, critical once
      -- they have plainly stopped.
      --
      -- Not gated behind `optional_system_alerts_enabled`: that flag is for the
      -- CONFIGURATION states of optional integrations, not for a real failure of
      -- an always-on internal mechanism.
      if v_state in ('failing', 'degraded', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'branch_availability:health',
          'subsystem', 'branch_availability',
          'condition_code', case
            when v_state = 'failing' then 'restores_stalled'
            when v_state = 'unavailable' then 'unavailable'
            when public.operations_alerts_safe_int(v_details, 'overdue_restores') > 0
              then 'restores_overdue'
            else 'sweep_failing' end,
          'severity', case when v_state = 'failing' then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'overdue_restores', public.operations_alerts_safe_int(v_details, 'overdue_restores'),
              'worst_overdue_minutes', public.operations_alerts_safe_int(v_details, 'worst_overdue_minutes'),
              'closed_products', public.operations_alerts_safe_int(v_details, 'closed_products'),
              'closed_options', public.operations_alerts_safe_int(v_details, 'closed_options'),
              'paused_branches', public.operations_alerts_safe_int(v_details, 'paused_branches'),
              'latest_run_status', v_details ->> 'latest_run_status',
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

    elsif v_id = 'payment' then
      if v_state = 'failing' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'payment:health',
          'subsystem', 'payment', 'condition_code', 'integrity_incidents',
          'severity', 'critical',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('integrity_critical_count',
              public.operations_alerts_safe_int(v_details, 'integrity_critical_count')))));
      elsif v_state = 'degraded' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'payment:health',
          'subsystem', 'payment', 'condition_code', 'stale_initiations',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('stale_initiated_24h',
              public.operations_alerts_safe_int(v_details, 'stale_initiated_24h')))));
      end if;
      if v_optional_alerts and v_state in ('disabled', 'not_configured', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'payment:configuration',
          'subsystem', 'payment', 'condition_code', v_state,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state))));
      end if;

    elsif v_id = 'push' then
      v_deliv := public.operations_alerts_safe_int(v_details, 'failed_deliveries_24h');
      v_events := public.operations_alerts_safe_int(v_details, 'failed_send_events_24h');
      if v_state = 'degraded' and v_deliv > 0 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'push:failed_deliveries',
          'subsystem', 'push', 'condition_code', 'failed_deliveries',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('failed_deliveries_24h', v_deliv))));
      end if;
      if v_state = 'degraded' and v_events > 0 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'push:failed_send_events',
          'subsystem', 'push', 'condition_code', 'failed_send_events',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('failed_send_events_24h', v_events))));
      end if;
      if v_optional_alerts and v_state in ('disabled', 'not_configured', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'push:configuration',
          'subsystem', 'push', 'condition_code', v_state,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state))));
      end if;

    elsif v_id in ('email', 'otp') then
      if v_optional_alerts and v_state in ('disabled', 'not_configured', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', v_id || ':configuration',
          'subsystem', v_id, 'condition_code', v_state,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state))));
      end if;
    end if;
  end loop;

  -- Per-job conditions: one stable identity per allowlisted job. The job name
  -- is a safe entity key (strict charset); the classification code follows the
  -- backend-decided state and its safe explanatory fields. Severity follows the
  -- job's own `critical` flag so the non-critical automation crons stay warning-
  -- level (the three critical application jobs remain critical).
  if jsonb_typeof(p_snapshot -> 'jobs') = 'array'
     and not public.operations_alerts_safe_bool(v_overrides -> 'database_jobs', 'muted') then
    for v_job in select * from jsonb_array_elements(p_snapshot -> 'jobs') loop
      v_jobname := coalesce(v_job ->> 'job_name', '');
      if v_jobname !~ '^[a-z0-9-]{1,60}$' then
        continue;
      end if;
      v_jstate := coalesce(v_job ->> 'state', 'unavailable');
      if v_jstate = 'failing' then
        if v_job ->> 'job_id' is null then
          v_code := 'job_missing';
        elsif not public.operations_alerts_safe_bool(v_job, 'active') then
          v_code := 'job_inactive';
        elsif v_job ->> 'latest_terminal_status' is not null
              and v_job ->> 'latest_terminal_status' <> 'succeeded' then
          v_code := 'terminal_failure';
        else
          v_code := 'stale_success';
        end if;
        -- A failing CRITICAL job is critical; a failing non-critical automation
        -- cron is a warning. `critical` is a safe boolean carried on every job.
        v_sev := case when public.operations_alerts_safe_bool(v_job, 'critical')
                      then 'critical' else 'warning' end;
      elsif v_jstate = 'degraded' then
        if v_job ->> 'latest_success_at' is null then
          v_code := 'no_success_yet';
        elsif (v_job ->> 'schedule') is distinct from (v_job ->> 'expected_schedule') then
          v_code := 'schedule_mismatch';
        else
          v_code := 'job_degraded';
        end if;
        v_sev := 'warning';
      else
        continue;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'fingerprint', 'database_jobs:job_health:' || v_jobname,
        'subsystem', 'database_jobs', 'condition_code', v_code, 'severity', v_sev,
        'safe_evidence', public.operations_alerts_sanitize_evidence(jsonb_build_object(
          'job_name', v_jobname, 'state', v_jstate,
          'latest_terminal_status', v_job ->> 'latest_terminal_status',
          'latest_success_at', v_job ->> 'latest_success_at',
          'schedule', v_job ->> 'schedule',
          'expected_schedule', v_job ->> 'expected_schedule'))));
    end loop;
  end if;

  -- ---- PLATFORM ROLLUP: emit only when it is not already explained ----------
  --
  -- `platform:health` fires on `overall_state`, which is itself derived from
  -- FIVE subsystems (lazywait, order_integrity, account_deletion, database_jobs,
  -- order_flow -- `operations_health_overall_state`, 5-arg overload). So when
  -- one of those goes `failing`, BOTH its own condition and this rollup open in
  -- the same evaluation, on the same fingerprint pair, at the same second.
  --
  -- Measured live 2026-09-09 over the previous 7 days: two incidents, and on
  -- both `platform:health` and `order_flow:health` opened and recovered at
  -- exactly the same timestamps. The rollup was strictly the LESS useful of the
  -- two -- its evidence is `{"overall_state": "failing"}` and nothing else,
  -- while the subsystem alert carried `orders_in_window`, `baseline_orders`,
  -- `open_branches` and the window. A responder reading the pair learns nothing
  -- from the second message that the first did not already say, which is how an
  -- alert channel earns the habit of being ignored.
  --
  -- THE SUPPRESSION IS DELIBERATELY NARROW, and each half of the predicate is
  -- load-bearing:
  --
  --   * CRITICAL only. A `warning` from a rollup subsystem does not explain a
  --     critical platform state, so it must not silence it.
  --   * ROLLUP SUBSYSTEMS only. `branch_availability` and `payment` can both
  --     emit critical and are deliberately NOT inputs to `overall_state`, so
  --     neither can explain -- or silence -- this rollup.
  --
  -- WHAT THIS PRESERVES, and it is the reason the check reads the emitted
  -- conditions rather than the raw states: a MUTED subsystem emits nothing. If
  -- an operator mutes `order_flow` and it then fails, no subsystem condition
  -- exists, nothing explains the rollup, and `platform:health` still fires --
  -- which is exactly the safety net a mute is supposed to leave in place.
  -- Suppressing on raw state would have silenced both and made muting one card
  -- blind the platform alert too.
  select exists (
    select 1
      from jsonb_array_elements(v_out) c
     where c ->> 'severity' = 'critical'
       and c ->> 'subsystem' in
           ('lazywait', 'order_integrity', 'account_deletion',
            'database_jobs', 'order_flow')
  ) into v_rollup_explained;

  if jsonb_array_length(v_platform) > 0 and not v_rollup_explained then
    -- Prepended, not appended: the rollup led the array before this change and
    -- keeping that order means nothing downstream sees a reshuffle.
    --
    -- ATTRIBUTION. When this alert does survive it is, by construction, the only
    -- thing being said about the failure -- so it must carry more than
    -- `overall_state`. `driver_subsystems` names the rollup members actually in
    -- that state, read from the snapshot rather than inferred.
    --
    -- A COMMA-SEPARATED STRING, NOT AN ARRAY, and that is the sanitizer's
    -- contract rather than a stylistic choice: `operations_alerts_sanitize_evidence`
    -- keeps only strings, numbers and booleans and drops objects and arrays BY
    -- DESIGN, so that nothing structured can carry unreviewed content into an
    -- alert body. A jsonb array here is silently discarded -- which is exactly
    -- what happened on the first version of this migration, caught by its own
    -- verification block. Conform to the sanitizer; do not widen it.
    v_out := (
      select jsonb_build_array(
        (v_platform -> 0) || jsonb_build_object(
          'safe_evidence',
          public.operations_alerts_sanitize_evidence(
            ((v_platform -> 0) -> 'safe_evidence') || jsonb_build_object(
              'driver_subsystems',
              coalesce((
                select string_agg(s ->> 'id', ',' order by s ->> 'id')
                  from jsonb_array_elements(p_snapshot -> 'systems') s
                 where s ->> 'id' in ('lazywait', 'order_integrity',
                                      'account_deletion', 'database_jobs',
                                      'order_flow')
                   and s ->> 'state' = v_overall
              ), 'none'))))
      )
    ) || v_out;
  end if;

  return v_out;
end;
$$;

comment on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb) is
  'Maps the Operations Health snapshot to alertable conditions. The platform rollup is suppressed when a rollup subsystem (lazywait, order_integrity, account_deletion, database_jobs, order_flow) is already alerting at critical, and carries driver_subsystems attribution when it is not.';

revoke all on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb)
  to service_role;

-- ---- Self-verification -------------------------------------------------------
do $verify$
declare
  v_src text;
  v_acl text;
  v_snap jsonb;
  v_res jsonb;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_derive_pre_stranded';
  if v_src is null then
    raise exception 'platform rollup verification failed: the conditions builder is missing';
  end if;

  -- The guard exists AND is wired into the emit. Asserting only that the flag is
  -- computed would pass on a version that decides and then ignores it -- the
  -- exact shape of the bug 20260913120000 was written to fix.
  if v_src not like '%v_rollup_explained%' then
    raise exception 'platform rollup verification failed: v_rollup_explained absent';
  end if;
  if v_src not like '%not v_rollup_explained%' then
    raise exception 'platform rollup verification failed: v_rollup_explained is computed but never applied to the emit';
  end if;

  -- The narrow half of the predicate. If either literal is lost the suppression
  -- silently widens: without 'critical' a warning would silence the rollup, and
  -- a list that admitted branch_availability or payment would let a subsystem
  -- that cannot drive overall_state suppress the alert about it.
  if v_src not like '%c ->> ''severity'' = ''critical''%' then
    raise exception 'platform rollup verification failed: the suppression is not restricted to critical conditions';
  end if;
  if v_src like '%''branch_availability'', ''payment''%' then
    raise exception 'platform rollup verification failed: a non-rollup subsystem appears in the suppression list';
  end if;

  -- What must NOT have changed.
  if v_src not like '%platform:health%' then
    raise exception 'platform rollup verification failed: the platform:health fingerprint was lost';
  end if;
  if v_src not like '%order_flow:health%' or v_src not like '%branch_availability:health%' then
    raise exception 'platform rollup verification failed: a subsystem arm was lost';
  end if;

  select array_to_string(p.proacl, ' | ') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_derive_pre_stranded';
  if v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception 'platform rollup verification failed: the builder is reachable by anon or authenticated';
  end if;

  -- BEHAVIOURAL, not textual. A `create or replace` that parses is not a
  -- function that works: plpgsql resolves names at first call, so the block
  -- below runs the real thing against a synthetic snapshot.
  --
  -- Case 1: order_flow failing and NOT muted -> the rollup is explained and must
  -- be withheld, leaving exactly the subsystem condition.
  v_snap := jsonb_build_object(
    'overall_state', 'failing',
    'systems', jsonb_build_array(
      jsonb_build_object('id','order_flow','state','failing','details',
        jsonb_build_object('orders_in_window',0,'window_minutes',60))));
  v_res := public.operations_alerts_derive_pre_stranded(v_snap, '{}'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_res) c
              where c ->> 'fingerprint' = 'platform:health') then
    raise exception 'platform rollup verification failed: the rollup was emitted while order_flow was already alerting at critical';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_res) c
                  where c ->> 'fingerprint' = 'order_flow:health') then
    raise exception 'platform rollup verification failed: the subsystem condition was lost';
  end if;

  -- Case 2: THE SAFETY NET. Same failure, but order_flow is MUTED, so it emits
  -- nothing -- the rollup must survive, or muting one card would silence both.
  v_res := public.operations_alerts_derive_pre_stranded(
    v_snap, jsonb_build_object('system_rule_overrides',
      jsonb_build_object('order_flow', jsonb_build_object('muted', true))));
  if not exists (select 1 from jsonb_array_elements(v_res) c
                  where c ->> 'fingerprint' = 'platform:health') then
    raise exception 'platform rollup verification failed: muting a subsystem also silenced the platform rollup -- two alerts lost to one mute';
  end if;
  -- Asserts the VALUE, not merely the key. A key whose value the sanitizer
  -- dropped would still satisfy `?` on a rebuilt object, so this checks that
  -- the driver is actually named -- which is what the first version got wrong.
  if not exists (select 1 from jsonb_array_elements(v_res) c
                  where c ->> 'fingerprint' = 'platform:health'
                    and c -> 'safe_evidence' ->> 'driver_subsystems' like '%order_flow%') then
    raise exception 'platform rollup verification failed: the surviving rollup does not name order_flow as its driver';
  end if;
end $verify$;
