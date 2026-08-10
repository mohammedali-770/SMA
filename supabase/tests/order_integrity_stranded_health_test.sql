-- ============================================================================
-- Order-integrity health must fail on genuinely stranded POS orders.
--
-- Regression target: Production reported overall health=healthy while cash
-- orders had been blocked for weeks by missing_branch_mapping. The deliberate
-- delivery_schema_unconfirmed safety block remains excluded.
-- ============================================================================
begin;

insert into public.branches (id, name_en, name_ar, is_active)
values ('b0000000-0000-0000-0000-0000000010ff', 'Stranded Health Test', 'اختبار الطلبات العالقة', true)
on conflict (id) do nothing;

-- Establish a fresh successful watchdog run so state selection is not failing
-- merely because the throwaway database has never executed the cron yet.
do $$
declare v_run bigint; v_status text;
begin
  v_run := public.order_integrity_watchdog();
  select status into v_status from public.order_integrity_runs where id = v_run;
  if v_status <> 'success' then
    raise exception 'SETUP FAILED: watchdog run %, expected success', coalesce(v_status, '(missing)');
  end if;
end $$;

-- These are state-machine fixtures, not orders entering through the application.
-- Suppress enqueue/status triggers so the exact blocked/dead-letter states under
-- test survive insertion, matching the established watchdog-suite fixture style.
set local session_replication_role = replica;

-- Case 1: intentional delivery-schema safety block does NOT count as an outage.
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
  raise notice 'CASE 1 ok: delivery_schema_unconfirmed remains intentionally excluded';
end $$;

-- Case 2: missing branch mapping is terminal/non-retrying and MUST fail health.
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

  -- The Operations Health core dynamically consumes the same function. Prove
  -- the defect is visible at the top-level response the dashboard uses.
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
  raise notice 'CASE 2 ok: missing mapping turns Operations Health red';
end $$;

-- Case 3: a dead-lettered non-cancelled order is also stranded, even without a
-- block-reason string. Cancelled orders never count.
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
  raise notice 'CASE 3 ok: dead-letter counts, cancelled order excluded';
end $$;

rollback;
