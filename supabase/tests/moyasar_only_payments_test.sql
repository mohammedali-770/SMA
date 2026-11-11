-- ============================================================================
-- Moyasar-only payments (migration 20261003120000_moyasar_only_payments.sql):
-- the refund driver's provider gate, the refund ledger's fallback provider and
-- the staff alert label.
--
-- The loyalty multi-spend guard is covered by moyasar_begin_attempt_test.sql
-- and the payment card by operations_health_center_test.sql.
--
-- Runs against a throwaway Postgres with the FULL migration chain applied.
-- Each case RAISES EXCEPTION on failure; everything is rolled back.
--
-- No HTTP leaves the container: the harness's net.http_post records the
-- request in net.http_request_queue and returns its id, which is what lets
-- CASE 1 assert what the driver WOULD have sent (.github/sql-ci/bootstrap.sql).
-- ============================================================================
begin;

insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000fd', 'Moyasar-only Suite Branch', 'فرع اختبار ميسر')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- CASE 1: the refund driver invokes the worker for an enabled MOYASAR row and
-- for nothing else. Before 20261003120000 the gate was `<> 'tap'`, so with the
-- live row at 'moyasar' the worker could never be invoked, cron job or not.
-- ---------------------------------------------------------------------------
do $$
declare
  v_before bigint;
  v_id     bigint;
  v_req    record;
begin
  -- The non-secret project URL comes from Vault; the trigger secret from the
  -- payment row's secret_config. Both are fixtures, rolled back with the suite.
  perform vault.create_secret('https://project.example.invalid', 'lazywait_sync_project_url');
  update public.integration_settings
     set enabled = true,
         provider_name = 'tap',
         public_config = '{"mode":"test"}'::jsonb,
         secret_config = '{"refund_trigger_secret":"suite-refund-trigger"}'::jsonb
   where provider_type = 'payment';
  if not found then
    raise exception 'CASE 1 SETUP: no payment integration row';
  end if;

  -- A Tap row no longer drives the worker.
  select count(*) into v_before from net.http_request_queue;
  v_id := public.invoke_payment_refund_processor();
  if v_id is not null then
    raise exception 'CASE 1 FAILED: a tap row still invokes the refund worker (request %)', v_id;
  end if;
  if (select count(*) from net.http_request_queue) <> v_before then
    raise exception 'CASE 1 FAILED: a tap row queued an HTTP request';
  end if;

  -- An enabled Moyasar row does, with the secret sent verbatim.
  update public.integration_settings set provider_name = 'moyasar' where provider_type = 'payment';
  v_id := public.invoke_payment_refund_processor();
  if v_id is null then
    raise exception 'CASE 1 FAILED: an enabled moyasar row did not invoke the refund worker';
  end if;
  select * into v_req from net.http_request_queue where id = v_id;
  if v_req.url is distinct from 'https://project.example.invalid/functions/v1/payment-refund' then
    raise exception 'CASE 1 FAILED: unexpected worker URL %', v_req.url;
  end if;
  if v_req.headers ->> 'x-refund-secret' is distinct from 'suite-refund-trigger' then
    raise exception 'CASE 1 FAILED: the trigger secret was not sent verbatim';
  end if;
  if v_req.body is distinct from '{"limit": 5}'::jsonb then
    raise exception 'CASE 1 FAILED: unexpected request body %', v_req.body;
  end if;

  -- The comparison is case-insensitive, as it was for Tap.
  update public.integration_settings set provider_name = 'Moyasar' where provider_type = 'payment';
  if public.invoke_payment_refund_processor() is null then
    raise exception 'CASE 1 FAILED: provider name Moyasar (capitalised) was refused';
  end if;

  -- Still fail closed: a DISABLED Moyasar row, and a blank trigger secret.
  update public.integration_settings set provider_name = 'moyasar', enabled = false
   where provider_type = 'payment';
  if public.invoke_payment_refund_processor() is not null then
    raise exception 'CASE 1 FAILED: a disabled moyasar row invoked the refund worker';
  end if;
  update public.integration_settings
     set enabled = true, secret_config = '{"refund_trigger_secret":"   "}'::jsonb
   where provider_type = 'payment';
  if public.invoke_payment_refund_processor() is not null then
    raise exception 'CASE 1 FAILED: a blank trigger secret invoked the refund worker';
  end if;

  raise notice 'CASE 1 ok: only an enabled moyasar row with a trigger secret invokes the refund worker';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2: the refund ledger's provider. A refund takes the provider of the
-- captured payment row when there is one. Only when there is neither a paid
-- row nor a recorded order provider does the fallback decide, and that is now
-- 'moyasar'. The order is driven to a proven non-delivery through a normal
-- UPDATE, so the enrollment triggers fire as they do in production.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner   uuid := gen_random_uuid();
  v_bare    uuid := gen_random_uuid();   -- no paid row, no provider recorded
  v_paid    uuid := gen_random_uuid();   -- a captured Moyasar payment row
  v_ref     record;
begin
  insert into auth.users (id) values (v_owner) on conflict (id) do nothing;
  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, order_number, branch_id, order_type,
    subtotal, total, payment_method, payment_status, lazywait_sync_state,
    lazywait_ref, sync_blocked_reason, pos_create_attempted_at, pos_customer_retry_count) values
    (v_bare, v_owner, 'MOY-1', 'b0000000-0000-0000-0000-0000000000fd', 'pickup', 50, 50, 'online', 'paid', 'failed', null, null, null, 3),
    (v_paid, v_owner, 'MOY-2', 'b0000000-0000-0000-0000-0000000000fd', 'pickup', 60, 60, 'online', 'paid', 'failed', null, null, null, 3);
  set local session_replication_role = origin;

  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode)
  values (v_paid, 'moyasar', 'pay_suite_0001', 'paid', 60, 'SAR', 'test');

  update public.orders set lazywait_sync_state = 'dead_letter' where id in (v_bare, v_paid);

  select provider, charge_ref, payment_record_id, amount into v_ref
    from public.order_refunds where order_id = v_bare;
  if not found then
    raise exception 'CASE 2 SETUP: the bare order was not enrolled for a refund';
  end if;
  if v_ref.provider is distinct from 'moyasar' then
    raise exception 'CASE 2 FAILED: the fallback refund provider is %, expected moyasar', coalesce(v_ref.provider, 'NULL');
  end if;
  if v_ref.charge_ref is not null or v_ref.payment_record_id is not null then
    raise exception 'CASE 2 FAILED: a bare enrollment invented a charge (% / %)', v_ref.charge_ref, v_ref.payment_record_id;
  end if;

  select provider, charge_ref, amount into v_ref
    from public.order_refunds where order_id = v_paid;
  if v_ref.provider is distinct from 'moyasar' or v_ref.charge_ref is distinct from 'pay_suite_0001'
     or v_ref.amount is distinct from 60.00 then
    raise exception 'CASE 2 FAILED: the captured payment did not decide the refund (% / % / %)',
      v_ref.provider, v_ref.charge_ref, v_ref.amount;
  end if;

  raise notice 'CASE 2 ok: a refund follows the captured payment, and falls back to moyasar';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3: the staff alert label, in both languages. The neighbours are pinned
-- too, so a substitution that hit the wrong line cannot pass.
-- ---------------------------------------------------------------------------
do $$
declare
  v_en jsonb := public.operations_alerts_render_event('opened', 'en', 'payment', 'not_configured', 'warning');
  v_ar jsonb := public.operations_alerts_render_event('opened', 'ar', 'payment', 'not_configured', 'warning');
begin
  if v_en ->> 'subject' is distinct from '[WARNING] Payment / Moyasar — Alert opened' then
    raise exception 'CASE 3 FAILED: English subject %', v_en ->> 'subject';
  end if;
  if v_en ->> 'body' is distinct from 'Alert opened: Payment / Moyasar condition not_configured (severity: warning).' then
    raise exception 'CASE 3 FAILED: English body %', v_en ->> 'body';
  end if;
  if v_ar ->> 'subject' is distinct from '[تحذير] الدفع / Moyasar — تنبيه جديد' then
    raise exception 'CASE 3 FAILED: Arabic subject %', v_ar ->> 'subject';
  end if;
  if (v_en::text || v_ar::text) ~* '\mtap' then
    raise exception 'CASE 3 FAILED: a rendered payment event still names Tap';
  end if;

  if public.operations_alerts_render_event('opened', 'en', 'email', 'x', 'info') ->> 'subject'
       is distinct from '[INFO] Email / SMTP — Alert opened'
     or public.operations_alerts_render_event('opened', 'ar', 'email', 'x', 'info') ->> 'subject'
       is distinct from '[معلومة] البريد / SMTP — تنبيه جديد' then
    raise exception 'CASE 3 FAILED: a neighbouring label changed';
  end if;

  raise notice 'CASE 3 ok: the payment alert reads Payment / Moyasar and الدفع / Moyasar';
end $$;

rollback;
