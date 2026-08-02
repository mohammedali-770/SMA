-- ============================================================================
-- Tap reference_order opacity tests (migration
-- 20260724180000_tap_reference_order_opaque.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied. Each
-- case RAISES EXCEPTION on failure; a clean run prints NOTICEs and commits
-- nothing (wrapped in a rollback).
--
-- Invariant under test: no newly opened Tap attempt stores the internal SM-…
-- order number as its reference_order, while the one-active-attempt and reuse
-- behaviour that makes retries idempotent is unchanged.
--
-- No provider is contacted: tap_begin_payment_attempt only writes a
-- payment_records row. Nothing here schedules or invokes the refund worker.
-- ============================================================================
begin;


-- A branch to hang test orders on. `orders.branch_id` is a real FK to
-- public.branches, and every case below cares about sync / payment / integrity
-- state rather than about WHICH branch, so one fixed row serves all of them.
-- Self-contained on purpose: not the seed's branch, so the suite does not
-- depend on supabase/seed.sql having been loaded.
insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000ff', 'Suite Branch', 'فرع الاختبار')
on conflict (id) do nothing;

-- The generated shape of the internal id, matched as a VALUE not a column name,
-- so any writer that concatenates it into free text is caught.
create or replace function pg_temp.has_sm_number(p text)
returns boolean language sql immutable as $$
  select p is not null and p ~ 'SM-[0-9]{4}-[0-9]{4,}';
$$;

do $$
begin
  if not pg_temp.has_sm_number('SM-2026-000032') then
    raise exception 'GUARD FAILED: detector does not match a real internal number';
  end if;
  if pg_temp.has_sm_number('ORD-4f2a9c7b1d3e') or pg_temp.has_sm_number('CS-9b8a7c6d5e4f') then
    raise exception 'GUARD FAILED: detector matches an opaque reference';
  end if;
  raise notice 'GUARD ok: SM-… detector is neither vacuous nor over-broad';
end $$;

-- Case 1: a NEW attempt stores an opaque ORD-… reference, never the SM-… number.
do $$
declare
  v_branch uuid := 'b0000000-0000-0000-0000-0000000000ff';
  v_order  uuid;
  v_num    text;
  v_ref    text;
begin
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values (v_branch, 'pickup', 50, 50, 'online', 'pending')
    returning id, order_number into v_order, v_num;

  if not pg_temp.has_sm_number(v_num) then
    raise exception 'CASE 1 PRECONDITION FAILED: order_number % is not SM-shaped', v_num;
  end if;

  select reference_order into v_ref
    from public.tap_begin_payment_attempt(v_order, 'test', 30);

  if v_ref is null then
    raise exception 'CASE 1 FAILED: reference_order is null — the binding was dropped';
  end if;
  if pg_temp.has_sm_number(v_ref) then
    raise exception 'CASE 1 FAILED: reference_order still carries the internal number: %', v_ref;
  end if;
  if v_ref <> 'ORD-' || substr(replace(v_order::text, '-', ''), 1, 12) then
    raise exception 'CASE 1 FAILED: unexpected reference_order shape: %', v_ref;
  end if;
  raise notice 'CASE 1 ok: new attempt stores an opaque ORD-… reference';
end $$;

-- Case 2: the stored row itself is clean (verification reads this, not the return).
do $$
declare
  v_order uuid;
  v_n int;
begin
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'pending')
    returning id into v_order;
  perform public.tap_begin_payment_attempt(v_order, 'test', 30);

  select count(*) into v_n from public.payment_records
   where order_id = v_order and pg_temp.has_sm_number(reference_order);
  if v_n <> 0 then raise exception 'CASE 2 FAILED: % stored rows carry the internal number', v_n; end if;

  -- reference_transaction must stay opaque too.
  select count(*) into v_n from public.payment_records
   where order_id = v_order and pg_temp.has_sm_number(reference_transaction);
  if v_n <> 0 then raise exception 'CASE 2 FAILED: reference_transaction carries the internal number'; end if;

  raise notice 'CASE 2 ok: stored payment_records row is free of the internal number';
end $$;

-- Case 3: RETRY IDEMPOTENCY — a second call reuses the live attempt rather than
--         opening a second charge, and returns the SAME reference.
do $$
declare
  v_order uuid;
  v_ref1 text; v_ref2 text; v_reused boolean; v_n int;
begin
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'pending')
    returning id into v_order;

  select reference_order into v_ref1 from public.tap_begin_payment_attempt(v_order, 'test', 30);
  select reference_order, reused into v_ref2, v_reused
    from public.tap_begin_payment_attempt(v_order, 'test', 30);

  if not v_reused then raise exception 'CASE 3 FAILED: second call did not reuse the live attempt'; end if;
  if v_ref1 <> v_ref2 then raise exception 'CASE 3 FAILED: retry changed the binding value'; end if;

  select count(*) into v_n from public.payment_records
   where order_id = v_order and provider = 'tap' and status = 'initiated';
  if v_n <> 1 then raise exception 'CASE 3 FAILED: % live attempts exist, expected exactly 1', v_n; end if;

  raise notice 'CASE 3 ok: retry is idempotent and cannot open a duplicate charge';
end $$;

-- Case 4: PRE-MIGRATION attempts are not rewritten. Verification compares a
--         charge against the reference stored on its OWN attempt, so an
--         in-flight charge opened before this migration must keep its value.
do $$
declare
  v_order uuid;
  v_pr uuid;
  v_ref text;
begin
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'pending')
    returning id into v_order;

  -- Simulate a row written by the old definition.
  insert into public.payment_records
    (order_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
  values
    (v_order, 'tap', 'initiated', 50, 'SAR', 'test', 'sm_legacy', 'SM-2026-000099', now(), now() + interval '30 minutes')
  returning id into v_pr;

  -- Reuse path must hand back the row's OWN stored reference, untouched.
  select reference_order into v_ref from public.tap_begin_payment_attempt(v_order, 'test', 30);
  if v_ref <> 'SM-2026-000099' then
    raise exception 'CASE 4 FAILED: legacy in-flight reference was rewritten to %', v_ref;
  end if;

  select reference_order into v_ref from public.payment_records where id = v_pr;
  if v_ref <> 'SM-2026-000099' then
    raise exception 'CASE 4 FAILED: stored legacy row was mutated';
  end if;

  raise notice 'CASE 4 ok: legacy in-flight attempts keep verifying against their own value';
end $$;

-- Case 5: the grant contract is unchanged — service_role only.
do $$
declare v_ok boolean;
begin
  select has_function_privilege('service_role', 'public.tap_begin_payment_attempt(uuid, text, integer)', 'EXECUTE')
    into v_ok;
  if not v_ok then raise exception 'CASE 5 FAILED: service_role lost EXECUTE'; end if;

  select has_function_privilege('authenticated', 'public.tap_begin_payment_attempt(uuid, text, integer)', 'EXECUTE')
    into v_ok;
  if v_ok then raise exception 'CASE 5 FAILED: authenticated must NOT execute this function'; end if;

  select has_function_privilege('anon', 'public.tap_begin_payment_attempt(uuid, text, integer)', 'EXECUTE')
    into v_ok;
  if v_ok then raise exception 'CASE 5 FAILED: anon must NOT execute this function'; end if;

  raise notice 'CASE 5 ok: grant contract unchanged (service_role only)';
end $$;

-- Case 6: no order-linked Tap attempt anywhere in this transaction leaked the
--         number — a sweep rather than a per-case check.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.payment_records
   where pg_temp.has_sm_number(reference_order)
     and reference_order <> 'SM-2026-000099';  -- the deliberate legacy fixture
  if v_n <> 0 then raise exception 'CASE 6 FAILED: % attempts carry the internal number', v_n; end if;
  raise notice 'CASE 6 ok: sweep clean';
end $$;

-- Case 7: SCOPE OF THE VALUE — reference_order is PER-ORDER, reference_transaction
--         is PER-ATTEMPT. Two genuinely separate attempts for the same order
--         (the first expired, so the one-active-attempt rule permits a second)
--         share the order reference and differ on the transaction reference.
do $$
declare
  v_order uuid;
  v_ord1 text; v_txn1 text; v_ord2 text; v_txn2 text;
  v_reused boolean;
begin
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'pending')
    returning id into v_order;

  select reference_order, reference_transaction into v_ord1, v_txn1
    from public.tap_begin_payment_attempt(v_order, 'test', 30);

  -- Force the first attempt stale so a genuinely separate second one is allowed.
  update public.payment_records set expires_at = now() - interval '1 minute'
   where order_id = v_order and status = 'initiated';

  select reference_order, reference_transaction, reused into v_ord2, v_txn2, v_reused
    from public.tap_begin_payment_attempt(v_order, 'test', 30);

  if v_reused then
    raise exception 'CASE 7 PRECONDITION FAILED: expected a NEW attempt, got a reuse';
  end if;
  if v_ord1 <> v_ord2 then
    raise exception 'CASE 7 FAILED: reference_order is not stable per order (% vs %)', v_ord1, v_ord2;
  end if;
  if v_txn1 = v_txn2 then
    raise exception 'CASE 7 FAILED: reference_transaction repeated across attempts (%)', v_txn1;
  end if;
  if pg_temp.has_sm_number(v_ord2) or pg_temp.has_sm_number(v_txn2) then
    raise exception 'CASE 7 FAILED: second attempt leaked the internal number';
  end if;

  -- The first attempt was expired, not deleted: exactly one live attempt remains.
  if (select count(*) from public.payment_records
       where order_id = v_order and provider = 'tap' and status = 'initiated') <> 1 then
    raise exception 'CASE 7 FAILED: more than one live attempt exists';
  end if;

  raise notice 'CASE 7 ok: reference_order per-ORDER, reference_transaction per-ATTEMPT';
end $$;

-- Case 8: MISMATCH REJECTION — the binding is an exact comparison, so a charge
--         quoting a different reference must not match the stored attempt.
--         (Mirrors validateAndConfirmTapCharge''s refOrderMatch/refTxnMatch.)
do $$
declare
  v_order uuid;
  v_ord text; v_txn text;
begin
  insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
    values ('b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'pending')
    returning id into v_order;
  select reference_order, reference_transaction into v_ord, v_txn
    from public.tap_begin_payment_attempt(v_order, 'test', 30);

  if v_ord = 'ORD-000000000000' then
    raise exception 'CASE 8 FAILED: a foreign reference equals the stored one';
  end if;
  if v_txn = 'sm_forged' then
    raise exception 'CASE 8 FAILED: a forged transaction ref equals the stored one';
  end if;
  -- A reference for a DIFFERENT order must never match this attempt.
  if v_ord = 'ORD-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) then
    raise exception 'CASE 8 FAILED: reference collided with an unrelated order';
  end if;

  raise notice 'CASE 8 ok: foreign/forged references do not match the stored binding';
end $$;

-- Case 9: TRUNCATION DISTINCTNESS — 12 hex chars is a truncation, so prove the
--         derivation still separates distinct orders across a sample. This cannot
--         disprove the birthday bound (~2^24 orders); it catches a derivation
--         regression that would make references constant or highly clustered.
do $$
declare
  v_order uuid;
  v_ord   text;
  v_seen  text[] := '{}';
  i int;
begin
  for i in 1..200 loop
    insert into public.orders (branch_id, order_type, subtotal, total, payment_method, payment_status)
      values ('b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'pending')
      returning id into v_order;
    select reference_order into v_ord from public.tap_begin_payment_attempt(v_order, 'test', 30);

    if v_ord = any(v_seen) then
      raise exception 'CASE 9 FAILED: duplicate reference % after % orders', v_ord, i;
    end if;
    if length(v_ord) <> 16 then   -- 'ORD-' + 12 hex
      raise exception 'CASE 9 FAILED: unexpected reference length % for %', length(v_ord), v_ord;
    end if;
    if v_ord !~ '^ORD-[0-9a-f]{12}$' then
      raise exception 'CASE 9 FAILED: unexpected reference shape %', v_ord;
    end if;
    v_seen := v_seen || v_ord;
  end loop;
  raise notice 'CASE 9 ok: 200 distinct orders -> 200 distinct 48-bit references';
end $$;

rollback;
