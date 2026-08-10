-- ============================================================================
-- Spicy Meal — stranded-order alert independence + bounded health-scan cost.
--
-- 20260810113000 makes order-integrity HEALTH fail when a non-cancelled order is
-- stranded in blocked/dead_letter (excluding the deliberate delivery-schema
-- safety gate). Two follow-ups are required:
--   1. Smart Operations Alerts must surface that critical condition even when a
--      separate WARNING watchdog incident is already open; the prior derive
--      function used if/elsif and would otherwise emit only the warning incident.
--   2. The recurring health snapshot must scan a small partial index rather than
--      the entire historical orders table as order volume grows.
--
-- Observability only. No order, payment, retry, refund or provider state changes.
-- ============================================================================

create index if not exists orders_stranded_sync_health_idx
  on public.orders (created_at)
  include (lazywait_sync_state, sync_blocked_reason)
  where status <> 'cancelled'
    and lazywait_sync_state in ('blocked', 'dead_letter')
    and sync_blocked_reason is distinct from 'delivery_schema_unconfirmed';

do $rename$
begin
  if to_regprocedure('public.operations_alerts_derive_pre_stranded(jsonb,jsonb)') is null then
    alter function public.operations_alerts_derive(jsonb, jsonb)
      rename to operations_alerts_derive_pre_stranded;
  end if;
end
$rename$;

revoke all on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb)
  to service_role;

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
    return v_out;
  end if;

  select e.value into v_sys
    from jsonb_array_elements(p_snapshot -> 'systems') e(value)
   where e.value ->> 'id' = 'order_integrity'
   limit 1;

  if v_sys is null then return v_out; end if;

  if public.operations_alerts_safe_bool(
       case when jsonb_typeof(p_settings -> 'system_rule_overrides') = 'object'
            then p_settings -> 'system_rule_overrides' -> 'order_integrity'
            else '{}'::jsonb end,
       'muted') then
    return v_out;
  end if;

  v_details := case when jsonb_typeof(v_sys -> 'details') = 'object'
                    then v_sys -> 'details' else '{}'::jsonb end;
  v_stranded := public.operations_alerts_safe_int(v_details, 'stranded_order_count');
  if v_stranded <= 0 then return v_out; end if;

  v_missing := public.operations_alerts_safe_int(v_details, 'stranded_missing_mapping_count');
  v_dead := public.operations_alerts_safe_int(v_details, 'stranded_dead_letter_count');
  v_oldest := v_details ->> 'oldest_stranded_order_at';

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

  return v_out;
end;
$$;

revoke all on function public.operations_alerts_derive(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_derive(jsonb, jsonb) to service_role;

comment on function public.operations_alerts_derive(jsonb, jsonb) is
  '20260810113500 wrapper around the prior deterministic alert derivation. Preserves every existing condition, but independently emits critical order_integrity:stranded_orders whenever the health snapshot reports stranded_order_count > 0, so an unrelated warning incident cannot mask the critical queue. Honors the existing order_integrity mute override and carries aggregate-only safe evidence.';
