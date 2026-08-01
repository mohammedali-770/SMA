-- ============================================================================
-- Single-default-address tests (migration
-- 20260801120000_address_single_default.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied (same
-- harness as the mandatory-landmark / lazywait / account-deletion suites). Each
-- case RAISES EXCEPTION on failure, so the script aborts non-zero if any
-- assertion fails; a clean run prints NOTICEs and commits nothing.
--
-- Invariant under test: a customer holds AT MOST ONE default address, promoting
-- one demotes the previous one in a single write, and one customer's promotion
-- can never touch another customer's book.
--
-- Note: trg_addresses_require_description is active here, so every insert
-- carries a real landmark. That is deliberate — it also proves the two triggers
-- coexist on the same table.
-- ============================================================================
begin;

-- Two customers, so cross-customer isolation is testable.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
begin
  begin
    insert into auth.users (id, email) values
      (v_a, 'default-a@example.com'), (v_b, 'default-b@example.com')
      on conflict (id) do nothing;
  exception when undefined_table then
    null; -- harness seeds auth.users differently; the FK (if any) is satisfied
  end;
  perform set_config('sma.cust_a', v_a::text, true);
  perform set_config('sma.cust_b', v_b::text, true);
end $$;

-- Case 1: the migration objects exist and are bound where they should be.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_single_default_address';
  if v_n <> 1 then raise exception 'CASE 1 FAILED: trigger function missing'; end if;

  select count(*) into v_n from pg_trigger
   where tgname = 'trg_addresses_single_default'
     and tgrelid = 'public.addresses'::regclass
     and not tgisinternal;
  if v_n <> 1 then raise exception 'CASE 1 FAILED: trigger not bound to public.addresses'; end if;

  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'addresses_one_default_per_customer';
  if v_n <> 1 then raise exception 'CASE 1 FAILED: partial unique index missing'; end if;

  -- The landmark trigger from 20260724170000 must still be bound: the two rules
  -- live on the same table and the same events.
  select count(*) into v_n from pg_trigger
   where tgname = 'trg_addresses_require_description'
     and tgrelid = 'public.addresses'::regclass and not tgisinternal;
  if v_n <> 1 then raise exception 'CASE 1 FAILED: landmark trigger lost'; end if;

  raise notice 'CASE 1 ok: migration objects present and bound';
end $$;

-- Case 2: promoting an address demotes the previous default, in ONE write.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_first uuid;
  v_second uuid;
  v_n int;
begin
  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_cust, 24.7136, 46.6753, 'blue gate beside the pharmacy', true)
    returning id into v_first;

  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_cust, 24.7200, 46.6800, 'white tower, entrance C', false)
    returning id into v_second;

  -- The single statement the client issues for "make default".
  update public.addresses set is_default = true where id = v_second;

  select count(*) into v_n from public.addresses
   where customer_id = v_cust and is_default;
  if v_n <> 1 then
    raise exception 'CASE 2 FAILED: expected exactly 1 default, found %', v_n;
  end if;

  if not (select is_default from public.addresses where id = v_second) then
    raise exception 'CASE 2 FAILED: promoted address is not the default';
  end if;
  if (select is_default from public.addresses where id = v_first) then
    raise exception 'CASE 2 FAILED: previous default was not demoted';
  end if;

  raise notice 'CASE 2 ok: promotion demotes the previous default in one write';
end $$;

-- Case 3: INSERTING a new default demotes the existing one (the create path,
--         which is what the address editor uses when "set as default" is on).
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_new uuid;
  v_n int;
begin
  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_cust, 24.7300, 46.6900, 'green mosque, second street', true)
    returning id into v_new;

  select count(*) into v_n from public.addresses where customer_id = v_cust and is_default;
  if v_n <> 1 then
    raise exception 'CASE 3 FAILED: expected exactly 1 default after insert, found %', v_n;
  end if;
  if not (select is_default from public.addresses where id = v_new) then
    raise exception 'CASE 3 FAILED: newly inserted default is not the default';
  end if;

  raise notice 'CASE 3 ok: inserting a default demotes the previous one';
end $$;

-- Case 4: ISOLATION. Customer A's promotion must not touch customer B's book.
do $$
declare
  v_a uuid := current_setting('sma.cust_a')::uuid;
  v_b uuid := current_setting('sma.cust_b')::uuid;
  v_b_default uuid;
  v_a_extra uuid;
begin
  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_b, 24.6000, 46.7000, 'red gate, near the school', true)
    returning id into v_b_default;

  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_a, 24.7400, 46.7100, 'yellow building, third floor', true)
    returning id into v_a_extra;

  if not (select is_default from public.addresses where id = v_b_default) then
    raise exception 'CASE 4 FAILED: another customer''s default was demoted';
  end if;
  if (select count(*) from public.addresses where customer_id = v_b and is_default) <> 1 then
    raise exception 'CASE 4 FAILED: customer B no longer holds exactly one default';
  end if;
  if (select count(*) from public.addresses where customer_id = v_a and is_default) <> 1 then
    raise exception 'CASE 4 FAILED: customer A does not hold exactly one default';
  end if;

  raise notice 'CASE 4 ok: promotion is scoped to one customer';
end $$;

-- Case 5: an unrelated UPDATE must not disturb the default, and re-saving the
--         default as default must stay a no-op (not demote itself).
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_id uuid;
begin
  select id into v_id from public.addresses where customer_id = v_cust and is_default;

  update public.addresses set label = 'Home' where id = v_id;
  if not (select is_default from public.addresses where id = v_id) then
    raise exception 'CASE 5 FAILED: editing the label cleared the default';
  end if;

  -- Idempotent promotion: the trigger's early return, and the index's tolerance
  -- of an unchanged row.
  update public.addresses set is_default = true where id = v_id;
  if (select count(*) from public.addresses where customer_id = v_cust and is_default) <> 1 then
    raise exception 'CASE 5 FAILED: re-promoting the default broke the invariant';
  end if;

  raise notice 'CASE 5 ok: unrelated edits and idempotent promotion are safe';
end $$;

-- Case 6: the INDEX is a real backstop — a write that bypasses the trigger
--         cannot leave two defaults behind.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_other uuid;
begin
  select id into v_other from public.addresses
   where customer_id = v_cust and not is_default limit 1;
  if v_other is null then
    insert into public.addresses (customer_id, latitude, longitude, description, is_default)
      values (v_cust, 24.7500, 46.7200, 'brown door, opposite the bakery', false)
      returning id into v_other;
  end if;

  alter table public.addresses disable trigger trg_addresses_single_default;
  begin
    update public.addresses set is_default = true where id = v_other;
    alter table public.addresses enable trigger trg_addresses_single_default;
    raise exception 'CASE 6 FAILED: a second default was accepted with the trigger off';
  exception when unique_violation then
    alter table public.addresses enable trigger trg_addresses_single_default;
  end;

  raise notice 'CASE 6 ok: the unique index rejects a second default on its own';
end $$;

-- Case 7: the one-time normalization keeps the OLDEST default (the row Checkout
--         was already preselecting) and clears only the extras.
do $$
declare
  v_cust uuid := gen_random_uuid();
  v_old uuid;
  v_new uuid;
  v_kept uuid;
begin
  begin
    insert into auth.users (id, email) values (v_cust, 'default-legacy@example.com')
      on conflict (id) do nothing;
  exception when undefined_table then null;
  end;

  -- Simulate pre-migration data: two defaults, which the index would now
  -- reject, so both triggers and the index come off for the seed.
  alter table public.addresses disable trigger trg_addresses_single_default;
  drop index if exists public.addresses_one_default_per_customer;

  insert into public.addresses (customer_id, latitude, longitude, description, is_default, created_at)
    values (v_cust, 24.10, 46.10, 'older default, palm tree corner', true, now() - interval '2 days')
    returning id into v_old;
  insert into public.addresses (customer_id, latitude, longitude, description, is_default, created_at)
    values (v_cust, 24.20, 46.20, 'newer default, glass front', true, now() - interval '1 day')
    returning id into v_new;

  -- Re-run the migration's normalization verbatim.
  with ranked as (
    select id, row_number() over (partition by customer_id order by created_at, id) as rn
      from public.addresses where is_default
  )
  update public.addresses a set is_default = false
    from ranked r where a.id = r.id and r.rn > 1;

  create unique index if not exists addresses_one_default_per_customer
    on public.addresses (customer_id) where is_default;
  alter table public.addresses enable trigger trg_addresses_single_default;

  select id into v_kept from public.addresses where customer_id = v_cust and is_default;
  if v_kept is distinct from v_old then
    raise exception 'CASE 7 FAILED: normalization did not keep the oldest default';
  end if;
  if (select count(*) from public.addresses where customer_id = v_cust and is_default) <> 1 then
    raise exception 'CASE 7 FAILED: normalization left more than one default';
  end if;
  -- The demoted row must survive intact; normalization deletes nothing.
  if (select count(*) from public.addresses where customer_id = v_cust) <> 2 then
    raise exception 'CASE 7 FAILED: normalization removed a row';
  end if;
  if (select description from public.addresses where id = v_new) is null then
    raise exception 'CASE 7 FAILED: normalization rewrote the landmark';
  end if;

  raise notice 'CASE 7 ok: normalization keeps the oldest default and deletes nothing';
end $$;

-- Case 8: ROLLBACK leaves no partial schema, then restores the objects so any
--         later file in the suite sees the migrated state.
do $$
declare v_n int;
begin
  drop index if exists public.addresses_one_default_per_customer;
  drop trigger if exists trg_addresses_single_default on public.addresses;
  drop function if exists public.enforce_single_default_address();

  select count(*) into v_n from pg_trigger
   where tgname = 'trg_addresses_single_default' and not tgisinternal;
  if v_n <> 0 then raise exception 'CASE 8 FAILED: trigger survived rollback'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_single_default_address';
  if v_n <> 0 then raise exception 'CASE 8 FAILED: function survived rollback'; end if;

  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'addresses_one_default_per_customer';
  if v_n <> 0 then raise exception 'CASE 8 FAILED: index survived rollback'; end if;

  -- The column must be untouched by the migration and its rollback.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'addresses'
     and column_name = 'is_default' and data_type = 'boolean' and is_nullable = 'NO';
  if v_n <> 1 then raise exception 'CASE 8 FAILED: is_default column altered'; end if;

  raise notice 'CASE 8 ok: rollback is clean and leaves no partial schema';
end $$;

rollback;
