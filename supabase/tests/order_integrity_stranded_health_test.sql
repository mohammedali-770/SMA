-- ============================================================================
-- Order-integrity health must fail on genuinely stranded POS orders.
-- ============================================================================
begin;

insert into public.branches (id, name_en, name_ar, is_active)
values ('b0000000-0000-0000-0000-0000000010ff', 'Stranded Health Test', 'اختبار الطلبات العالقة', true)
on conflict (id) do nothing;

do $$
declare v_run bigint; v_status text;
begin
  v_run := public.order_integrity_watchdog();
  select status into v_status from public.order_integrity_runs where id = v_run;
  if v_status <> 'success' then
    raise exception 'SETUP FAILED: watchdog run %, expected success', coalesce(v_status, '(missing)');
  end if;
end $$;

set local session_replication_role = replica;

insert into public.orders (
  id, order_number, branch_id, order_type, subtotal, total,
  status, payment_status, lazywait_sync_state, sync_blocked_reason,
  created_at, updated_at
) values (
  '10000000-0000-0000-0000-000000000001', 'HEALTH-DELIVERY-SAFETY',
  'b0000000-0000-0000-0000-0000000010ff', 'delivery', 10, 10,
  'received', 'pending', 'blocked', 'delivery_schema_unconfirmed',
  now() - interval '2 hours', now() - interval '2 hours'
);

do $$
declare v jsonb;
begin
  v := public.order_integrity_health_summary();
  if coalesce((v->>'stranded_order_count')::integer, -1) <> 0 then
    raise exception 'CASE 1 FAILED: deliberate delivery safety block counted as stranded: %', v;
  end if;
end $$;

insert into public.orders (
  id, order_number, branch_id, order_type, subtotal, total,
  status, payment_status, lazywait_sync_state, sync_blocked_reason,
  created_at, updated_at
) values (
  '10000000-0000-0000-0000-000000000002', 'HEALTH-MISSING-MAP',
  'b0000000-0000-0000-0000-0000000010ff', 'pickup', 20, 20,
  'received', 'pending', 'blocked', 'missing_branch_mapping',
  now() - interval '3 hours', now() - interval '3 hours'
);

do $$
declare v jsonb; h jsonb; a jsonb;
begin
  v := public.order_integrity_health_summary();
  if v->>'overall_state' <> 'failing' then
    raise exception 'CASE 2 FAILED: missing mapping did not fail integrity health: %', v;
  end if;
  if (v->>'stranded_order_count')::integer <> 1
     or (v->>'stranded_missing_mapping_count')::integer <> 1 then
    raise exception 'CASE 2 FAILED: stranded aggregates incorrect: %', v;
  end if;

  h := public.operations_health_snapshot_internal();
  if h->>'overall_state' <> 'failing' then
    raise exception 'CASE 2 FAILED: top-level Operations Health remained %', h->>'overall_state';
  end if;
  select value into a
    from jsonb_array_elements(h->'attention')
   where value->>'code' = 'ORDER_INTEGRITY_FAILING'
   limit 1;
  if a is null or a->>'severity' <> 'critical' then
    raise exception 'CASE 2 FAILED: critical ORDER_INTEGRITY_FAILING attention missing: %', h->'attention';
  end if;
end $$;

delete from public.orders where id = '10000000-0000-0000-0000-000000000002';
insert into public.orders (
  id, order_number, branch_id, order_type, subtotal, total,
  status, payment_status, lazywait_sync_state, sync_blocked_reason,
  created_at, updated_at
) values
(
  '10000000-0000-0000-0000-000000000003', 'HEALTH-DEAD-LETTER',
  'b0000000-0000-0000-0000-0000000010ff', 'pickup', 30, 30,
  'received', 'pending', 'dead_letter', null,
  now() - interval '4 hours', now() - interval '4 hours'
),
(
  '10000000-0000-0000-0000-000000000004', 'HEALTH-CANCELLED-DEAD',
  'b0000000-0000-0000-0000-0000000010ff', 'pickup', 40, 40,
  'cancelled', 'pending', 'dead_letter', null,
  now() - interval '5 hours', now() - interval '5 hours'
);

do $$
declare v jsonb;
begin
  v := public.order_integrity_health_summary();
  if (v->>'stranded_order_count')::integer <> 1
     or (v->>'stranded_dead_letter_count')::integer <> 1 then
    raise exception 'CASE 3 FAILED: dead-letter/cancelled filtering incorrect: %', v;
  end if;
  if (v->>'oldest_stranded_order_at')::timestamptz > now() - interval '3 hours 50 minutes' then
    raise exception 'CASE 3 FAILED: oldest stranded timestamp missing/wrong: %', v->>'oldest_stranded_order_at';
  end if;
end $$;

do $$
declare
  v_snapshot jsonb;
  v_derived jsonb;
  v_incident jsonb;
  v_stranded_alert jsonb;
begin
  v_snapshot := jsonb_build_object(
    'overall_state', 'failing',
    'systems', jsonb_build_array(jsonb_build_object(
      'id', 'order_integrity',
      'critical', true,
      'state', 'failing',
      'source', 'order_integrity_health_summary',
      'details', jsonb_build_object(
        'open_critical_count', 0,
        'open_warning_count', 1,
        'stranded_order_count', 1,
        'stranded_missing_mapping_count', 1,
        'stranded_dead_letter_count', 0,
        'oldest_stranded_order_at', now() - interval '3 hours'))),
    'jobs', '[]'::jsonb
  );

  v_derived := public.operations_alerts_derive(v_snapshot, '{}'::jsonb);

  select value into v_incident
    from jsonb_array_elements(v_derived)
   where value->>'fingerprint' = 'order_integrity:incidents'
   limit 1;
  select value into v_stranded_alert
    from jsonb_array_elements(v_derived)
   where value->>'fingerprint' = 'order_integrity:stranded_orders'
   limit 1;

  if v_incident is null or v_incident->>'severity' <> 'warning' then
    raise exception 'CASE 4 FAILED: warning incident condition missing/wrong: %', v_derived;
  end if;
  if v_stranded_alert is null or v_stranded_alert->>'severity' <> 'critical' then
    raise exception 'CASE 4 FAILED: critical stranded condition was masked: %', v_derived;
  end if;
end $$;

rollback;
