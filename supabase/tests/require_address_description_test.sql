-- ============================================================================
-- Mandatory delivery-guidance tests (migration
-- 20260724170000_require_address_description.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied (same
-- harness as the lazywait/account-deletion suites). Each case RAISES EXCEPTION
-- on failure, so the script aborts non-zero if any assertion fails; a clean run
-- prints NOTICEs and commits nothing (wrapped in a rollback).
--
-- Invariant under test: an address row can never be created — or have its
-- description changed to — an empty, whitespace-only or too-short value, while
-- rows saved BEFORE the rule existed stay updatable on their other columns.
-- ============================================================================
begin;

-- A customer to own the addresses. profiles/addresses are RLS-protected but
-- these tests run as the migration owner, so RLS is not the subject here.
do $$
declare v_cust uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_cust, 'desc-test@example.com')
    on conflict (id) do nothing;
  perform set_config('sma.test_customer', v_cust::text, true);
exception when undefined_table then
  -- Some harnesses seed auth.users differently; fall back to a bare uuid and
  -- let the FK (if any) be satisfied by the seed data.
  perform set_config('sma.test_customer', gen_random_uuid()::text, true);
end $$;

-- Case 1: the predicate itself — the single source of truth both halves share.
do $$
begin
  if public.address_description_is_usable(null) then
    raise exception 'CASE 1 FAILED: null accepted';
  end if;
  if public.address_description_is_usable('') then
    raise exception 'CASE 1 FAILED: empty string accepted';
  end if;
  if public.address_description_is_usable('     ') then
    raise exception 'CASE 1 FAILED: whitespace-only accepted';
  end if;
  if public.address_description_is_usable(E'\t\n  \t') then
    raise exception 'CASE 1 FAILED: tab/newline-only accepted';
  end if;
  if public.address_description_is_usable('abc') then
    raise exception 'CASE 1 FAILED: too-short value accepted';
  end if;
  if public.address_description_is_usable('  ab  ') then
    raise exception 'CASE 1 FAILED: padding counted toward the minimum';
  end if;
  if not public.address_description_is_usable('blue gate beside the pharmacy') then
    raise exception 'CASE 1 FAILED: valid guidance rejected';
  end if;
  if not public.address_description_is_usable('  المبنى الأزرق المدخل الثاني  ') then
    raise exception 'CASE 1 FAILED: valid Arabic guidance rejected';
  end if;
  if public.address_description_is_usable(repeat('x', 501)) then
    raise exception 'CASE 1 FAILED: over-length value accepted';
  end if;
  if not public.address_description_is_usable(repeat('x', 500)) then
    raise exception 'CASE 1 FAILED: exactly-max value rejected';
  end if;
  raise notice 'CASE 1 ok: predicate accepts only usable guidance';
end $$;

-- Case 2: INSERT is rejected without usable guidance (the customer create path).
do $$
declare
  v_cust uuid := current_setting('sma.test_customer')::uuid;
begin
  begin
    insert into public.addresses (customer_id, latitude, longitude, description)
      values (v_cust, 24.7136, 46.6753, null);
    raise exception 'CASE 2 FAILED: insert with null description succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into public.addresses (customer_id, latitude, longitude, description)
      values (v_cust, 24.7136, 46.6753, '   ');
    raise exception 'CASE 2 FAILED: insert with whitespace-only description succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into public.addresses (customer_id, latitude, longitude, description)
      values (v_cust, 24.7136, 46.6753, 'abc');
    raise exception 'CASE 2 FAILED: insert with too-short description succeeded';
  exception when check_violation then null;
  end;

  -- An insert that omits the column entirely must fail too — this is exactly
  -- what the Checkout screen used to do.
  begin
    insert into public.addresses (customer_id, latitude, longitude)
      values (v_cust, 24.7136, 46.6753);
    raise exception 'CASE 2 FAILED: insert omitting description succeeded';
  exception when check_violation then null;
  end;

  raise notice 'CASE 2 ok: create path rejects empty/whitespace/short/omitted';
end $$;

-- Case 3: a valid value is accepted AND stored trimmed.
do $$
declare
  v_cust uuid := current_setting('sma.test_customer')::uuid;
  v_id uuid;
  v_desc text;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7136, 46.6753, '   blue gate beside the pharmacy   ')
    returning id into v_id;

  select description into v_desc from public.addresses where id = v_id;
  if v_desc <> 'blue gate beside the pharmacy' then
    raise exception 'CASE 3 FAILED: description not trimmed on store, got %', quote_literal(v_desc);
  end if;
  raise notice 'CASE 3 ok: valid guidance accepted and trimmed';
end $$;

-- Case 4: UPDATE of description is guarded; UPDATE of OTHER columns is not.
--         This is the reason the migration uses a trigger rather than a CHECK:
--         a CHECK is re-evaluated on every later UPDATE of a historical row, so
--         toggling is_default on a pre-rule address would fail on a column the
--         update never touched.
do $$
declare
  v_cust uuid := current_setting('sma.test_customer')::uuid;
  v_id uuid;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7136, 46.6753, 'blue gate beside the pharmacy')
    returning id into v_id;

  begin
    update public.addresses set description = '   ' where id = v_id;
    raise exception 'CASE 4 FAILED: clearing description to whitespace succeeded';
  exception when check_violation then null;
  end;

  begin
    update public.addresses set description = null where id = v_id;
    raise exception 'CASE 4 FAILED: nulling description succeeded';
  exception when check_violation then null;
  end;

  -- Unrelated column: must succeed.
  update public.addresses set is_default = true where id = v_id;

  raise notice 'CASE 4 ok: description updates guarded, other columns free';
end $$;

-- Case 5: PRE-MIGRATION rows. Deliberate, documented behaviour — historical
--         addresses with a null description keep working for everything except
--         a description change. The app routes such an address into the editor
--         rather than blocking the customer (see chooseSavedAddress).
do $$
declare
  v_cust uuid := current_setting('sma.test_customer')::uuid;
  v_id uuid := gen_random_uuid();
  v_left text;
begin
  -- Simulate a row that predates the rule by inserting with the trigger off.
  alter table public.addresses disable trigger trg_addresses_require_description;
  insert into public.addresses (id, customer_id, latitude, longitude, description)
    values (v_id, v_cust, 24.7136, 46.6753, null);
  alter table public.addresses enable trigger trg_addresses_require_description;

  -- It survives, unmodified.
  select description into v_left from public.addresses where id = v_id;
  if v_left is not null then
    raise exception 'CASE 5 FAILED: historical row was rewritten by the migration';
  end if;

  -- It stays updatable on other columns (the CHECK-constraint failure mode).
  update public.addresses set is_default = false where id = v_id;

  -- But it cannot be given a bad description.
  begin
    update public.addresses set description = 'ab' where id = v_id;
    raise exception 'CASE 5 FAILED: historical row accepted a bad description';
  exception when check_violation then null;
  end;

  -- And it CAN be repaired with a good one.
  update public.addresses set description = 'white tower, entrance C' where id = v_id;

  raise notice 'CASE 5 ok: pre-migration rows preserved, updatable, repairable';
end $$;

-- Case 6: the objects the migration is supposed to have created exist, with the
--         trigger bound to the right events. Guards a partial apply.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'address_description_is_usable';
  if v_n <> 1 then raise exception 'CASE 6 FAILED: predicate function missing'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_address_description';
  if v_n <> 1 then raise exception 'CASE 6 FAILED: trigger function missing'; end if;

  select count(*) into v_n from pg_trigger
   where tgname = 'trg_addresses_require_description'
     and tgrelid = 'public.addresses'::regclass
     and not tgisinternal;
  if v_n <> 1 then raise exception 'CASE 6 FAILED: trigger not bound to public.addresses'; end if;

  raise notice 'CASE 6 ok: migration objects present and bound';
end $$;

-- Case 7: ROLLBACK leaves no partial schema. Applies the documented rollback
--         block, asserts the schema is clean, then restores the objects so the
--         rest of the suite (and any later file) sees the migrated state.
do $$
declare v_n int;
begin
  drop trigger if exists trg_addresses_require_description on public.addresses;
  drop function if exists public.enforce_address_description();
  drop function if exists public.address_description_is_usable(text);

  select count(*) into v_n from pg_trigger
   where tgname = 'trg_addresses_require_description' and not tgisinternal;
  if v_n <> 0 then raise exception 'CASE 7 FAILED: trigger survived rollback'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('enforce_address_description', 'address_description_is_usable');
  if v_n <> 0 then raise exception 'CASE 7 FAILED: functions survived rollback'; end if;

  -- After rollback the column must still be plain nullable text — the migration
  -- must not have left a type/constraint change behind.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'addresses'
     and column_name = 'description' and is_nullable = 'YES' and data_type = 'text';
  if v_n <> 1 then raise exception 'CASE 7 FAILED: description column altered by the migration'; end if;

  raise notice 'CASE 7 ok: rollback is clean and leaves no partial schema';
end $$;

rollback;
