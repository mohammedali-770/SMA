-- ============================================================================
-- Order-note length tests (migration
-- 20260819120000_order_note_length_limit.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied (same
-- harness as the address-description suite). Each case RAISES EXCEPTION on
-- failure, so the script aborts non-zero if any assertion fails; a clean run
-- prints NOTICEs and commits nothing (wrapped in a rollback).
--
-- Invariant under test: no row in public.orders or public.checkout_sessions can
-- be created — or have its note changed to — a note longer than 280 characters
-- after trimming, while an absent note stays legal and rows written before the
-- rule existed stay updatable on their other columns.
--
-- The point of this suite is that the rule is enforced by the DATABASE, not by
-- the mobile app. place_customer_order is granted to `authenticated`, so a
-- signed-in customer can call it directly and the UI limit is not a control.
-- ============================================================================
begin;

-- Fixture: a customer and a branch, the two FKs an order row needs.
do $$
declare
  v_cust   uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_cust, 'note-test@example.com')
    on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role)
    values (v_cust, 'Note Tester', '+966500000091', 'customer')
    on conflict (id) do update set full_name = excluded.full_name;
  insert into public.branches (id, name_en, name_ar)
    values (v_branch, 'Note Branch', 'فرع الملاحظات')
    on conflict (id) do nothing;
  perform set_config('sma.note_customer', v_cust::text, true);
  perform set_config('sma.note_branch', v_branch::text, true);
end $$;

-- Case 1: the predicate itself — the single source of truth both halves share.
do $$
begin
  -- The note is optional, so absence must stay legal. Account deletion and the
  -- erasure job both `set notes = null`; rejecting null would break them.
  if not public.order_note_is_acceptable(null) then
    raise exception 'CASE 1 FAILED: null rejected — erasure jobs would break';
  end if;
  if not public.order_note_is_acceptable('') then
    raise exception 'CASE 1 FAILED: empty string rejected';
  end if;
  if not public.order_note_is_acceptable('no onions') then
    raise exception 'CASE 1 FAILED: an ordinary instruction was rejected';
  end if;
  if not public.order_note_is_acceptable(repeat('x', 280)) then
    raise exception 'CASE 1 FAILED: exactly-max value rejected';
  end if;
  if public.order_note_is_acceptable(repeat('x', 281)) then
    raise exception 'CASE 1 FAILED: over-length value accepted';
  end if;

  -- Trimming is measured, so padding cannot push a legal note over the line...
  if not public.order_note_is_acceptable('   ' || repeat('x', 280) || '   ') then
    raise exception 'CASE 1 FAILED: padded exactly-max value rejected';
  end if;
  -- ...and cannot be used to smuggle one under it. Single-argument btrim()
  -- strips SPACES ONLY; this is the bug 20260802120000 had to fix for
  -- addresses.description, so every whitespace character is asserted by code
  -- point rather than by an escape sequence.
  if public.order_note_is_acceptable(
       chr(9) || chr(10) || repeat('x', 281) || chr(13) || chr(11) || chr(12)) then
    raise exception 'CASE 1 FAILED: tab/newline-padded over-length value accepted';
  end if;
  if public.order_note_is_acceptable(chr(160) || repeat('x', 281) || chr(160)) then
    raise exception 'CASE 1 FAILED: NBSP-padded over-length value accepted';
  end if;

  -- REGRESSION: the trim set must not contain the LETTER v. PostgreSQL has no
  -- \v escape, so E'\v' is ascii 118 — writing the set as an escape string
  -- makes btrim eat "v" from "veg only", and lets a 281-character note that
  -- starts with "v" trim its way under the limit.
  if public.order_note_is_acceptable('v' || repeat('x', 280)) then
    raise exception 'CASE 1 FAILED: 281 characters accepted because a leading v was trimmed';
  end if;
  if public.order_note_is_acceptable(repeat('x', 280) || 'v') then
    raise exception 'CASE 1 FAILED: 281 characters accepted because a trailing v was trimmed';
  end if;

  -- char_length() counts characters, matching the client's String.length.
  if not public.order_note_is_acceptable(repeat('ب', 280)) then
    raise exception 'CASE 1 FAILED: 280 Arabic characters rejected (byte-counted?)';
  end if;
  if public.order_note_is_acceptable(repeat('ب', 281)) then
    raise exception 'CASE 1 FAILED: 281 Arabic characters accepted';
  end if;

  raise notice 'CASE 1 ok: predicate bounds the note at 280 trimmed characters';
end $$;

-- Case 2: public.orders — INSERT is rejected when the note is too long.
do $$
declare
  v_cust   uuid := current_setting('sma.note_customer')::uuid;
  v_branch uuid := current_setting('sma.note_branch')::uuid;
begin
  begin
    insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                               payment_method, payment_status, customer_phone, notes)
      values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091',
              repeat('x', 281));
    raise exception 'CASE 2 FAILED: insert with a 281-character note succeeded';
  exception when check_violation then null;
  end;

  -- Exactly the maximum must still be accepted.
  insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, customer_phone, notes)
    values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091',
            repeat('x', 280));

  -- And so must no note at all.
  insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, customer_phone, notes)
    values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091', null);

  raise notice 'CASE 2 ok: orders rejects an over-long note, accepts max and null';
end $$;

-- Case 3: public.orders — the stored value is trimmed, and padding-only becomes null.
do $$
declare
  v_cust   uuid := current_setting('sma.note_customer')::uuid;
  v_branch uuid := current_setting('sma.note_branch')::uuid;
  v_id     uuid;
  v_stored text;
begin
  insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, customer_phone, notes)
    values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091',
            E'  \t no onions \n ')
    returning id into v_id;
  select notes into v_stored from public.orders where id = v_id;
  if v_stored is distinct from 'no onions' then
    raise exception 'CASE 3 FAILED: note stored as %, expected trimmed value', quote_literal(v_stored);
  end if;

  -- A whitespace-only note is not a note; a cashier must not see a blank line.
  insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, customer_phone, notes)
    values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091',
            E' \t\n ')
    returning id into v_id;
  select notes into v_stored from public.orders where id = v_id;
  if v_stored is not null then
    raise exception 'CASE 3 FAILED: whitespace-only note stored as %, expected null', quote_literal(v_stored);
  end if;

  -- REGRESSION: an ordinary note that begins or ends with "v" must survive
  -- intact. "veg only" and "vanilla shake" are ordinary kitchen instructions.
  for v_stored in
    select unnest(array['veg only', 'vanilla shake', 'v', 'no veg'])
  loop
    insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                               payment_method, payment_status, customer_phone, notes)
      values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091', v_stored)
      returning id into v_id;
    if (select notes from public.orders where id = v_id) is distinct from v_stored then
      raise exception 'CASE 3 FAILED: note % was mangled to %',
        quote_literal(v_stored),
        quote_literal((select notes from public.orders where id = v_id));
    end if;
  end loop;

  -- A note of vertical tabs alone is whitespace, not a note.
  insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, customer_phone, notes)
    values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091',
            chr(11) || chr(11) || chr(160))
    returning id into v_id;
  select notes into v_stored from public.orders where id = v_id;
  if v_stored is not null then
    raise exception 'CASE 3 FAILED: vertical-tab/NBSP-only note stored as %, expected null', quote_literal(v_stored);
  end if;

  raise notice 'CASE 3 ok: stored note is trimmed, whitespace-only becomes null, v-notes intact';
end $$;

-- Case 4: an UPDATE that changes the note is guarded; one that does not is NOT.
-- This is why the rule is a trigger rather than a CHECK constraint: public.orders
-- is updated constantly on unrelated columns (POS sync state, confirmation
-- lifecycle, cancellation integrity), and a CHECK would re-fire on every one of
-- them for any historical row carrying an over-long note.
do $$
declare
  v_cust   uuid := current_setting('sma.note_customer')::uuid;
  v_branch uuid := current_setting('sma.note_branch')::uuid;
  v_id     uuid;
begin
  insert into public.orders (customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, customer_phone, notes)
    values (v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending', '+966500000091', 'ok')
    returning id into v_id;

  begin
    update public.orders set notes = repeat('x', 281) where id = v_id;
    raise exception 'CASE 4 FAILED: updating the note to 281 characters succeeded';
  exception when check_violation then null;
  end;

  -- A legacy row is simulated by disabling the trigger for one statement, the
  -- only way to create the state the rule is designed to tolerate.
  alter table public.orders disable trigger trg_orders_note_length;
  update public.orders set notes = repeat('x', 900) where id = v_id;
  alter table public.orders enable trigger trg_orders_note_length;

  -- The whole point: this must still work despite the over-long note.
  update public.orders set payment_status = 'paid' where id = v_id;

  -- Erasure must still work too — it sets notes = null on exactly such rows.
  update public.orders set notes = null where id = v_id;

  raise notice 'CASE 4 ok: note-updates guarded, unrelated updates and erasure unaffected';
end $$;

-- Case 5: public.checkout_sessions is guarded at the same bound.
-- Guarding only public.orders would move the failure past the point of no
-- return: finalize_checkout_session inserts the order AFTER the provider has
-- captured, and a failure there is retried forever against a session that can
-- never succeed. The note is refused when the session is created instead.
do $$
declare
  v_cust   uuid := current_setting('sma.note_customer')::uuid;
  v_branch uuid := current_setting('sma.note_branch')::uuid;
  v_id     uuid;
  v_stored text;
begin
  begin
    insert into public.checkout_sessions (customer_id, branch_id, order_type,
                                          snapshot, subtotal, total, notes)
      values (v_cust, v_branch, 'pickup', '{}'::jsonb, 50, 50, repeat('x', 281));
    raise exception 'CASE 5 FAILED: session with a 281-character note succeeded';
  exception when check_violation then null;
  end;

  insert into public.checkout_sessions (customer_id, branch_id, order_type,
                                        snapshot, subtotal, total, notes)
    values (v_cust, v_branch, 'pickup', '{}'::jsonb, 50, 50, E'  extra spicy  ')
    returning id into v_id;
  select notes into v_stored from public.checkout_sessions where id = v_id;
  if v_stored is distinct from 'extra spicy' then
    raise exception 'CASE 5 FAILED: session note stored as %, expected trimmed value', quote_literal(v_stored);
  end if;

  raise notice 'CASE 5 ok: checkout_sessions bounded and trimmed at the same limit';
end $$;

-- Case 6: the guard is attached where it is claimed to be.
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from pg_trigger
  where not tgisinternal
    and tgname in ('trg_orders_note_length', 'trg_checkout_sessions_note_length')
    and tgrelid in ('public.orders'::regclass, 'public.checkout_sessions'::regclass);
  if v_count <> 2 then
    raise exception 'CASE 6 FAILED: expected 2 note-length triggers, found %', v_count;
  end if;

  -- The helper predicate must not be callable by a client role; it is internal.
  if has_function_privilege('anon', 'public.order_note_is_acceptable(text)', 'execute')
     or has_function_privilege('authenticated', 'public.order_note_is_acceptable(text)', 'execute') then
    raise exception 'CASE 6 FAILED: order_note_is_acceptable is executable by a client role';
  end if;

  raise notice 'CASE 6 ok: both triggers attached, helper not client-executable';
end $$;

rollback;
