-- ============================================================================
-- Per-item kitchen notes (migration 20260821170000_order_item_notes).
--
-- Runs against a throwaway Postgres with all migrations applied. Transactional
-- (begin; … rollback;); each case RAISES on failure.
--
-- Invariants under test:
--   A. The column exists, and the bound is enforced by a trigger rather than
--      trusted to callers.
--   B. The bound is SHORTER than the order-note bound, and "empty" normalizes
--      to NULL through the same helper the order note uses.
--   C. ALL THREE write paths carry the note. This is the one that matters:
--      place_order, compute_order_snapshot and insert_order_from_snapshot are
--      each ~300, ~90 and ~80 lines that get copied wholesale into a new
--      migration whenever any of them changes. The note is one line inside each.
--      A future migration that redefines one of them from an older copy would
--      silently drop per-item notes on that path only — cash orders keep their
--      notes while online orders lose them, or the reverse — with nothing
--      failing and no error anywhere. These assertions are what makes that
--      loud.
-- ============================================================================

begin;

-- ---- A. The column and its guard ------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_items' and column_name = 'note'
  ) then
    raise exception 'FAIL A1: order_items.note is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.order_items'::regclass
      and tgname = 'trg_enforce_order_item_note'
      and not tgisinternal
  ) then
    raise exception 'FAIL A2: the item-note trigger is not installed';
  end if;
  raise notice 'CASE A ok: column present and guarded by a trigger';
end $$;

-- ---- A2. The column GRANTS -------------------------------------------------
-- The one that bites hardest, and the reason this case exists.
-- 20260724200000 replaced table-wide SELECT with an explicit column list per
-- table, so a new column is NOT readable by `authenticated` merely because it
-- exists. PostgREST does not omit a column it may not read — it rejects the
-- WHOLE select — so a missing grant here does not hide the note, it breaks the
-- entire receipt and My Orders for every signed-in customer.
do $$
begin
  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'notes' and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'FAIL A3: authenticated cannot select orders.notes — the customer order read will fail outright';
  end if;

  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'order_items'
      and column_name = 'note' and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'FAIL A4: authenticated cannot select order_items.note — the customer order read will fail outright';
  end if;

  -- The grant must WIDEN nothing else. These stayed internal on purpose.
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'orders'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
      and column_name in ('order_number', 'customer_phone', 'pos_create_attempt_token', 'address_snapshot')
  ) then
    raise exception 'FAIL A5: an internal orders column became selectable by authenticated';
  end if;
  raise notice 'CASE A2 ok: both note columns are readable by their owner, nothing else widened';
end $$;

-- ---- A3. Staff can actually READ the item note -----------------------------
-- Storing a note nobody serves is worse than not offering one: the customer is
-- told the instruction was accepted and no staff surface shows it.
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_list_orders_with_items';
  if v_src is null then
    raise exception 'FAIL A6: admin_list_orders_with_items is missing';
  end if;
  if v_src not like '%''note'', i.note%' then
    raise exception 'FAIL A6: the staff order projection dropped the per-item note — the kitchen cannot see it';
  end if;
  raise notice 'CASE A3 ok: the staff projection carries the per-item note';
end $$;

-- ---- B. The bound, and the shared normalizer -------------------------------
do $$
declare
  v_at_limit text := repeat('x', 140);
  v_over     text := repeat('x', 141);
begin
  -- Optional: absent is acceptable, and must not make the predicate NULL.
  if not public.order_item_note_is_acceptable(null) then
    raise exception 'FAIL B1: a NULL item note must be acceptable';
  end if;
  if not public.order_item_note_is_acceptable('') then
    raise exception 'FAIL B2: an empty item note must be acceptable';
  end if;

  -- Inclusive at the limit, exclusive past it.
  if not public.order_item_note_is_acceptable(v_at_limit) then
    raise exception 'FAIL B3: a note of exactly the limit must be acceptable';
  end if;
  if public.order_item_note_is_acceptable(v_over) then
    raise exception 'FAIL B4: a note past the limit must be rejected';
  end if;

  -- Whitespace is trimmed BEFORE measuring, so padding cannot smuggle length
  -- past the bound and cannot push an in-range note over it either.
  if not public.order_item_note_is_acceptable('   ' || v_at_limit || '   ') then
    raise exception 'FAIL B5: surrounding whitespace must not count toward the bound';
  end if;

  -- The same normalizer as the ORDER note: one definition of "empty means none".
  if public.order_note_normalized('   ') is not null then
    raise exception 'FAIL B6: whitespace must normalize to NULL';
  end if;

  -- The item bound must stay under the order-note bound. If someone raises this
  -- to 280 the two notes become interchangeable and the reason for having a
  -- separate, shorter line note is gone.
  if public.order_item_note_is_acceptable(repeat('x', 280)) then
    raise exception 'FAIL B7: the item bound must be shorter than the order-note bound';
  end if;
  raise notice 'CASE B ok: bounded at 140, trimmed, and shorter than the order note';
end $$;

-- ---- C. Every write path carries the note ----------------------------------
do $$
declare
  v_src text;
begin
  -- 1. place_order — cash / direct.
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'place_order';
  if v_src is null then
    raise exception 'FAIL C1: place_order is missing';
  end if;
  if v_src not like '%order_note_normalized(v_item ->> ''note'')%' then
    raise exception 'FAIL C1: place_order no longer writes the per-item note — a redefinition dropped it';
  end if;

  -- 2. compute_order_snapshot — the online snapshot.
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_src is null then
    raise exception 'FAIL C2: compute_order_snapshot is missing';
  end if;
  if v_src not like '%''note'', public.order_note_normalized(v_item ->> ''note'')%' then
    raise exception 'FAIL C2: compute_order_snapshot no longer carries the per-item note into the snapshot';
  end if;

  -- 3. insert_order_from_snapshot — written once payment is verified.
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'insert_order_from_snapshot';
  if v_src is null then
    raise exception 'FAIL C3: insert_order_from_snapshot is missing';
  end if;
  if v_src not like '%order_note_normalized(v_item->>''note'')%' then
    raise exception 'FAIL C3: insert_order_from_snapshot no longer writes the per-item note';
  end if;

  raise notice 'CASE C ok: all three write paths still carry the per-item note';
end $$;

-- ---- D. The trigger actually normalizes and rejects -------------------------
-- Exercised directly on order_items through a minimal real order, so this tests
-- the installed trigger rather than the helper it calls.
do $$
declare
  v_branch  uuid;
  v_order   uuid;
  v_item    uuid;
  v_stored  text;
begin
  select id into v_branch from public.branches limit 1;
  if v_branch is null then
    raise notice 'CASE D skipped: no branch fixture in this database';
    return;
  end if;

  -- order_number is NOT NULL with no default, so the fixture supplies one.
  -- Deliberately not an SM-… shaped value: nothing here should look like a real
  -- internal order number.
  insert into public.orders (order_number, branch_id, status, order_type, subtotal,
                             delivery_fee, discount_amount, loyalty_discount_amount,
                             vat_amount, total)
  values ('TEST-ITEM-NOTE-1', v_branch, 'received', 'pickup', 10, 0, 0, 0, 1.30, 10)
  returning id into v_order;

  -- Whitespace-only becomes NULL rather than a note that looks present.
  insert into public.order_items (order_id, name_en, name_ar, unit_price, quantity, line_total, note)
  values (v_order, 'X', 'س', 10, 1, 10, '    ')
  returning id into v_item;
  select note into v_stored from public.order_items where id = v_item;
  if v_stored is not null then
    raise exception 'FAIL D1: a whitespace-only item note was stored as %', quote_literal(v_stored);
  end if;

  -- Surrounding whitespace is stripped from a real note.
  update public.order_items set note = '  no onion  ' where id = v_item;
  select note into v_stored from public.order_items where id = v_item;
  if v_stored <> 'no onion' then
    raise exception 'FAIL D2: the item note was stored untrimmed as %', quote_literal(v_stored);
  end if;

  -- Past the bound is refused outright, not silently truncated.
  begin
    update public.order_items set note = repeat('x', 141) where id = v_item;
    raise exception 'FAIL D3: an over-long item note was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL D3%' then raise; end if;
  end;

  raise notice 'CASE D ok: the trigger trims, nulls the empty case and refuses the over-long one';
end $$;

rollback;
