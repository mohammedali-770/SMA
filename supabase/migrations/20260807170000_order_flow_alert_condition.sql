-- Operations Alerts: give the order-flow card an alertable condition.
--
-- THE GAP THIS CLOSES
-- Migration 20260807150000 added an `order_flow` card to the Operations Health
-- snapshot and put it in the CRITICAL set. But the alert engine derives its own
-- fingerprints from that snapshot independently, and `operations_alerts_derive`
-- had no arm for `order_flow`. The result was a card that could read `failing`
-- in the Operations Health Center and light the sidebar badge while the alerts
-- inbox stayed completely silent.
--
-- That is not a dormant gap. `operations_alerts_derive` is called by
-- `operations_alerts_evaluate` (20260723090000:1614), which the ACTIVE
-- `operations-alerts-evaluator` cron runs every five minutes and which writes
-- rows into `public.operations_alert_state` — the in-dashboard alerts inbox.
-- External dispatch is a separate later stage and remains disabled by design;
-- its being off never made this omission harmless.
--
-- WHAT THIS ADDS
-- One `elsif v_id = 'order_flow'` arm, and nothing else. The function body is
-- the 20260723140000 body VERBATIM plus that arm: produced by programmatic
-- insertion and diffed against the original, which reported a PURE INSERTION —
-- 36 lines added, ZERO removed, one hunk. No pre-existing line changed.
--
--   state         -> condition_code          severity
--   failing       -> flow_stopped            critical
--   degraded      -> flow_below_baseline     warning
--   unavailable   -> unavailable             warning
--   idle, healthy -> nothing at all
--
-- `idle` PRODUCING NOTHING IS THE POINT. It is the card's fail-quiet state — no
-- branch open, or fewer than its minimum comparable weeks of history. On
-- Production today the card reads `idle` with `baseline_samples` 0 against a
-- required 3, so this migration adds no alert to the current inbox. It arms the
-- path for when the baseline is ready.
--
-- ONE FINGERPRINT, `order_flow:health`, across all three alertable states. This
-- function's contract is that a fingerprint is a stable condition IDENTITY, so a
-- shortfall that worsens into a full stop escalates the same alert rather than
-- recovering one identity and opening another. The mute override
-- (`system_rule_overrides.order_flow.muted`) works for free — it is applied by
-- the generic per-card guard at the top of the loop.
--
-- NAMING. Earlier notes in docs/MIGRATIONS.md called this "the `orders:flow`
-- fingerprint". That was shorthand, and it does not match the convention every
-- other fingerprint in this function follows: `<snapshot card id>:<condition>`.
-- The card id is `order_flow`, and `subsystem` on the alert row must equal it so
-- the inbox filter and the mute override agree. Hence `order_flow:health`.
--
-- SAFETY
-- - Additive: one branch in one function. No table, column, policy or grant is
--   altered, and no other subsystem's conditions change.
-- - Evidence is counts and flags only, passed through
--   `operations_alerts_sanitize_evidence`, which keeps scalars and drops objects,
--   arrays and nulls. No order id, customer or branch identity is carried.
-- - Read-only: the function is `stable` and derives from the snapshot it is
--   handed. It never recomputes health.
-- - Idempotent: `create or replace` only.
--
-- NOT APPLIED TO PRODUCTION by this change (CLAUDE.md §5, §8; docs/MIGRATIONS.md).

create or replace function public.operations_alerts_derive(p_snapshot jsonb, p_settings jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
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
  if v_overall in ('failing', 'configuration_error')
     and not public.operations_alerts_safe_bool(v_overrides -> 'platform', 'muted') then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
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

  return v_out;
end;
$$;

revoke all on function public.operations_alerts_derive(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_derive(jsonb, jsonb) to service_role;

comment on function public.operations_alerts_derive(jsonb, jsonb) is
  'Deterministic mapping from the authoritative Operations Health snapshot to alertable conditions. Fingerprints are stable condition identities (classification changes escalate/downgrade the same alert instead of churning open/recover); never recomputes health; machine codes and safe aggregates only. Per-job alert severity follows the job''s critical flag (critical application crons -> critical; optional automation crons -> warning). Since 20260807 an order_flow arm emits order_flow:health — failing as critical (flow_stopped), degraded and unavailable as warning — while idle and healthy emit nothing, so the card''s fail-quiet warm-up never raises an alert.';

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- Re-apply the operations_alerts_derive body from
-- 20260723140000_operations_automation_cron_health.sql:881-1160 (a follow-up
-- migration, never an edit of an applied file). Any open order_flow:health
-- alert then stops being re-derived and is recovered by the evaluator's normal
-- resolution pass on its next run; no manual cleanup is required.
