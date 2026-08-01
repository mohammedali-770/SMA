-- ============================================================================
-- Address deletion vs. checkout sessions (migration
-- 20260801120100_checkout_session_address_fk_set_null.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied (same
-- harness as the mandatory-landmark / single-default / order-read-contract
-- suites). Each case RAISES EXCEPTION on failure, so the script aborts non-zero
-- if any assertion fails; a clean run prints NOTICEs and commits nothing.
--
-- TWO requirements are under test, and they pull in opposite directions:
--
--   A. A customer MAY delete a saved address that has backed an online
--      checkout, and it must cost them nothing: the session row survives, its
--      priced snapshot is byte-identical, its totals and order linkage are
--      untouched, and only the convenience pointer becomes NULL.
--
--   B. A customer may NOT delete an address while a checkout session could
--      still turn it into an order. `insert_order_from_snapshot` copies the
--      snapshot's address_id into `orders.address_id`, which is a live FK, so
--      deleting the address in that window would make a CAPTURED payment fail
--      to become an order — permanently, since finalize_checkout_session has no
--      exception handler and still accepts an 'expired' session.
--
-- The cases that exercise a customer's own delete run as the real
-- `authenticated` role, so RLS and the guard are exercised by execution rather
-- than by reading the policy.
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

  -- handle_new_user() may already have created these from auth.users.
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

-- Insert a session in a given state, returning its id. Keeps the cases short
-- and makes the ONLY difference between them the thing under test.
create or replace function pg_temp.mk_session(
  p_cust uuid, p_branch uuid, p_addr uuid, p_status text, p_order uuid default null
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.checkout_sessions
    (customer_id, order_type, payment_method, branch_id, address_id, snapshot,
     subtotal, delivery_fee, total, status, order_id)
  values
    (p_cust, 'delivery', 'online', p_branch, p_addr,
     jsonb_build_object(
       'items', jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 2)),
       'address_id', p_addr::text,
       'address_snapshot', jsonb_build_object(
         'id', p_addr::text, 'latitude', 24.7136, 'longitude', 46.6753,
         'description', 'blue gate beside the pharmacy')),
     78.00, 10.00, 88.00, p_status, p_order)
  returning id into v_id;
  return v_id;
end $$;

-- Delete an address AS THE CUSTOMER and return the SQLSTATE (null on success).
create or replace function pg_temp.del_as(p_uid uuid, p_addr uuid)
returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('test.auth_uid', p_uid::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  set local role authenticated;
  begin
    delete from public.addresses where id = p_addr;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  return v_state;
end $$;

-- Case 1: the constraint is exactly what the migration promised — same
--         referenced table and column, delete behaviour SET NULL, everything
--         else (MATCH, ON UPDATE, deferrability) untouched, the column nullable
--         so SET NULL is honourable at all, and the guard bound alongside it.
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

  -- The neighbouring FK that makes the guard necessary must be untouched.
  select c.confdeltype into v_confdel from pg_constraint c
   where c.conrelid = 'public.orders'::regclass
     and c.contype = 'f' and c.confrelid = 'public.addresses'::regclass;
  if v_confdel is distinct from 'n' then
    raise exception 'CASE 1 FAILED: orders.address_id delete behaviour changed to %', v_confdel;
  end if;

  -- The guard itself.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_address_delete_live_checkout';
  if v_n <> 1 then raise exception 'CASE 1 FAILED: guard function missing'; end if;

  select count(*) into v_n from pg_trigger
   where tgname = 'trg_addresses_guard_live_checkout'
     and tgrelid = 'public.addresses'::regclass and not tgisinternal;
  if v_n <> 1 then raise exception 'CASE 1 FAILED: guard trigger not bound to public.addresses'; end if;

  -- The lookup index both the guard and the SET NULL action depend on.
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'checkout_sessions_address_idx';
  if v_n <> 1 then raise exception 'CASE 1 FAILED: address_id lookup index missing'; end if;

  raise notice 'CASE 1 ok: FK is ON DELETE SET NULL, other properties preserved, guard bound';
end $$;

-- Case 2: THE HEADLINE. A customer deletes an address referenced by a FINISHED
--         checkout session. It succeeds and the pointer becomes NULL. This is
--         the case that was impossible before the migration.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_sess uuid;
  v_state text;
  v_after uuid;
  v_n int;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7136, 46.6753, 'blue gate beside the pharmacy')
    returning id into v_addr;

  -- 'consumed' is outside finalize_checkout_session's payable set, so this
  -- session can never become another order and the guard stands aside.
  v_sess := pg_temp.mk_session(v_cust, v_branch, v_addr, 'consumed');

  v_state := pg_temp.del_as(v_cust, v_addr);
  if v_state is not null then
    raise exception 'CASE 2 FAILED: delete refused with SQLSTATE %', v_state;
  end if;

  select count(*) into v_n from public.addresses where id = v_addr;
  if v_n <> 0 then raise exception 'CASE 2 FAILED: address was not deleted'; end if;

  select count(*) into v_n from public.checkout_sessions where id = v_sess;
  if v_n <> 1 then
    raise exception 'CASE 2 FAILED: the checkout session was removed with the address';
  end if;

  select address_id into v_after from public.checkout_sessions where id = v_sess;
  if v_after is not null then
    raise exception 'CASE 2 FAILED: address_id is %, expected NULL', v_after;
  end if;

  raise notice 'CASE 2 ok: a finished session no longer blocks the delete; the pointer is nulled';
end $$;

-- Case 3: NOTHING ELSE ON THE SESSION MOVED. The snapshot (the server-trusted
--         quote insert_order_from_snapshot actually reads), the money, the
--         status, the idempotency key and the order linkage are identical
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
  v_state text;
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
     100.00, 15.00, 5.00, 0.00, 16.50, 110.00, 'SAR', 'consumed', gen_random_uuid())
  returning id into v_sess;

  select snapshot into v_snap_before from public.checkout_sessions where id = v_sess;
  select customer_id, status, order_type, payment_method, branch_id, coupon_code, notes,
         loyalty_points, subtotal, delivery_fee, discount_amount, loyalty_discount_amount,
         vat_amount, total, currency, idempotency_key, order_id, created_at, expires_at,
         consumed_at
    into v_before
    from public.checkout_sessions where id = v_sess;

  v_state := pg_temp.del_as(v_cust, v_addr);
  if v_state is not null then
    raise exception 'CASE 3 FAILED: delete refused with SQLSTATE %', v_state;
  end if;

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

  -- Field-by-field, so a NULL in either record cannot make the comparison
  -- silently pass the way a whole-record IS DISTINCT FROM can.
  if v_after.status is distinct from v_before.status
     or v_after.total is distinct from v_before.total
     or v_after.subtotal is distinct from v_before.subtotal
     or v_after.delivery_fee is distinct from v_before.delivery_fee
     or v_after.discount_amount is distinct from v_before.discount_amount
     or v_after.loyalty_discount_amount is distinct from v_before.loyalty_discount_amount
     or v_after.vat_amount is distinct from v_before.vat_amount
     or v_after.currency is distinct from v_before.currency
     or v_after.idempotency_key is distinct from v_before.idempotency_key
     or v_after.order_id is distinct from v_before.order_id
     or v_after.customer_id is distinct from v_before.customer_id
     or v_after.branch_id is distinct from v_before.branch_id
     or v_after.created_at is distinct from v_before.created_at
     or v_after.expires_at is distinct from v_before.expires_at then
    raise exception 'CASE 3 FAILED: a non-address column of the session changed';
  end if;

  raise notice 'CASE 3 ok: snapshot, totals, status and linkage unchanged by the delete';
end $$;

-- Case 4: THE GUARD. A session that can STILL become an order refuses the
--         delete, and does so with the dedicated 55006, not a bare FK error.
--         Without this, a captured payment could never be turned into an order.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_state text;
  v_n int;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7300, 46.6900, 'green mosque, second street')
    returning id into v_addr;

  perform pg_temp.mk_session(v_cust, v_branch, v_addr, 'pending_payment');

  v_state := pg_temp.del_as(v_cust, v_addr);
  if v_state is distinct from '55006' then
    raise exception 'CASE 4 FAILED: expected SQLSTATE 55006, got %', coalesce(v_state, 'success');
  end if;

  select count(*) into v_n from public.addresses where id = v_addr;
  if v_n <> 1 then
    raise exception 'CASE 4 FAILED: the address was deleted despite a live session';
  end if;

  raise notice 'CASE 4 ok: a still-payable session refuses the delete with 55006';
end $$;

-- Case 5: an EXPIRED but unconsumed session refuses too. finalize deliberately
--         still accepts 'expired' ("a captured payment must never be refused"),
--         so it is exactly as dangerous as 'pending_payment'.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_state text;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7400, 46.7000, 'yellow building, third floor')
    returning id into v_addr;

  perform pg_temp.mk_session(v_cust, v_branch, v_addr, 'expired');

  v_state := pg_temp.del_as(v_cust, v_addr);
  if v_state is distinct from '55006' then
    raise exception 'CASE 5 FAILED: expected 55006 for an expired unconsumed session, got %',
      coalesce(v_state, 'success');
  end if;

  raise notice 'CASE 5 ok: an expired-but-finalizable session refuses the delete';
end $$;

-- Case 6: the refusal LIFTS once the session can no longer become an order.
--         Note what this does and does not establish: a checkout that COMPLETES
--         frees the address, which is the common path. Nothing in the schema
--         ever writes status='cancelled', so an ABANDONED checkout never
--         reaches this transition on its own — the documented limitation in the
--         migration header, and the reason the app copy offers "complete that
--         checkout, or contact us" rather than "try again later".
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_sess uuid;
  v_state text;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.7500, 46.7100, 'brown door, opposite the bakery')
    returning id into v_addr;

  v_sess := pg_temp.mk_session(v_cust, v_branch, v_addr, 'pending_payment');

  if pg_temp.del_as(v_cust, v_addr) is distinct from '55006' then
    raise exception 'CASE 6 FAILED: precondition — a live session should have refused';
  end if;

  -- The session completes, exactly as finalize_checkout_session leaves it.
  update public.checkout_sessions
     set status = 'consumed', consumed_at = now()
   where id = v_sess;

  v_state := pg_temp.del_as(v_cust, v_addr);
  if v_state is not null then
    raise exception 'CASE 6 FAILED: still refused after the checkout finished (%)', v_state;
  end if;

  raise notice 'CASE 6 ok: the refusal lifts when the checkout finishes';
end $$;

-- Case 7: SERVER-SIDE PATHS ARE EXEMPT — and they must be, because
--         anonymize_account_data deletes a customer's ADDRESSES (20260715120000:264)
--         BEFORE their checkout sessions (:270). A blanket guard would break
--         account deletion outright.
do $$
declare
  v_cust uuid := current_setting('sma.cust_b')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_n int;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.6100, 46.7200, 'account deletion probe, blue kiosk')
    returning id into v_addr;

  perform pg_temp.mk_session(v_cust, v_branch, v_addr, 'pending_payment');

  -- Not `authenticated`: this is the owner/definer context the anonymisation
  -- function runs in.
  delete from public.addresses where id = v_addr;

  select count(*) into v_n from public.addresses where id = v_addr;
  if v_n <> 0 then
    raise exception 'CASE 7 FAILED: the guard blocked a server-side delete (account deletion would break)';
  end if;

  raise notice 'CASE 7 ok: server-side deletes are exempt, so account deletion still works';
end $$;

-- Case 8: OWNERSHIP. Relaxing the constraint must not have widened WHO may
--         delete.
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

  -- Customer A attempts to delete customer B's address. RLS makes it a no-op
  -- rather than an error, so assert on the row, not on the SQLSTATE.
  perform pg_temp.del_as(v_a, v_addr_b);

  select count(*) into v_n from public.addresses where id = v_addr_b;
  if v_n <> 1 then
    raise exception 'CASE 8 FAILED: customer A deleted customer B''s address';
  end if;

  -- And B can delete their own, through the same policy.
  if pg_temp.del_as(v_b, v_addr_b) is not null then
    raise exception 'CASE 8 FAILED: the owner could not delete their own address';
  end if;

  select count(*) into v_n from public.addresses where id = v_addr_b;
  if v_n <> 0 then
    raise exception 'CASE 8 FAILED: the owner''s delete did not remove the row';
  end if;

  raise notice 'CASE 8 ok: delete is still owner-scoped by RLS';
end $$;

-- Case 9: the policy itself still scopes every address operation to the owner.
--         Catalog-level, so it holds even on a harness without the auth.uid()
--         shim the cases above rely on.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'addresses'
     and policyname = 'addresses_own_all'
     and qual like '%auth.uid()%';
  if v_n <> 1 then
    raise exception 'CASE 9 FAILED: addresses_own_all policy missing or no longer scoped to auth.uid()';
  end if;

  select count(*) into v_n from pg_class
   where oid = 'public.addresses'::regclass and relrowsecurity;
  if v_n <> 1 then
    raise exception 'CASE 9 FAILED: RLS is not enabled on public.addresses';
  end if;

  raise notice 'CASE 9 ok: address RLS unchanged';
end $$;

-- Case 10: ADDRESS CRUD STILL WORKS. The other two triggers on this table
--          (mandatory landmark, single default) are unaffected.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_one uuid;
  v_two uuid;
  v_n int;
begin
  begin
    insert into public.addresses (customer_id, latitude, longitude, description)
      values (v_cust, 24.80, 46.80, 'ab');
    raise exception 'CASE 10 FAILED: too-short landmark accepted';
  exception when check_violation then null;
  end;

  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_cust, 24.80, 46.80, 'palm tree corner, gate 3', true)
    returning id into v_one;

  update public.addresses set description = '   olive street, third gate   ' where id = v_one;
  if (select description from public.addresses where id = v_one) <> 'olive street, third gate' then
    raise exception 'CASE 10 FAILED: description no longer trimmed on store';
  end if;

  insert into public.addresses (customer_id, latitude, longitude, description, is_default)
    values (v_cust, 24.85, 46.85, 'silver gate, next to the clinic', true)
    returning id into v_two;

  select count(*) into v_n from public.addresses where customer_id = v_cust and is_default;
  if v_n <> 1 then
    raise exception 'CASE 10 FAILED: expected exactly 1 default, found %', v_n;
  end if;
  if (select is_default from public.addresses where id = v_one) then
    raise exception 'CASE 10 FAILED: previous default was not demoted';
  end if;

  update public.addresses set is_default = true where id = v_one;
  select count(*) into v_n from public.addresses where customer_id = v_cust and is_default;
  if v_n <> 1 then
    raise exception 'CASE 10 FAILED: promotion broke the single-default invariant';
  end if;

  -- An unreferenced address deletes cleanly through the customer path.
  if pg_temp.del_as(v_cust, v_two) is not null then
    raise exception 'CASE 10 FAILED: plain delete stopped working';
  end if;

  raise notice 'CASE 10 ok: address CRUD, landmark rule and single-default all intact';
end $$;

-- Case 11: after a permitted delete, the snapshot still resolves the address
--          the customer was quoted — the exact expression
--          insert_order_from_snapshot uses. A NULL pointer column cannot change
--          what an order would be created against.
do $$
declare
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_sess uuid;
  v_snap jsonb;
begin
  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.90, 46.90, 'grey villa, corner of the park')
    returning id into v_addr;

  v_sess := pg_temp.mk_session(v_cust, v_branch, v_addr, 'consumed');

  if pg_temp.del_as(v_cust, v_addr) is not null then
    raise exception 'CASE 11 FAILED: delete of a finished session''s address was refused';
  end if;

  select snapshot into v_snap from public.checkout_sessions where id = v_sess;

  if nullif(v_snap ->> 'address_id', '')::uuid is distinct from v_addr then
    raise exception 'CASE 11 FAILED: the snapshot no longer resolves the quoted address';
  end if;
  if (select address_id from public.checkout_sessions where id = v_sess) is not null then
    raise exception 'CASE 11 FAILED: pointer column not nulled';
  end if;
  if (select total from public.checkout_sessions where id = v_sess) <> 88.00 then
    raise exception 'CASE 11 FAILED: the quoted total moved';
  end if;

  raise notice 'CASE 11 ok: the snapshot the order is built from survives the delete';
end $$;

-- Case 12: ROLLBACK. The documented rollback restores the original blocking
--          behaviour, then the migrated state is restorable — so a bad apply
--          can be undone and re-done.
do $$
declare
  v_confdel "char";
  v_conname name;
  v_cust uuid := current_setting('sma.cust_a')::uuid;
  v_branch uuid := current_setting('sma.branch')::uuid;
  v_addr uuid;
  v_blocked boolean := false;
begin
  -- Resolve the constraint the way the migration does — by catalog, not by a
  -- hardcoded name — so this cannot pass on a database whose FK is named
  -- differently from the one this repository happens to produce.
  select c.conname, c.confdeltype into v_conname, v_confdel
    from pg_constraint c
   where c.conrelid = 'public.checkout_sessions'::regclass
     and c.contype = 'f' and c.confrelid = 'public.addresses'::regclass;

  if v_confdel is distinct from 'n' then
    raise exception 'CASE 12 FAILED: precondition — constraint is not SET NULL';
  end if;

  drop trigger if exists trg_addresses_guard_live_checkout on public.addresses;
  execute format('alter table public.checkout_sessions drop constraint %I', v_conname);
  execute format(
    'alter table public.checkout_sessions add constraint %I'
    || ' foreign key (address_id) references public.addresses(id)', v_conname);

  insert into public.addresses (customer_id, latitude, longitude, description)
    values (v_cust, 24.95, 46.95, 'rollback probe, corner shop')
    returning id into v_addr;
  perform pg_temp.mk_session(v_cust, v_branch, v_addr, 'consumed');

  -- A flag rather than a RAISE inside the block: a RAISE in the try-branch
  -- would be caught by this same handler if the handler were ever widened,
  -- which is how a test quietly stops testing anything.
  begin
    delete from public.addresses where id = v_addr;
  exception when foreign_key_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'CASE 12 FAILED: rollback did not restore the blocking behaviour';
  end if;

  -- Restore the migrated state so any later file in the suite sees it.
  execute format('alter table public.checkout_sessions drop constraint %I', v_conname);
  execute format(
    'alter table public.checkout_sessions add constraint %I'
    || ' foreign key (address_id) references public.addresses(id) on delete set null', v_conname);
  create trigger trg_addresses_guard_live_checkout
    before delete on public.addresses
    for each row execute function public.guard_address_delete_live_checkout();

  select c.confdeltype into v_confdel from pg_constraint c
   where c.conrelid = 'public.checkout_sessions'::regclass
     and c.contype = 'f' and c.confrelid = 'public.addresses'::regclass;
  if v_confdel <> 'n' then
    raise exception 'CASE 12 FAILED: could not restore the migrated state';
  end if;

  raise notice 'CASE 12 ok: rollback blocks again, and the migrated state is restorable';
end $$;

rollback;
