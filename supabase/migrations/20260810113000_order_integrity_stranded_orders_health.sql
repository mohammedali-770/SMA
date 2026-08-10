-- ============================================================================
-- Spicy Meal — fail Operations Health on genuinely stranded POS orders
--
-- Production evidence on 2026-08-10 showed the Health Center reporting healthy
-- while non-cancelled cash orders had been stuck for weeks in
-- lazywait_sync_state='blocked' because their branch had no Lazywait mapping.
-- The existing watchdog's paid-order rules intentionally do not catch this cash
-- path, so transport/cron health could be green while a real kitchen ticket was
-- permanently unable to sync.
--
-- This is OBSERVABILITY ONLY. It does not retry, requeue, edit, cancel, charge,
-- refund or otherwise mutate an order. The deliberately frozen delivery schema
-- gate (`delivery_schema_unconfirmed`) remains excluded: that block is an explicit
-- product safety decision, not evidence that automation unexpectedly failed.
-- ============================================================================

create or replace function public.order_integrity_health_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cron_active   boolean := false;
  v_latest_at     timestamptz;
  v_latest_status text;
  v_dec_status    text;
  v_dec_code      text;
  v_success_at    timestamptz;
  v_open_crit     integer := 0;
  v_open_warn     integer := 0;
  v_ack           integer := 0;
  v_supp          integer := 0;
  v_oldest_crit   timestamptz;
  v_latest_inc    jsonb;
  v_opened_24h    integer := 0;
  v_resolved_24h  integer := 0;
  v_success_recent boolean;

  -- Non-cancelled orders in a terminal/non-retrying POS-sync state. Intentional
  -- delivery-schema blocking is excluded below; everything left requires a
  -- human/configuration action and therefore must make health fail visibly.
  v_stranded      integer := 0;
  v_missing_map   integer := 0;
  v_dead_letter   integer := 0;
  v_oldest_stranded timestamptz;

  v_state         text;
begin
  begin
    select coalesce(bool_and(active), false) into v_cron_active
      from cron.job where jobname = 'order-integrity-watchdog' having count(*) > 0;
    v_cron_active := coalesce(v_cron_active, false);
  exception when undefined_table or insufficient_privilege then
    v_cron_active := false;
  end;

  -- Literal latest run (for the visible latest_run_at / age fields).
  select started_at, status into v_latest_at, v_latest_status
    from public.order_integrity_runs order by started_at desc, id desc limit 1;

  -- Latest DECISIVE run (for state selection): success OR non-benign failure.
  -- running / overlap_skipped are skipped so they cannot mask a config failure.
  select status, safe_error_code into v_dec_status, v_dec_code
    from public.order_integrity_runs
   where status = 'success'
      or (status = 'failed' and coalesce(safe_error_code, '') <> 'overlap_skipped')
   order by started_at desc, id desc limit 1;

  select completed_at into v_success_at
    from public.order_integrity_runs where status='success'
    order by completed_at desc nulls last, id desc limit 1;

  -- UNRESOLVED (open + acknowledged + suppressed) active incidents by severity.
  select count(*) filter (where severity='critical'),
         count(*) filter (where severity='warning')
    into v_open_crit, v_open_warn
    from public.order_integrity_incidents where status <> 'resolved';

  select count(*) into v_ack
    from public.order_integrity_incidents where status='acknowledged';
  select count(*) into v_supp
    from public.order_integrity_incidents
   where status='suppressed' and (suppression_until is null or suppression_until > now());
  select min(first_detected_at) into v_oldest_crit
    from public.order_integrity_incidents
   where status <> 'resolved' and severity='critical';
  select count(*) into v_opened_24h
    from public.order_integrity_incidents
   where created_at >= now() - interval '24 hours';
  select count(*) into v_resolved_24h
    from public.order_integrity_incidents
   where resolved_at is not null and resolved_at >= now() - interval '24 hours';

  select jsonb_build_object(
           'id', id,
           'rule_code', rule_code,
           'severity', severity,
           'status', status,
           'entity_type', entity_type,
           'order_id', order_id,
           'branch_id', branch_id,
           'last_detected_at', last_detected_at,
           'occurrence_count', occurrence_count)
    into v_latest_inc
    from public.order_integrity_incidents
   order by last_detected_at desc, created_at desc
   limit 1;

  -- The state itself is the evidence. A blocked/dead-letter order has no normal
  -- retry path left. Exclude the one intentional safety block explicitly instead
  -- of maintaining an allowlist of failures we happen to know about today.
  select
    count(*)::integer,
    count(*) filter (where sync_blocked_reason = 'missing_branch_mapping')::integer,
    count(*) filter (where lazywait_sync_state = 'dead_letter')::integer,
    min(created_at)
  into v_stranded, v_missing_map, v_dead_letter, v_oldest_stranded
  from public.orders
  where status <> 'cancelled'
    and lazywait_sync_state in ('blocked', 'dead_letter')
    and sync_blocked_reason is distinct from 'delivery_schema_unconfirmed';

  v_success_recent := v_success_at is not null
                      and now() - v_success_at <= interval '4 minutes';

  v_state := case
    when v_dec_status = 'failed'      -- latest decisive run is a non-benign failure
      then 'configuration_error'
    when (not v_cron_active)
      or v_success_at is null
      or now() - v_success_at > interval '6 minutes'
      or v_open_crit > 0
      or v_stranded > 0
      then 'failing'
    when v_open_warn > 0 or not v_success_recent
      then 'degraded'
    else 'healthy'
  end;

  return jsonb_build_object(
    'generated_at',                now(),
    'overall_state',               v_state,
    'watchdog_cron_active',        v_cron_active,
    'latest_run_at',               v_latest_at,
    'latest_successful_run_at',    v_success_at,
    'latest_run_age_seconds',      case when v_latest_at is null then null
                                        else floor(extract(epoch from (now() - v_latest_at)))::bigint end,
    'open_critical_count',         v_open_crit,
    'open_warning_count',          v_open_warn,
    'acknowledged_count',          v_ack,
    'suppressed_count',            v_supp,
    'oldest_open_critical_at',     v_oldest_crit,
    'latest_incident',             v_latest_inc,
    'incidents_opened_last_24h',   v_opened_24h,
    'incidents_resolved_last_24h', v_resolved_24h,

    -- Safe aggregate-only evidence for the Health Center / alerts engine. No
    -- customer name, phone, address, note, provider payload or secret is exposed.
    'stranded_order_count',        v_stranded,
    'stranded_missing_mapping_count', v_missing_map,
    'stranded_dead_letter_count',  v_dead_letter,
    'oldest_stranded_order_at',    v_oldest_stranded
  );
end $$;

revoke all on function public.order_integrity_health_summary()
  from public, anon, authenticated;
grant execute on function public.order_integrity_health_summary() to service_role;

comment on function public.order_integrity_health_summary() is
  'Service-role-only aggregate health for the order-integrity watchdog. In addition to watchdog run/incidents state, any non-cancelled blocked/dead-letter Lazywait order is now a failing condition unless its block reason is the deliberate delivery_schema_unconfirmed safety gate. Returns aggregate stranded counts/oldest timestamp only; no customer PII, secrets or raw provider payloads (20260810113000).';
