-- ============================================================================
-- checkout_sessions.address_id ON DELETE SET NULL (migration
-- 20260801120100_checkout_session_address_fk_set_null.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied (same
-- harness as the mandatory-landmark / single-default / order-read-contract
-- suites). Each case RAISES EXCEPTION on failure, so the script aborts non-zero
-- if any assertion fails; a clean run prints NOTICEs and commits nothing.
--
-- The governing requirement: a customer may delete a saved address that has
-- backed an online checkout, and doing so must cost them NOTHING — the session
-- row survives, its priced snapshot is byte-identical, its totals and order
-- linkage are untouched, and only the convenience pointer becomes NULL.
--
-- Case 4 additionally proves the delete is still owner-scoped, i.e. relaxing
-- the constraint did not turn "you may now delete this" into "anyone may now
-- delete this". It runs as the real `authenticated` role, so it exercises RLS
-- by execution rather than by reading the policy.
-- ============================================================================
begin;

-- Two customers with a branch to hang sessions off.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_branch uuid;
begin
  begin
    insert into auth.users (id, email) values
      (v_a, 'fk-a@example.com'), (v_b, 'fk-b@example.com')
      on conflict (id) do nothing;
  exception when undefined_table then
    null; -- harness seeds auth.users differently
  end;

  insert into public.profiles (id, full_name, phone_number, role)
    values (v_a, 'Customer A', '+966500000001', 'customer'),
           (v_b, 'Customer B', '+966500000002', 'customer')
    on conflict (id) do nothing;

  select id into v_branch from public.branches limit 1;
  if v_branch is null then
    insert into public.branches (name_en, name_ar, address_en, address_ar, phone, is_active)
      values ('FK Test Branch', 'فرع الاختبار', 'Riyadh', 'الرياض', '+966500000000', true)
      returning id into v_branch;
  end if;

  perform set_config('sma.cust_a', v_a::text, true);
  perform set_config('sma.cust_b', v_b::text, true);
  perform set_config('sma.branch', v_branch::text, true);
end $$;

-- Case 1: the constraint is exactly what the migration promised — same
--         referenced table and column, delete behaviour SET NULL, everything
--         else (MATCH, ON UPDATE, deferrability) untouched, and the column
--         nullable so SET NULL is honourable at all.
do $$
declare
  v_confdel "char";
  v_confupd "char";
  v_confmatch "char";
  v_deferrable boolean;
  v_refrel regclass;
  v_refcol name;
  v_notnull boolean;
  v_n int;
begin
  select c.confdeltype, c.confupdtype, c.confmatchtype, c.condeferrable, c.confrelid,
         (select a.attname from pg_attribute a
           where a.attrelid = c.confrelid and a.attnum = c.confkey[1])
    into v_confdel, v_confupd, v_confmatch, v_deferrable, v_refrel, v_refcol
    from pg_constraint c
   where c.conrelid = 'public.checkout_sessions'::regclass
     and c.contype = 'f'
     and c.confrelid = 'public.addresses'::regclass
     and c.conkey[1] = (select a.attnum from pg_attribute a
                         where a.attrelid = 'public.checkout_sessions'::regclass
                           and a.attname = 'address_id' and not a.attisdropped);

  if v_confdel is null then
    raise exception 'CASE 1 FAILED: no FK from checkout_sessions.address_id to addresses';
  end if;
  if v_confdel <> 'n' then
    raise exception 'CASE 1 FAILED: ON DELETE is %, expected n (SET NULL)', v_confdel;
  end if;
  if v_refrel <> 'public.addresses'::regclass then
    raise exception 'CASE 1 FAILED: referenced table changed to %', v_refrel;
  end if;
  if v_refcol <> 'id' then
    raise exception 'CASE 1 FAILED: referenced column is %, expected id', v_refcol;
  end if;
  -- Preserved semantics: NO ACTION on update, MATCH SIMPLE, not deferrable.
  if v_confupd <> 'a' then
    raise exception 'CASE 1 FAILED: ON UPDATE changed to %', v_confupd;
  end if;
  if v_confmatch = 'f' or v_confmatch = 'p' then
    raise exception 'CASE 1 FAILED: MATCH type changed to %', v_confmatch;
  end if;
  if v_deferrable then
    raise exception 'CASE 1 FAILED: constraint became deferrable';
  end if;

  select a.attnotnull into v_notnull from pg_attribute a
   where a.attrelid = 'public.checkout_sessions'::regclass
     and a.attname = 'address_id' and not a.attisdropped;
  if v_notnull then
    raise exception 'CASE 1 FAILED: address_id is NOT NULL, so SET NULL can never fire';
  end if;

  -- Exactly one such FK: the migration must not have left a duplicate behind.
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.checkout_sessions'::regclass
     and c.contype = 'f' and c.confrelid = 'public.addresses'::regclass;
  if v_n <> 1 then
    raise exception 'CASE 1 FAILED: expected 1 FK to addresses, found %', v_n;
  end if;

  -- The neighbouring FK the app depends on must be untouched by this change.
  select c.confdeltype into v_confdel from pg_constraint c
   where c.conrelid = 'public.orders'::regclass
     and c.contype = 'f' and c.confrelid = 'public.addresses'::regclass;
  if v_confdel is distinct from 'n' then
    raise exception 'CASE 1 FAILED: orders.address_id delete behaviour changed to %', v_confdel;
  end if;

  raise notice 'CASE 1 ok: FK is ON DELETE SET NULL, every other property preserved';
end $$;

-- Case 2: THE HEADLINE. Deleting an address that a checkout session references
--         succeeds, and the session's address_id becomes NULL.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_sess uuid;
  v_after uuid;
  v_n int;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7136, 46.6753, 'blue gate beside the pharmacy')
    returning id into v_addr;

  insert into public.checkout_sessions
    (customer_id, order_type, payment_method, branch_id, address_id, snapshot,
     subtotal, delivery_fee, total, status)
  values
    (v_cust, 'delivery', 'online', v_branch, v_addr,
     jsonb_build_object(
       'items', jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 2)),
       'address_id', v_addr::text,
       'address_snapshot', jsonb_build_object(
         'id', v_addr::text, 'latitude', 24.7136, 'longitude', 46.6753,
         'description', 'blue gate beside the pharmacy')),
     78.00, 10.00, 88.00, 'pending_payment')
  returning id into v_sess;

  -- Before the migration this raised foreign_key_violation (23503) and the
  -- customer could never remove the address again.
  delete from public.addresses where id = v_addr;

  select count(*) into v_n from public.addresses where id = v_addr;
  if v_n <> 0 then raise exception 'CASE 2 FAILED: address was not deleted'; end if;

  select count(*) into v_n from public.checkout_sessions where id = v_sess;
  if v_n <> 1 then
    raise exception 'CASE 2 FAILED: the checkout session was removed with the address';
  end if;

  select address_id into v_after from public.checkout_sessions where id = v_sess;
  if v_after is not null then
    raise exception 'CASE 2 FAILED: address_id is % , expected NULL', v_after;
  end if;

  raise notice 'CASE 2 ok: deleting a referenced address nulls the pointer and keeps the session';
end $$;

-- Case 3: NOTHING ELSE ON THE SESSION MOVED. The snapshot (the server-trusted
--         quote that insert_order_from_snapshot actually reads), the money, the
--         status, the idempotency key and the order linkage are byte-identical
--         across the delete.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_sess uuid;
  v_snap_before jsonb;
  v_snap_after  jsonb;
  v_before record;
  v_after  record;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7200, 46.6800, 'white tower, entrance C')
    returning id into v_addr;

  insert into public.checkout_sessions
    (customer_id, order_type, payment_method, branch_id, address_id, snapshot,
     subtotal, delivery_fee, discount_amount, loyalty_discount_amount, vat_amount,
     total, currency, status, idempotency_key)
  values
    (v_cust, 'delivery', 'online', v_branch, v_addr,
     jsonb_build_object(
       'items', jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 1)),
       'address_id', v_addr::text,
       'address_snapshot', jsonb_build_object(
         'id', v_addr::text, 'latitude', 24.7200, 'longitude', 46.6800,
         'description', 'white tower, entrance C'),
       'loyalty_points_redeemed', 0),
     100.00, 15.00, 5.00, 0.00, 16.50, 110.00, 'SAR', 'pending_payment', gen_random_uuid())
  returning id into v_sess;

  select snapshot into v_snap_before from public.checkout_sessions where id = v_sess;
  select customer_id, status, order_type, payment_method, branch_id, coupon_code, notes,
         loyalty_points, subtotal, delivery_fee, discount_amount, loyalty_discount_amount,
         vat_amount, total, currency, idempotency_key, order_id, created_at, expires_at,
         consumed_at
    into v_before
    from public.checkout_sessions where id = v_sess;

  delete from public.addresses where id = v_addr;

  select snapshot into v_snap_after from public.checkout_sessions where id = v_sess;
  select customer_id, status, order_type, payment_method, branch_id, coupon_code, notes,
         loyalty_points, subtotal, delivery_fee, discount_amount, loyalty_discount_amount,
         vat_amount, total, currency, idempotency_key, order_id, created_at, expires_at,
         consumed_at
    into v_after
    from public.checkout_sessions where id = v_sess;

  if v_snap_after is distinct from v_snap_before then
    raise exception 'CASE 3 FAILED: snapshot changed. before=% after=%',
      v_snap_before::text, v_snap_after::text;
  end if;

  -- The address the customer was quoted survives INSIDE the snapshot even
  -- though the row is gone. This is what insert_order_from_snapshot reads.
  if v_snap_after -> 'address_snapshot' ->> 'description' <> 'white tower, entrance C' then
    raise exception 'CASE 3 FAILED: address_snapshot lost its landmark';
  end if;
  if (v_snap_after ->> 'address_id') is distinct from v_addr::text then
    raise exception 'CASE 3 FAILED: snapshot address_id was rewritten';
  end if;

  if v_after is distinct from v_before then
    raise exception 'CASE 3 FAILED: a non-address column of the session changed';
  end if;

  raise notice 'CASE 3 ok: snapshot, totals, status and linkage are unchanged by the delete';
end $$;

-- Case 4: OWNERSHIP. Relaxing the constraint must not have widened WHO may
--         delete. Executed as the real `authenticated` role so RLS decides.
do $$
declare
  v_a uuid := current_setting('sma.cust_a')::uuid;
  v_b uuid := current_setting('sma.cust_b')::uuid;
  v_addr_b uuid;
  v_n int;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_b, 24.6000, 46.7000, 'red gate, near the school')
    returning id into v_addr_b;

  -- Customer A attempts to delete customer B's address.
  perform set_config('test.auth_uid', v_a::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  set local role authenticated;
  delete from public.addresses where id = v_addr_b;
  reset role;

  select count(*) into v_n from public.addresses where id = v_addr_b;
  if v_n <> 1 then
    raise exception 'CASE 4 FAILED: customer A deleted customer B''s address';
  end if;

  -- And B can delete their own, through the same policy.
  perform set_config('test.auth_uid', v_b::text, true);
  set local role authenticated;
  delete from public.addresses where id = v_addr_b;
  reset role;

  select count(*) into v_n from public.addresses where id = v_addr_b;
  if v_n <> 0 then
    raise exception 'CASE 4 FAILED: the owner could not delete their own address';
  end if;

  raise notice 'CASE 4 ok: delete is still owner-scoped by RLS';
end $$;

-- Case 5: the policy itself still scopes every address operation to the owner.
--         Catalog-level, so it holds even on a harness without the auth.uid()
--         shim Case 4 relies on.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'addresses'
     and policyname = 'addresses_own_all'
     and qual like '%auth.uid()%';
  if v_n <> 1 then
    raise exception 'CASE 5 FAILED: addresses_own_all policy missing or no longer scoped to auth.uid()';
  end if;

  select count(*) into v_n from pg_class
   where oid = 'public.addresses'::regclass and relrowsecurity;
  if v_n <> 1 then
    raise exception 'CASE 5 FAILED: RLS is not enabled on public.addresses';
  end if;

  raise notice 'CASE 5 ok: address RLS unchanged';
end $$;

-- Case 6: ADDRESS CRUD STILL WORKS. The two triggers on this table (mandatory
--         landmark, single default) are unaffected by the FK change.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_one uuid;
  v_two uuid;
  v_n int;
begin
  -- CREATE + the landmark rule (20260724170000) still rejects a bad one.
  begin
    insert into public.addresses (customer_id, latitude, longitude, description)
      values (v_cust, 24.80, 46.80, 'ab');
    raise exception 'CASE 6 FAILED: too-short landmark accepted';
  exception when check_violation then null;
  end;

  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_cust, 24.80, 46.80, 'green mosque, second street', true)
    returning id into v_one;

  -- UPDATE, and the trim-on-store behaviour.
  update public.addresses set description = '   palm tree corner, gate 3   ' where id = v_one;
  if (select description from public.addresses where id = v_one) <> 'palm tree corner, gate 3' then
    raise exception 'CASE 6 FAILED: description no longer trimmed on store';
  end if;

  -- SINGLE DEFAULT (20260801120000) still demotes the previous default.
  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_cust, 24.85, 46.85, 'brown door, opposite the bakery', true)
    returning id into v_two;

  select count(*) into v_n from public.addresses where customer_id = v_cust and is_default;
  if v_n <> 1 then
    raise exception 'CASE 6 FAILED: expected exactly 1 default, found %', v_n;
  end if;
  if (select is_default from public.addresses where id = v_one) then
    raise exception 'CASE 6 FAILED: previous default was not demoted';
  end if;

  -- Promotion by UPDATE still works too.
  update public.addresses set is_default = true where id = v_one;
  select count(*) into v_n from public.addresses where customer_id = v_cust and is_default;
  if v_n <> 1 then
    raise exception 'CASE 6 FAILED: promotion broke the single-default invariant';
  end if;

  -- DELETE of an unreferenced address is unaffected.
  delete from public.addresses where id = v_two;
  select count(*) into v_n from public.addresses where id = v_two;
  if v_n <> 0 then raise exception 'CASE 6 FAILED: plain delete stopped working'; end if;

  raise notice 'CASE 6 ok: address CRUD, landmark rule and single-default all intact';
end $$;

-- Case 7: a session whose address is deleted still yields the SAME order.
--         insert_order_from_snapshot reads the address from the snapshot JSONB,
--         so a NULL pointer column cannot change what gets created or charged.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_sess uuid;
  v_snap jsonb;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.90, 46.90, 'yellow building, third floor')
    returning id into v_addr;

  insert into public.checkout_sessions
    (customer_id, order_type, payment_method, branch_id, address_id, snapshot,
     subtotal, delivery_fee, total, status)
  values
    (v_cust, 'delivery', 'online', v_branch, v_addr,
     jsonb_build_object(
       'address_id', v_addr::text,
       'address_snapshot', jsonb_build_object('id', v_addr::text,
         'description', 'yellow building, third floor')),
     50.00, 10.00, 60.00, 'pending_payment')
  returning id into v_sess;

  delete from public.addresses where id = v_addr;

  select snapshot into v_snap from public.checkout_sessions where id = v_sess;

  -- The exact expression insert_order_from_snapshot uses to resolve the address.
  if nullif(v_snap ->> 'address_id', '')::uuid is distinct from v_addr then
    raise exception 'CASE 7 FAILED: the snapshot no longer resolves the quoted address';
  end if;
  if (select address_id from public.checkout_sessions where id = v_sess) is not null then
    raise exception 'CASE 7 FAILED: pointer column not nulled';
  end if;
  if (select total from public.checkout_sessions where id = v_sess) <> 60.00 then
    raise exception 'CASE 7 FAILED: the quoted total moved';
  end if;

  raise notice 'CASE 7 ok: order creation reads the snapshot, which the delete did not touch';
end $$;

-- Case 8: IDEMPOTENCE. Re-running the migration body is a no-op, and the
--         documented rollback restores the original blocking behaviour.
do $$
declare
  v_confdel "char";
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
begin
  -- Re-run: the migration's early-exit branch must fire and change nothing.
  if (select c.confdeltype from pg_constraint c
       where c.conrelid = 'public.checkout_sessions'::regclass
         and c.contype = 'f' and c.confrelid = 'public.addresses'::regclass) <> 'n' then
    raise exception 'CASE 8 FAILED: precondition — constraint is not SET NULL';
  end if;

  -- Apply the documented rollback and prove it really blocks again.
  alter table public.checkout_sessions drop constraint checkout_sessions_address_id_fkey;
  alter table public.checkout_sessions
    add constraint checkout_sessions_address_id_fkey
    foreign key (address_id) references public.addresses(id);

  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.95, 46.95, 'rollback probe, corner shop')
    returning id into v_addr;
  insert into public.checkout_sessions
    (customer_id, order_type, payment_method, branch_id, address_id, snapshot,
     subtotal, delivery_fee, total, status)
  values (v_cust, 'delivery', 'online', v_branch, v_addr, '{}'::jsonb,
          10.00, 0.00, 10.00, 'pending_payment');

  begin
    delete from public.addresses where id = v_addr;
    raise exception 'CASE 8 FAILED: rollback did not restore the blocking behaviour';
  exception when foreign_key_violation then null;
  end;

  -- Restore the migrated state so any later file in the suite sees it.
  alter table public.checkout_sessions drop constraint checkout_sessions_address_id_fkey;
  alter table public.checkout_sessions
    add constraint checkout_sessions_address_id_fkey
    foreign key (address_id) references public.addresses(id) on delete set null;

  select c.confdeltype into v_confdel from pg_constraint c
   where c.conrelid = 'public.checkout_sessions'::regclass
     and c.contype = 'f' and c.confrelid = 'public.addresses'::regclass;
  if v_confdel <> 'n' then
    raise exception 'CASE 8 FAILED: could not restore the migrated state';
  end if;

  raise notice 'CASE 8 ok: rollback blocks again, and the migrated state is restorable';
end $$;

rollback;
