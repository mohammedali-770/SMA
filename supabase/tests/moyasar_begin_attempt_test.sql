-- ============================================================================
-- Payment-attempt tests for the Moyasar RPCs (migrations
-- 20260824100000_moyasar_payment_provider.sql and
-- 20261003120000_moyasar_only_payments.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied. Each
-- case RAISES EXCEPTION on failure; a clean run prints NOTICEs and commits
-- nothing (wrapped in a rollback).
--
-- WHY THESE CASES AND NOT OTHERS. Moyasar documents NO idempotency on
-- `POST /v1/invoices`, so the one-active-attempt guard tested here is the only
-- thing standing between a repeated tap on Pay and a second live invoice. That
-- is what makes the reuse and provider-scoping cases below load-bearing rather
-- than decorative. Case 11 is the loyalty guard 20261003120000 ported: without
-- it, two live checkout sessions could each be paid with the same points.
-- Case 12 is Moyasar's 1.00 SAR invoice minimum, also 20261003120000: below it
-- an attempt could only end with no invoice.
--
-- No provider is contacted: begin_payment_attempt / begin_session_attempt only
-- write a payment_records row. Nothing here schedules or invokes the refund
-- worker.
-- ============================================================================
begin;

-- A branch to hang test orders on. Self-contained on purpose: not the seed's
-- branch, so the suite does not depend on supabase/seed.sql having been loaded.
insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000fe', 'Moyasar Suite Branch', 'فرع اختبار ميسر')
on conflict (id) do nothing;

-- The generated shape of the internal id, matched as a VALUE not a column name,
-- so any writer that concatenates it into free text is caught.
create or replace function pg_temp.has_sm_number(p text)
returns boolean language sql immutable as $$
  select p is not null and p ~ 'SM-[0-9]{4}-[0-9]{4,}';
$$;

create or replace function pg_temp.new_online_order()
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000fe', 'pickup', 50, 50, 'online', 'pending')
    returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Case 1: a NEW Moyasar attempt is opened with an opaque ORD-… reference, and
-- both provider id columns start NULL — Moyasar issues the invoice id only
-- after this RPC returns, and the payment id only after the customer pays.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid := pg_temp.new_online_order();
  r       record;
begin
  select * into r from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);

  if r.attempt_id is null then
    raise exception 'CASE 1 FAILED: no attempt_id returned';
  end if;
  if r.reused then
    raise exception 'CASE 1 FAILED: a first attempt was reported as reused';
  end if;
  if r.reference_order is null or r.reference_order not like 'ORD-%' then
    raise exception 'CASE 1 FAILED: reference_order is not opaque: %', r.reference_order;
  end if;
  if pg_temp.has_sm_number(r.reference_order) then
    raise exception 'CASE 1 FAILED: reference_order carries the internal number: %', r.reference_order;
  end if;
  if r.reference_transaction is null or r.reference_transaction not like 'sm\_%' then
    raise exception 'CASE 1 FAILED: reference_transaction is not the per-attempt sm_ value: %', r.reference_transaction;
  end if;
  if r.provider_ref is not null or r.provider_checkout_ref is not null then
    raise exception 'CASE 1 FAILED: provider ids should start NULL, got %/%', r.provider_ref, r.provider_checkout_ref;
  end if;
  if r.amount <> 50 or r.currency <> 'SAR' or r.mode <> 'test' then
    raise exception 'CASE 1 FAILED: server-trusted amount/currency/mode wrong: %/%/%', r.amount, r.currency, r.mode;
  end if;

  if not exists (
    select 1 from public.payment_records
    where id = r.attempt_id and provider = 'moyasar' and status = 'initiated' and order_id = v_order
  ) then
    raise exception 'CASE 1 FAILED: no initiated moyasar payment_records row was written';
  end if;
  raise notice 'CASE 1 ok: a new Moyasar attempt is opaque, server-priced and has no provider ids yet';
end $$;

-- ---------------------------------------------------------------------------
-- Case 2: THE DOUBLE-CHARGE GUARD. A second call for the same order returns the
-- SAME attempt marked reused, and writes no second row. For Moyasar this is not
-- a convenience — with no invoice idempotency at the provider, a second row
-- would become a second live invoice.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid := pg_temp.new_online_order();
  a       record;
  b       record;
  v_rows  integer;
begin
  select * into a from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  select * into b from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);

  if not b.reused then
    raise exception 'CASE 2 FAILED: the second call did not report reuse';
  end if;
  if b.attempt_id <> a.attempt_id then
    raise exception 'CASE 2 FAILED: a SECOND attempt was opened (% then %)', a.attempt_id, b.attempt_id;
  end if;
  if b.reference_transaction <> a.reference_transaction then
    raise exception 'CASE 2 FAILED: the per-attempt reference changed on reuse';
  end if;

  select count(*) into v_rows from public.payment_records
    where order_id = v_order and provider = 'moyasar';
  if v_rows <> 1 then
    raise exception 'CASE 2 FAILED: % moyasar rows exist for one order', v_rows;
  end if;
  raise notice 'CASE 2 ok: a repeated initiate reuses the one live attempt';
end $$;

-- ---------------------------------------------------------------------------
-- Case 3: a stored invoice id survives the reuse path. payment-initiate returns
-- the stored checkout URL only when provider_checkout_ref comes back with it;
-- if this regressed, every retry would create a fresh invoice.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid := pg_temp.new_online_order();
  a       record;
  b       record;
begin
  select * into a from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  update public.payment_records
    set provider_checkout_ref = 'inv_test_0001',
        checkout_url = 'https://checkout.moyasar.com/invoices/inv_test_0001'
    where id = a.attempt_id;

  select * into b from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  if not b.reused then
    raise exception 'CASE 3 FAILED: the attempt was not reused';
  end if;
  if b.provider_checkout_ref is distinct from 'inv_test_0001' then
    raise exception 'CASE 3 FAILED: the stored invoice id was not returned: %', b.provider_checkout_ref;
  end if;
  if b.checkout_url is distinct from 'https://checkout.moyasar.com/invoices/inv_test_0001' then
    raise exception 'CASE 3 FAILED: the stored checkout URL was not returned: %', b.checkout_url;
  end if;
  raise notice 'CASE 3 ok: the stored invoice id and hosted URL survive reuse';
end $$;

-- ---------------------------------------------------------------------------
-- Case 4: the guard is PER PROVIDER. The partial unique index is
-- (order_id, provider), so a Moyasar attempt opens beside an 'initiated' row of
-- another provider and reuses only its own. Production holds exactly such
-- rows: three Tap attempts from July, still 'initiated' and long expired. The
-- Tap row is written directly, in their shape, because the RPC that wrote them
-- is gone (20261004120000).
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid := pg_temp.new_online_order();
  v_tap   uuid;
  m       record;
  m2      record;
begin
  insert into public.payment_records
    (order_id, provider, status, amount, currency, mode,
     reference_transaction, reference_order, initiated_at, expires_at)
  values
    (v_order, 'tap', 'initiated', 50, 'SAR', 'test',
     'sm_' || replace(gen_random_uuid()::text, '-', ''),
     'ORD-' || substr(replace(v_order::text, '-', ''), 1, 12),
     now() - interval '120 days', now() - interval '120 days' + interval '30 minutes')
  returning id into v_tap;

  select * into m from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  if m.attempt_id = v_tap then
    raise exception 'CASE 4 FAILED: the Moyasar call returned the Tap attempt';
  end if;
  if m.reused then
    raise exception 'CASE 4 FAILED: a first Moyasar attempt was reported as reused';
  end if;

  select * into m2 from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  if m2.attempt_id <> m.attempt_id then
    raise exception 'CASE 4 FAILED: Moyasar reuse crossed into another provider row';
  end if;

  -- The Moyasar path expires only its own stale attempts: the Tap row is
  -- history, and stays exactly as it was.
  if (select status from public.payment_records where id = v_tap) is distinct from 'initiated' then
    raise exception 'CASE 4 FAILED: the Tap history row was disturbed';
  end if;
  raise notice 'CASE 4 ok: the one-active-attempt guard is provider-scoped, and Tap history is left alone';
end $$;

-- ---------------------------------------------------------------------------
-- Case 5: a stale attempt is failed and replaced rather than reused, so an
-- expired invoice never traps a customer on a dead checkout page.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid := pg_temp.new_online_order();
  a       record;
  b       record;
  v_old   text;
begin
  select * into a from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  update public.payment_records set expires_at = now() - interval '1 minute' where id = a.attempt_id;

  select * into b from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  if b.reused then
    raise exception 'CASE 5 FAILED: an expired attempt was reused';
  end if;
  if b.attempt_id = a.attempt_id then
    raise exception 'CASE 5 FAILED: the expired attempt was handed back';
  end if;

  select status || '/' || coalesce(failure_code, '-') into v_old
    from public.payment_records where id = a.attempt_id;
  if v_old <> 'failed/expired' then
    raise exception 'CASE 5 FAILED: the stale attempt was left as %', v_old;
  end if;
  raise notice 'CASE 5 ok: a stale attempt is closed as expired and replaced';
end $$;

-- ---------------------------------------------------------------------------
-- Case 6: the preconditions all fail CLOSED. Each of these would otherwise be a
-- way to open a payment against an order that must not be paid.
-- ---------------------------------------------------------------------------
do $$
declare
  v_paid  uuid := pg_temp.new_online_order();
  v_cash  uuid;
  v_free  uuid;
  v_order uuid := pg_temp.new_online_order();
  blocked boolean;
begin
  -- already paid
  update public.orders set payment_status = 'paid' where id = v_paid;
  blocked := false;
  begin perform public.begin_payment_attempt(v_paid, 'moyasar', 'test', 30);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'CASE 6 FAILED: a PAID order could open an attempt'; end if;

  -- cash order
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000fe', 'pickup', 50, 50, 'cash', 'pending')
    returning id into v_cash;
  blocked := false;
  begin perform public.begin_payment_attempt(v_cash, 'moyasar', 'test', 30);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'CASE 6 FAILED: a CASH order could open an online attempt'; end if;

  -- zero total
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000fe', 'pickup', 0, 0, 'online', 'pending')
    returning id into v_free;
  blocked := false;
  begin perform public.begin_payment_attempt(v_free, 'moyasar', 'test', 30);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'CASE 6 FAILED: a ZERO-total order could open an attempt'; end if;

  -- a blank provider must never fall through to some default
  blocked := false;
  begin perform public.begin_payment_attempt(v_order, '  ', 'test', 30);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'CASE 6 FAILED: a blank provider was accepted'; end if;

  blocked := false;
  begin perform public.begin_payment_attempt(v_order, null, 'test', 30);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'CASE 6 FAILED: a null provider was accepted'; end if;

  raise notice 'CASE 6 ok: paid / cash / zero-total / blank-provider all fail closed';
end $$;

-- ---------------------------------------------------------------------------
-- Case 7: the mode is normalised to exactly test or live, and the expiry is
-- clamped to 5..60 minutes — the same bounds the Edge Function applies, so a
-- caller cannot open a 24-hour invoice by passing a large number.
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.new_online_order();
  v_b uuid := pg_temp.new_online_order();
  v_c uuid := pg_temp.new_online_order();
  r   record;
  v_mins numeric;
begin
  select * into r from public.begin_payment_attempt(v_a, 'moyasar', 'nonsense', 30);
  if r.mode <> 'test' then
    raise exception 'CASE 7 FAILED: an unrecognised mode became %, not test', r.mode;
  end if;

  select * into r from public.begin_payment_attempt(v_b, 'moyasar', 'live', 9999);
  if r.mode <> 'live' then
    raise exception 'CASE 7 FAILED: live mode was not honoured';
  end if;
  select extract(epoch from (expires_at - initiated_at)) / 60 into v_mins
    from public.payment_records where id = r.attempt_id;
  if v_mins > 61 then
    raise exception 'CASE 7 FAILED: expiry was not clamped down, got % minutes', v_mins;
  end if;

  select * into r from public.begin_payment_attempt(v_c, 'moyasar', 'test', 1);
  select extract(epoch from (expires_at - initiated_at)) / 60 into v_mins
    from public.payment_records where id = r.attempt_id;
  if v_mins < 4.9 then
    raise exception 'CASE 7 FAILED: expiry was not clamped up, got % minutes', v_mins;
  end if;
  raise notice 'CASE 7 ok: mode is normalised and expiry is clamped to 5..60';
end $$;

-- ---------------------------------------------------------------------------
-- Case 8: the SESSION flow. Same guarantees, and the reference is the opaque
-- CS-… form — the order does not exist yet, so there is no ORD- to use.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cust    uuid := 'c0000000-0000-0000-0000-0000000000fe';
  v_session uuid;
  a         record;
  b         record;
  v_rows    integer;
begin
  -- checkout_sessions.customer_id is NOT NULL and references the auth user, so
  -- the session flow needs a real owner where the order flow did not.
  begin
    insert into auth.users (id, email) values (v_cust, 'moyasar-suite@example.com')
      on conflict (id) do nothing;
  exception when undefined_table then
    null; -- harness seeds auth.users differently
  end;
  insert into public.profiles (id, role) values (v_cust, 'customer')
    on conflict (id) do nothing;

  insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'b0000000-0000-0000-0000-0000000000fe', '{}'::jsonb, 50, 50)
    returning id into v_session;

  select * into a from public.begin_session_attempt(v_session, 'moyasar', 'test', 30);
  if a.reference_order is null or a.reference_order not like 'CS-%' then
    raise exception 'CASE 8 FAILED: session reference is not the opaque CS- form: %', a.reference_order;
  end if;
  if pg_temp.has_sm_number(a.reference_order) then
    raise exception 'CASE 8 FAILED: session reference carries an internal number';
  end if;
  if a.provider_checkout_ref is not null then
    raise exception 'CASE 8 FAILED: a session attempt should start with no invoice id';
  end if;

  select * into b from public.begin_session_attempt(v_session, 'moyasar', 'test', 30);
  if not b.reused or b.attempt_id <> a.attempt_id then
    raise exception 'CASE 8 FAILED: the session double-charge guard did not hold';
  end if;

  select count(*) into v_rows from public.payment_records
    where checkout_session_id = v_session and provider = 'moyasar';
  if v_rows <> 1 then
    raise exception 'CASE 8 FAILED: % moyasar rows exist for one session', v_rows;
  end if;
  raise notice 'CASE 8 ok: the session flow is opaque and guarded the same way';
end $$;

-- ---------------------------------------------------------------------------
-- Case 9: privileges. These RPCs are SECURITY DEFINER and bypass RLS, so they
-- must be reachable ONLY by the service role. A grant leaking to `authenticated`
-- would let any signed-in customer open an attempt against any order id.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array['begin_payment_attempt', 'begin_session_attempt'] loop
    if has_function_privilege('anon', format('public.%I(uuid, text, text, integer)', fn), 'execute')
       or has_function_privilege('authenticated', format('public.%I(uuid, text, text, integer)', fn), 'execute')
       or has_function_privilege('public', format('public.%I(uuid, text, text, integer)', fn), 'execute') then
      raise exception 'CASE 9 FAILED: %() is executable by an untrusted role', fn;
    end if;
    if not has_function_privilege('service_role', format('public.%I(uuid, text, text, integer)', fn), 'execute') then
      raise exception 'CASE 9 FAILED: %() is not executable by service_role', fn;
    end if;
  end loop;
  raise notice 'CASE 9 ok: both RPCs are service-role only';
end $$;

-- ---------------------------------------------------------------------------
-- Case 10: the new column is indexed for the lookup the webhook actually does
-- (find the attempt by the provider's invoice id) and is NOT unique — a unique
-- constraint there would forbid re-opening an attempt against a reused invoice
-- id, which is not a property this integration is willing to bet on.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unique boolean;
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'payment_records_provider_checkout_ref_idx'
  ) then
    raise exception 'CASE 10 FAILED: the provider_checkout_ref index is missing';
  end if;

  select i.indisunique into v_unique
    from pg_class c join pg_index i on i.indexrelid = c.oid
    where c.relname = 'payment_records_provider_checkout_ref_idx';
  if v_unique then
    raise exception 'CASE 10 FAILED: the provider_checkout_ref index is UNIQUE';
  end if;
  raise notice 'CASE 10 ok: provider_checkout_ref is indexed and deliberately non-unique';
end $$;

-- ---------------------------------------------------------------------------
-- Case 11: THE LOYALTY MULTI-SPEND GUARD (20261003120000). Two live sessions
-- priced against the same 100 points must not both reach a payment: the live
-- balance has to cover this session's points PLUS those reserved by the
-- customer's other live sessions. Without the guard both attempts open, and
-- insert_order_from_snapshot later clamps the second DEDUCTION to the balance
-- left while keeping the second DISCOUNT.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cust  uuid := 'c0000000-0000-0000-0000-0000000000fd';
  v_a     uuid;
  v_b     uuid;
  v_c     uuid;
  v_state text;
  v_msg   text;
  r       record;
begin
  begin
    insert into auth.users (id, email) values (v_cust, 'moyasar-loyalty-suite@example.com')
      on conflict (id) do nothing;
  exception when undefined_table then
    null; -- harness seeds auth.users differently
  end;
  insert into public.profiles (id, role) values (v_cust, 'customer')
    on conflict (id) do nothing;
  update public.profiles set loyalty_points = 100 where id = v_cust;

  -- Two live sessions, each priced to redeem 80 of the same 100 points.
  insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'b0000000-0000-0000-0000-0000000000fe',
            '{"loyalty_points_redeemed": 80}'::jsonb, 50, 42)
    returning id into v_a;
  insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'b0000000-0000-0000-0000-0000000000fe',
            '{"loyalty_points_redeemed": 80}'::jsonb, 50, 42)
    returning id into v_b;

  -- 80 + 80 > 100, so paying either one is refused while the other is live.
  begin
    perform public.begin_session_attempt(v_a, 'moyasar', 'test', 30);
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001'
     or v_msg is distinct from 'Your loyalty points balance changed. Please rebuild your order.' then
    raise exception 'CASE 11 FAILED: two live sessions could spend the same points (sqlstate %, %)',
      coalesce(v_state, 'none'), coalesce(v_msg, 'no error');
  end if;
  if exists (select 1 from public.payment_records where checkout_session_id in (v_a, v_b)) then
    raise exception 'CASE 11 FAILED: a refused attempt still wrote a payment row';
  end if;

  -- Once the other session has expired, the same session can pay.
  update public.checkout_sessions set status = 'expired' where id = v_b;
  select * into r from public.begin_session_attempt(v_a, 'moyasar', 'test', 30);
  if r.attempt_id is null or r.reused then
    raise exception 'CASE 11 FAILED: a covered session could not open its attempt';
  end if;

  -- Points spent elsewhere also block a REUSE of that open attempt...
  update public.profiles set loyalty_points = 50 where id = v_cust;
  v_state := null;
  begin
    perform public.begin_session_attempt(v_a, 'moyasar', 'test', 30);
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'CASE 11 FAILED: a reused attempt ignored a balance that no longer covers it';
  end if;

  -- ...while a session that redeems nothing is never held up by the guard.
  insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'b0000000-0000-0000-0000-0000000000fe', '{}'::jsonb, 50, 50)
    returning id into v_c;
  select * into r from public.begin_session_attempt(v_c, 'moyasar', 'test', 30);
  if r.attempt_id is null then
    raise exception 'CASE 11 FAILED: a session that redeems no points was refused';
  end if;

  raise notice 'CASE 11 ok: the live balance must cover the points of every live session';
end $$;

-- ---------------------------------------------------------------------------
-- Case 12: MOYASAR'S INVOICE MINIMUM (20261003120000). Moyasar refuses an
-- invoice under 100 minor units, 1.00 SAR, so a total under that can never be
-- paid online, and an attempt opened for it could only end with no invoice:
-- every retry failed the same way, and the saved session held the device. A
-- points redemption leaves such remainders. Both RPCs refuse it with P0001 and
-- write no row; exactly 1.00 is accepted. payment-initiate refuses it first.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cust  uuid := 'c0000000-0000-0000-0000-0000000000fc';
  v_total numeric;
  v_id    uuid;
  v_state text;
  v_msg   text;
  r       record;
begin
  begin
    insert into auth.users (id, email) values (v_cust, 'moyasar-minimum-suite@example.com')
      on conflict (id) do nothing;
  exception when undefined_table then
    null; -- harness seeds auth.users differently
  end;
  insert into public.profiles (id, role) values (v_cust, 'customer')
    on conflict (id) do nothing;

  -- Refused below the floor, one halala below it included.
  foreach v_total in array array[0.50, 0.99]::numeric[] loop
    insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
      values (v_cust, 'pickup', 'b0000000-0000-0000-0000-0000000000fe', '{}'::jsonb, 50, v_total)
      returning id into v_id;
    v_state := null; v_msg := null;
    begin
      perform public.begin_session_attempt(v_id, 'moyasar', 'live', 30);
    exception when others then
      v_state := sqlstate; v_msg := sqlerrm;
    end;
    if v_state is distinct from 'P0001'
       or v_msg is distinct from 'Order total is below the online payment minimum of 1.00 SAR' then
      raise exception 'CASE 12 FAILED: a session of % SAR opened an attempt (sqlstate %, %)',
        v_total, coalesce(v_state, 'none'), coalesce(v_msg, 'no error');
    end if;
    if exists (select 1 from public.payment_records where checkout_session_id = v_id) then
      raise exception 'CASE 12 FAILED: a refused session of % SAR still wrote a payment row', v_total;
    end if;

    insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
      values ('b0000000-0000-0000-0000-0000000000fe', 'pickup', 50, v_total, 'online', 'pending')
      returning id into v_id;
    v_state := null; v_msg := null;
    begin
      perform public.begin_payment_attempt(v_id, 'moyasar', 'live', 30);
    exception when others then
      v_state := sqlstate; v_msg := sqlerrm;
    end;
    if v_state is distinct from 'P0001'
       or v_msg is distinct from 'Order total is below the online payment minimum of 1.00 SAR' then
      raise exception 'CASE 12 FAILED: an order of % SAR opened an attempt (sqlstate %, %)',
        v_total, coalesce(v_state, 'none'), coalesce(v_msg, 'no error');
    end if;
    if exists (select 1 from public.payment_records where order_id = v_id) then
      raise exception 'CASE 12 FAILED: a refused order of % SAR still wrote a payment row', v_total;
    end if;
  end loop;

  -- Refused BEFORE an open attempt is reused: one written by an older build
  -- for such a total is not handed back.
  insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'b0000000-0000-0000-0000-0000000000fe', '{}'::jsonb, 50, 0.50)
    returning id into v_id;
  insert into public.payment_records
    (checkout_session_id, provider, status, amount, currency, mode, reference_transaction, initiated_at, expires_at)
  values (v_id, 'moyasar', 'initiated', 0.50, 'SAR', 'live', 'sm_minimum_suite', now(), now() + interval '30 minutes');
  v_state := null;
  begin
    perform public.begin_session_attempt(v_id, 'moyasar', 'live', 30);
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'CASE 12 FAILED: an open attempt for a 0.50 SAR session was reused';
  end if;

  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000fe', 'pickup', 50, 0.50, 'online', 'pending')
    returning id into v_id;
  insert into public.payment_records
    (order_id, provider, status, amount, currency, mode, reference_transaction, initiated_at, expires_at)
  values (v_id, 'moyasar', 'initiated', 0.50, 'SAR', 'live', 'sm_minimum_suite_o', now(), now() + interval '30 minutes');
  v_state := null;
  begin
    perform public.begin_payment_attempt(v_id, 'moyasar', 'live', 30);
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'CASE 12 FAILED: an open attempt for a 0.50 SAR order was reused';
  end if;

  -- Exactly the floor is accepted, by both.
  insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'b0000000-0000-0000-0000-0000000000fe', '{}'::jsonb, 50, 1.00)
    returning id into v_id;
  select * into r from public.begin_session_attempt(v_id, 'moyasar', 'live', 30);
  if r.attempt_id is null or r.reused or r.amount <> 1.00 then
    raise exception 'CASE 12 FAILED: a session of exactly 1.00 SAR could not open its attempt';
  end if;

  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000fe', 'pickup', 50, 1.00, 'online', 'pending')
    returning id into v_id;
  select * into r from public.begin_payment_attempt(v_id, 'moyasar', 'live', 30);
  if r.attempt_id is null or r.reused or r.amount <> 1.00 then
    raise exception 'CASE 12 FAILED: an order of exactly 1.00 SAR could not open its attempt';
  end if;

  raise notice 'CASE 12 ok: a total under 1.00 SAR opens no attempt, and exactly 1.00 does';
end $$;

rollback;
