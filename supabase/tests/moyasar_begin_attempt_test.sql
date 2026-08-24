-- ============================================================================
-- Provider-generic payment-attempt tests (migration
-- 20260824100000_moyasar_payment_provider.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied. Each
-- case RAISES EXCEPTION on failure; a clean run prints NOTICEs and commits
-- nothing (wrapped in a rollback).
--
-- WHY THESE CASES AND NOT OTHERS. Tap accepts an idempotency reference on charge
-- creation, so its double-charge protection is belt-and-braces: the provider
-- would return the first charge even if our guard leaked. Moyasar documents NO
-- idempotency on `POST /v1/invoices`, so for Moyasar the one-active-attempt
-- guard tested here IS the protection. That is what makes the reuse and
-- provider-scoping cases below load-bearing rather than decorative.
--
-- No provider is contacted: begin_payment_attempt / begin_session_attempt only
-- write a payment_records row. Nothing here schedules or invokes the refund
-- worker, and no Tap object is touched.
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
-- Case 4: the guard is PER PROVIDER, and the Tap path is untouched. The partial
-- unique index is (order_id, provider), so a Tap attempt and a Moyasar attempt
-- can coexist for one order and each reuses only its own.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid := pg_temp.new_online_order();
  t       record;
  m       record;
  m2      record;
begin
  select * into t from public.tap_begin_payment_attempt(v_order, 'test', 30);
  select * into m from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);

  if m.attempt_id = t.attempt_id then
    raise exception 'CASE 4 FAILED: the Moyasar call returned the Tap attempt';
  end if;
  if m.reused then
    raise exception 'CASE 4 FAILED: a first Moyasar attempt was reported as reused';
  end if;

  select * into m2 from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  if m2.attempt_id <> m.attempt_id then
    raise exception 'CASE 4 FAILED: Moyasar reuse crossed into another provider row';
  end if;

  if (select count(*) from public.payment_records where order_id = v_order and provider = 'tap') <> 1 then
    raise exception 'CASE 4 FAILED: the Tap attempt row was disturbed';
  end if;
  raise notice 'CASE 4 ok: the one-active-attempt guard is provider-scoped';
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

rollback;
