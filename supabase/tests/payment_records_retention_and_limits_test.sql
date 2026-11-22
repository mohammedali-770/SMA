-- ============================================================================
-- Payment records survive erasure; order numbers grow; item notes are bounded
-- before payment (migration 20261023120000_payment_records_retention_and_limits).
--
-- Runs against a throwaway Postgres with the FULL migration chain and the seed
-- applied (.github/sql-ci/run.sh). Every case RAISES on failure, so the script
-- exits non-zero; a clean run prints NOTICEs and commits nothing.
--
-- Three audit findings, one block of cases each:
--
--   A. F-DBM-04-001. Erasing a customer, by anonymize_account_data (route A)
--      or by deleting the Auth user (route B), must keep the paid payment
--      record of every retained card order, unchanged except for the session
--      link, and must still remove attempt records that never became an order.
--      Before the migration both routes deleted the paid record (CASES A2, A3).
--   B. F-DBM-02-001. Order numbers must not truncate past 999 999. Before the
--      migration ten sequence values shared one number and place_order
--      returned an all-NULL row (CASE B2).
--   C. F-DBM-17-001. A card checkout session carrying an item note over 140
--      characters must be refused when it is created, not in finalize after the
--      capture (CASE C2).
--
-- The sequence is advanced with setval, which is not transactional. That is
-- acceptable only because each suite runs on its own disposable clone.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Fixtures: three customers, each with a phone the erasure can resolve.
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, phone, phone_confirmed_at) values
    (v_a, 'prr-a@example.invalid', '966500000901', now()),
    (v_b, 'prr-b@example.invalid', '966500000902', now()),
    (v_c, 'prr-c@example.invalid', '966500000003', now());
  update public.profiles set phone_verified = true where id in (v_a, v_b, v_c);
  update public.app_settings set online_payment_enabled = true;

  perform set_config('prr.a', v_a::text, false);
  perform set_config('prr.b', v_b::text, false);
  perform set_config('prr.c', v_c::text, false);
end $$;

-- One paid card order through the real session path, plus two attempt records
-- that never became an order: a failed earlier attempt on the SAME session, and
-- an abandoned session with an initiated attempt. Returns the paid order id.
create or replace function pg_temp.card_order(p_cust uuid, p_ref text)
returns uuid language plpgsql as $$
declare
  v_s     public.checkout_sessions;
  v_dead  public.checkout_sessions;
  v_o     public.orders;
begin
  perform set_config('test.auth_uid', p_cust::text, false);
  v_s := public.begin_checkout_session('b0000000-0000-0000-0000-000000000001', 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":2}]'::jsonb);
  insert into public.payment_records (checkout_session_id, provider, status, amount)
    values (v_s.id, 'moyasar', 'failed', v_s.total);
  insert into public.payment_records (checkout_session_id, provider, status, amount)
    values (v_s.id, 'moyasar', 'initiated', v_s.total);
  v_o := public.finalize_checkout_session(v_s.id, 'moyasar', p_ref, v_s.total, 'SAR',
    jsonb_build_object('id', p_ref, 'source', jsonb_build_object('company', 'mada', 'last_four', '4242')),
    'mada', '4242');
  if v_o.id is null or v_o.payment_status is distinct from 'paid' then
    raise exception 'FIXTURE FAILED: finalize did not create a paid order';
  end if;

  v_dead := public.begin_checkout_session('b0000000-0000-0000-0000-000000000001', 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb);
  insert into public.payment_records (checkout_session_id, provider, status, amount)
    values (v_dead.id, 'moyasar', 'initiated', v_dead.total);
  return v_o.id;
end $$;

-- ===========================================================================
-- A1. The schema is what the migration promised.
-- ===========================================================================
do $$
declare v_n int; v_def text;
begin
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.payment_records'::regclass and c.contype = 'f'
     and c.confrelid = 'public.checkout_sessions'::regclass
     and c.conname = 'payment_records_checkout_session_id_fkey'
     and c.confdeltype = 'n' and c.confupdtype = 'a' and c.confmatchtype = 's'
     and not c.condeferrable and c.convalidated;
  if v_n <> 1 then
    raise exception 'CASE A1 FAILED: payment_records.checkout_session_id is not ON DELETE SET NULL (or another property moved)';
  end if;
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.payment_records'::regclass and c.contype = 'f'
     and c.confrelid = 'public.checkout_sessions'::regclass;
  if v_n <> 1 then raise exception 'CASE A1 FAILED: % FKs to checkout_sessions', v_n; end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.payment_records'::regclass and conname = 'payment_records_owner_ck';
  if v_def is distinct from 'CHECK (((order_id IS NOT NULL) OR (checkout_session_id IS NOT NULL)))' then
    raise exception 'CASE A1 FAILED: payment_records_owner_ck changed: %', coalesce(v_def, '<missing>');
  end if;

  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.checkout_sessions'::regclass and not tgisinternal and tgenabled = 'O'
     and tgname in ('trg_checkout_sessions_drop_attempt_records', 'trg_checkout_sessions_item_note_length',
                    'trg_checkout_sessions_note_length');
  if v_n <> 3 then raise exception 'CASE A1 FAILED: expected 3 guard triggers on checkout_sessions, found %', v_n; end if;

  if has_function_privilege('anon', 'public.anonymize_account_data(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.anonymize_account_data(uuid)', 'execute') then
    raise exception 'CASE A1 FAILED: a client role can execute anonymize_account_data';
  end if;
  raise notice 'CASE A1 ok: FK is SET NULL, owner check unchanged, triggers bound, erasure closed to clients';
end $$;

-- ===========================================================================
-- A2. THE HEADLINE, route A: anonymize_account_data keeps the paid record.
-- ===========================================================================
do $$
declare
  v_cust  uuid := current_setting('prr.a')::uuid;
  v_order uuid;
  v_sum   jsonb;
  r       record;
  v_n     int;
begin
  v_order := pg_temp.card_order(v_cust, 'pay_prr_route_a');
  select count(*) into v_n from public.payment_records pr
    join public.checkout_sessions s on s.id = pr.checkout_session_id where s.customer_id = v_cust;
  -- failed attempt + the paid record (finalize promoted the initiated one) +
  -- the abandoned session's initiated attempt.
  if v_n <> 3 then raise exception 'CASE A2 FIXTURE: expected 3 session-linked records, found %', v_n; end if;

  v_sum := public.anonymize_account_data(v_cust);

  if (v_sum ->> 'checkout_sessions_deleted')::int is distinct from 2 then
    raise exception 'CASE A2 FAILED: checkout_sessions_deleted = %, expected 2', v_sum ->> 'checkout_sessions_deleted';
  end if;
  if (v_sum ->> 'orders_anonymized')::int is distinct from 1 then
    raise exception 'CASE A2 FAILED: orders_anonymized = %, expected 1', v_sum ->> 'orders_anonymized';
  end if;

  select count(*) into v_n from public.payment_records where order_id = v_order;
  if v_n <> 1 then raise exception 'CASE A2 FAILED: % payment records left for the paid order, expected 1', v_n; end if;
  select * into r from public.payment_records where order_id = v_order;
  if r.status is distinct from 'paid' or r.provider_ref is distinct from 'pay_prr_route_a'
     or r.provider is distinct from 'moyasar' or r.amount is distinct from 24.00
     or r.currency is distinct from 'SAR' or r.card_scheme is distinct from 'mada'
     or r.card_last_four is distinct from '4242' or r.raw ->> 'id' is distinct from 'pay_prr_route_a'
     or r.checkout_session_id is not null then
    raise exception 'CASE A2 FAILED: the kept record changed: status %, ref %, amount %, scheme %, last4 %, session %',
      r.status, r.provider_ref, r.amount, r.card_scheme, r.card_last_four, r.checkout_session_id;
  end if;

  -- The summary says what erasure kept.
  if (v_sum ->> 'payment_records_detached')::int is distinct from 1 then
    raise exception 'CASE A2 FAILED: payment_records_detached = %, expected 1', coalesce(v_sum ->> 'payment_records_detached', '<absent>');
  end if;

  select count(*) into v_n from public.checkout_sessions where customer_id = v_cust;
  if v_n <> 0 then raise exception 'CASE A2 FAILED: % sessions survived erasure', v_n; end if;
  select count(*) into v_n from public.payment_records where order_id is null and checkout_session_id is null;
  if v_n <> 0 then raise exception 'CASE A2 FAILED: % orphan payment records', v_n; end if;
  select count(*) into v_n from public.payment_records where provider_ref is null and order_id is null;
  if v_n <> 0 then raise exception 'CASE A2 FAILED: % attempt records without an order survived', v_n; end if;

  select count(*) into v_n from public.orders
   where id = v_order and payment_status = 'paid' and total = 24.00
     and customer_name is null and customer_phone is null;
  if v_n <> 1 then raise exception 'CASE A2 FAILED: the order was not kept paid and anonymized'; end if;
  raise notice 'CASE A2 ok: anonymize kept the paid record intact, detached it, removed both attempt records';
end $$;

-- ===========================================================================
-- A3. Route B: deleting the Auth user alone (no anonymize first) keeps the
--     paid record, and the order-less attempt records do not make the
--     cascade fail the owner check.
-- ===========================================================================
do $$
declare
  v_cust  uuid := current_setting('prr.b')::uuid;
  v_order uuid;
  v_n     int;
  r       record;
begin
  v_order := pg_temp.card_order(v_cust, 'pay_prr_route_b');

  delete from auth.users where id = v_cust;
  select count(*) into v_n from public.profiles where id = v_cust;
  if v_n <> 0 then raise exception 'CASE A3 FIXTURE: the profile did not cascade'; end if;

  select * into r from public.payment_records where order_id = v_order;
  if not found then raise exception 'CASE A3 FAILED: the paid record was deleted by the Auth cascade'; end if;
  if r.status is distinct from 'paid' or r.provider_ref is distinct from 'pay_prr_route_b'
     or r.amount is distinct from 24.00 or r.checkout_session_id is not null then
    raise exception 'CASE A3 FAILED: the kept record changed (status %, ref %, amount %, session %)',
      r.status, r.provider_ref, r.amount, r.checkout_session_id;
  end if;
  select count(*) into v_n from public.payment_records where order_id = v_order;
  if v_n <> 1 then raise exception 'CASE A3 FAILED: % records for the order, expected 1', v_n; end if;
  select count(*) into v_n from public.payment_records where order_id is null;
  if v_n <> 0 then raise exception 'CASE A3 FAILED: % order-less attempt records survived', v_n; end if;
  select count(*) into v_n from public.orders where id = v_order and customer_id is null and payment_status = 'paid';
  if v_n <> 1 then raise exception 'CASE A3 FAILED: the order was not kept with its customer link cleared'; end if;
  raise notice 'CASE A3 ok: the Auth cascade kept the paid record and removed the attempts';
end $$;

-- ===========================================================================
-- A4. The refund path can still find the charge after erasure: a refund
--     opened on the erased customer's order carries the provider reference.
-- ===========================================================================
do $$
declare v_ref text;
begin
  select pr.provider_ref into v_ref
    from public.orders o join public.payment_records pr on pr.order_id = o.id and pr.status = 'paid'
   where pr.provider_ref = 'pay_prr_route_a';
  if v_ref is distinct from 'pay_prr_route_a' then
    raise exception 'CASE A4 FAILED: no paid record with a provider reference for the erased order';
  end if;
  raise notice 'CASE A4 ok: the charge reference a refund reads survives erasure';
end $$;

-- ===========================================================================
-- A5. A session with only an attempt record is deleted, as before, and its
--     record goes with it (no owner-check failure, no orphan).
-- ===========================================================================
do $$
declare
  v_cust uuid := current_setting('prr.c')::uuid;
  v_s    public.checkout_sessions;
  v_rec  uuid;
  v_n    int;
begin
  perform set_config('test.auth_uid', v_cust::text, false);
  v_s := public.begin_checkout_session('b0000000-0000-0000-0000-000000000001', 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000004","quantity":3}]'::jsonb);
  insert into public.payment_records (checkout_session_id, provider, status, amount)
    values (v_s.id, 'moyasar', 'initiated', v_s.total) returning id into v_rec;
  delete from public.checkout_sessions where id = v_s.id;
  select count(*) into v_n from public.payment_records where id = v_rec;
  if v_n <> 0 then raise exception 'CASE A5 FAILED: the attempt record outlived its session'; end if;
  raise notice 'CASE A5 ok: an attempt-only session deletes cleanly with its record';
end $$;

-- ===========================================================================
-- B1. Order numbers below one million keep the existing six-digit format.
-- ===========================================================================
do $$
declare
  v_year text := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
  v_o    public.orders;
  v_got  text[] := '{}';
  v      bigint;
begin
  perform set_config('test.auth_uid', current_setting('prr.c'), false);
  -- 1 and 2 were drawn by CASES A2 and A3, so the low value here is 7.
  foreach v in array array[7, 59, 999999]::bigint[] loop
    perform setval('public.order_number_seq', v, false);
    v_o := public.place_order('b0000000-0000-0000-0000-000000000001', 'pickup',
      '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb,
      p_payment_method => 'cash');
    v_got := v_got || v_o.order_number;
  end loop;
  if v_got is distinct from array['SM-' || v_year || '-000007', 'SM-' || v_year || '-000059', 'SM-' || v_year || '-999999'] then
    raise exception 'CASE B1 FAILED: got %', v_got;
  end if;
  raise notice 'CASE B1 ok: % keep six digits', v_got;
end $$;

-- ===========================================================================
-- B2. THE HEADLINE: past 999 999 every order gets its own number, and
--     place_order never returns an empty row.
-- ===========================================================================
do $$
declare
  v_year text := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
  v_o    public.orders;
  v_nums text[] := '{}';
  i      int;
begin
  perform set_config('test.auth_uid', current_setting('prr.c'), false);
  perform setval('public.order_number_seq', 1000000, false);
  for i in 1..11 loop
    v_o := public.place_order('b0000000-0000-0000-0000-000000000001', 'pickup',
      '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb,
      p_payment_method => 'cash');
    if v_o.id is null or v_o.order_number is null then
      raise exception 'CASE B2 FAILED: call % returned an empty row (order-number collision)', i;
    end if;
    v_nums := v_nums || v_o.order_number;
  end loop;
  if v_nums[1] is distinct from 'SM-' || v_year || '-1000000'
     or v_nums[11] is distinct from 'SM-' || v_year || '-1000010' then
    raise exception 'CASE B2 FAILED: got % .. %', v_nums[1], v_nums[11];
  end if;
  if (select count(distinct n) from unnest(v_nums) n) <> 11 then
    raise exception 'CASE B2 FAILED: numbers repeat: %', v_nums;
  end if;
  raise notice 'CASE B2 ok: % .. % all distinct', v_nums[1], v_nums[11];
end $$;

-- ===========================================================================
-- B3. Far past it, the number keeps growing.
-- ===========================================================================
do $$
declare v_o public.orders;
begin
  perform set_config('test.auth_uid', current_setting('prr.c'), false);
  perform setval('public.order_number_seq', 123456789, false);
  v_o := public.place_order('b0000000-0000-0000-0000-000000000001', 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb,
    p_payment_method => 'cash');
  if v_o.order_number is distinct from 'SM-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-123456789' then
    raise exception 'CASE B3 FAILED: got %', v_o.order_number;
  end if;
  raise notice 'CASE B3 ok: %', v_o.order_number;
end $$;

-- ===========================================================================
-- C1. The bound is exactly the order_items one: 140 characters after trimming
--     is accepted at checkout, and finalizes.
-- ===========================================================================
do $$
declare
  v_s public.checkout_sessions;
  v_o public.orders;
  v_n int;
begin
  perform set_config('test.auth_uid', current_setting('prr.c'), false);
  v_s := public.begin_checkout_session('b0000000-0000-0000-0000-000000000001', 'pickup',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000000003', 'quantity', 1,
      'note', '  ' || repeat('n', 140) || '  ')));
  if v_s.id is null then raise exception 'CASE C1 FAILED: no session for a 140-character note'; end if;
  v_o := public.finalize_checkout_session(v_s.id, 'moyasar', 'pay_prr_note_140', v_s.total, 'SAR');
  select count(*) into v_n from public.order_items where order_id = v_o.id and char_length(note) = 140;
  if v_n <> 1 then raise exception 'CASE C1 FAILED: the 140-character note did not reach the order'; end if;
  raise notice 'CASE C1 ok: a 140-character item note is accepted and finalizes';
end $$;

-- ===========================================================================
-- C2. THE HEADLINE: 141 characters is refused when the session is CREATED,
--     with the order_items message, and no session row is left behind.
-- ===========================================================================
do $$
declare
  v_cust   uuid := current_setting('prr.c')::uuid;
  v_before int;
  v_after  int;
  v_state  text;
  v_msg    text;
begin
  perform set_config('test.auth_uid', v_cust::text, false);
  select count(*) into v_before from public.checkout_sessions where customer_id = v_cust;
  begin
    perform public.begin_checkout_session('b0000000-0000-0000-0000-000000000001', 'pickup',
      jsonb_build_array(
        jsonb_build_object('product_id', 'a0000000-0000-0000-0000-000000000004', 'quantity', 1, 'note', 'fine'),
        jsonb_build_object('product_id', 'a0000000-0000-0000-0000-000000000003', 'quantity', 1, 'note', repeat('n', 141))));
    v_state := 'accepted';
  exception when others then
    v_state := sqlstate; v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001' or v_msg is distinct from 'Item note is too long' then
    raise exception 'CASE C2 FAILED: a 141-character item note at checkout gave % (%)', v_state, v_msg;
  end if;
  select count(*) into v_after from public.checkout_sessions where customer_id = v_cust;
  if v_after <> v_before then raise exception 'CASE C2 FAILED: a session row was left behind'; end if;
  raise notice 'CASE C2 ok: refused before payment with the order_items message';
end $$;

-- ===========================================================================
-- C3. The cash path refuses the same note the same way (unchanged), so both
--     paths now agree.
-- ===========================================================================
do $$
declare v_state text; v_msg text;
begin
  perform set_config('test.auth_uid', current_setting('prr.c'), false);
  begin
    perform public.place_order('b0000000-0000-0000-0000-000000000001', 'pickup',
      jsonb_build_array(jsonb_build_object('product_id', 'a0000000-0000-0000-0000-000000000003',
        'quantity', 1, 'note', repeat('n', 141))),
      p_payment_method => 'cash');
    v_state := 'accepted';
  exception when others then
    v_state := sqlstate; v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001' or v_msg is distinct from 'Item note is too long' then
    raise exception 'CASE C3 FAILED: cash path gave % (%)', v_state, v_msg;
  end if;
  raise notice 'CASE C3 ok: cash and card refuse the same note with the same message';
end $$;

-- ===========================================================================
-- C4. A historical session that already carries an over-long note stays
--     updatable on every other column; changing its snapshot is refused.
-- ===========================================================================
do $$
declare
  v_cust  uuid := current_setting('prr.c')::uuid;
  v_id    uuid;
  v_state text;
begin
  alter table public.checkout_sessions disable trigger trg_checkout_sessions_item_note_length;
  insert into public.checkout_sessions (customer_id, order_type, payment_method, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'online', 'b0000000-0000-0000-0000-000000000001',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('note', repeat('h', 300)))), 12.00, 12.00)
    returning id into v_id;
  alter table public.checkout_sessions enable trigger trg_checkout_sessions_item_note_length;

  update public.checkout_sessions set status = 'expired' where id = v_id;
  if (select status from public.checkout_sessions where id = v_id) is distinct from 'expired' then
    raise exception 'CASE C4 FAILED: a status update on a legacy session did not land';
  end if;
  -- Writing the same snapshot back is not a change, so it is let through.
  update public.checkout_sessions set snapshot = snapshot where id = v_id;

  begin
    update public.checkout_sessions
       set snapshot = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('note', repeat('h', 301))))
     where id = v_id;
    v_state := 'accepted';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'CASE C4 FAILED: changing the snapshot to an over-long note gave %', v_state;
  end if;
  raise notice 'CASE C4 ok: legacy rows stay updatable; a new over-long snapshot is refused';
end $$;

-- ===========================================================================
-- C5. A snapshot without items, or with non-object items, is not refused.
-- ===========================================================================
do $$
declare v_cust uuid := current_setting('prr.c')::uuid;
begin
  insert into public.checkout_sessions (customer_id, order_type, payment_method, branch_id, snapshot, subtotal, total)
    values (v_cust, 'pickup', 'online', 'b0000000-0000-0000-0000-000000000001', '{}'::jsonb, 1.00, 1.00),
           (v_cust, 'pickup', 'online', 'b0000000-0000-0000-0000-000000000001',
            '{"items": [1, "x", null, {"note": null}, {"quantity": 1}]}'::jsonb, 1.00, 1.00);
  raise notice 'CASE C5 ok: snapshots with no notes are accepted';
end $$;

rollback;
