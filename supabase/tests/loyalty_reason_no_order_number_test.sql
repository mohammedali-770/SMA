-- ============================================================================
-- loyalty_transactions.reason must never carry the internal SM-… order number
-- (migration 20260724130000_loyalty_reason_no_order_number).
--
-- The exposure: loyalty_transactions is customer-readable
--   grant select … to authenticated  +  RLS (profile_id = auth.uid() or is_staff())
-- and place_order / insert_order_from_snapshot wrote
--   'Earned on order ' || orders.order_number
-- into `reason`, so a customer could read their own SM-… id straight from
-- PostgREST. The fix normalizes the column on write, writer-independently.
--
-- Asserted here:
--   A. the value-shape predicate is exact;
--   B. order-linked earn/redeem rows get neutral text and NO SM-…;
--   C. a real place_order run awards loyalty EXACTLY ONCE and leaks nothing;
--   D. free-text admin reasons are redacted, not destroyed;
--   E. the customer-readable projection carries no SM-… anywhere;
--   F. staff access still works and the constraint/grant contract holds;
--   G. loyalty amounts, balances and order linkage are unchanged.
--
-- Transactional; each case RAISEs on failure. No provider call of any kind.
-- ============================================================================
begin;


-- A branch to hang test orders on: orders.branch_id is a real FK.
insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000ff', 'Suite Branch', 'فرع الاختبار')
on conflict (id) do nothing;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

-- ---- A. value-shape predicate ----------------------------------------------
do $$
begin
  if not public.text_has_internal_order_number('Earned on order SM-2026-000123') then
    raise exception 'PREDICATE FAILED: real order number not detected'; end if;
  if not public.text_has_internal_order_number('SM-2026-000001') then
    raise exception 'PREDICATE FAILED: bare order number not detected'; end if;
  if not public.text_has_internal_order_number('prefix SM-9999-1234567 suffix') then
    raise exception 'PREDICATE FAILED: 7-digit sequence not detected'; end if;
  -- Must NOT fire on unrelated text that merely contains "SM".
  if public.text_has_internal_order_number('SMS code sent') then
    raise exception 'PREDICATE FAILED: false positive on SMS'; end if;
  if public.text_has_internal_order_number('SM-20-1') then
    raise exception 'PREDICATE FAILED: false positive on short pattern'; end if;
  if public.text_has_internal_order_number(null) then
    raise exception 'PREDICATE FAILED: null must be safe'; end if;
  if public.text_has_internal_order_number('Points earned from an order') then
    raise exception 'PREDICATE FAILED: neutral text flagged'; end if;
  raise notice 'PREDICATE OK';
end $$;

-- ---- B. normalization on write (writer-independent) ------------------------
do $$
declare
  v_cust uuid := gen_random_uuid();
  v_ord  uuid := gen_random_uuid();
  v_reason text;
begin
  -- The loyalty inserts below run with FK triggers ON, so the customer needs
  -- a real profile. profiles.id references auth.users(id); handle_new_user()
  -- creates the profile from this insert.
  insert into auth.users (id) values (v_cust) on conflict (id) do nothing;

  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, order_number, branch_id, order_type, subtotal, total)
    values (v_ord, v_cust, 'SM-2026-000777', 'b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50);
  set local session_replication_role = origin;

  -- Simulate exactly what place_order writes today.
  insert into public.loyalty_transactions
    (profile_id, order_id, type, points, balance_after, reason, created_by)
  values (v_cust, v_ord, 'earn', 50, 50, 'Earned on order SM-2026-000777', v_cust);

  select reason into v_reason from public.loyalty_transactions
   where order_id = v_ord and type = 'earn';
  if v_reason <> 'Points earned from an order' then
    raise exception 'NORMALIZE FAILED: earn reason = %', v_reason; end if;
  if public.text_has_internal_order_number(v_reason) then
    raise exception 'NORMALIZE FAILED: earn reason still leaks'; end if;

  insert into public.loyalty_transactions
    (profile_id, order_id, type, points, balance_after, reason, created_by)
  values (v_cust, v_ord, 'redeem', -10, 40, 'Redeemed on order SM-2026-000777', v_cust);

  select reason into v_reason from public.loyalty_transactions
   where order_id = v_ord and type = 'redeem';
  if v_reason <> 'Points redeemed on an order' then
    raise exception 'NORMALIZE FAILED: redeem reason = %', v_reason; end if;

  -- An UPDATE must not be able to reintroduce it either.
  update public.loyalty_transactions
     set reason = 'Manual fix for order SM-2026-000777'
   where order_id = v_ord and type = 'earn';
  select reason into v_reason from public.loyalty_transactions
   where order_id = v_ord and type = 'earn';
  if public.text_has_internal_order_number(v_reason) then
    raise exception 'NORMALIZE FAILED: update reintroduced the number (%)', v_reason; end if;

  -- The order LINKAGE is preserved internally (UUID FK, not the SM-… text).
  if (select order_id from public.loyalty_transactions
       where order_id = v_ord and type = 'redeem') is distinct from v_ord then
    raise exception 'NORMALIZE FAILED: order linkage lost'; end if;

  raise notice 'NORMALIZE OK';
end $$;

-- ---- C. a REAL place_order run: awarded once, leaks nothing -----------------
-- Exercises the untouched pricing authority end-to-end and proves the trigger
-- closes the exposure without changing award timing or idempotency.
do $$
declare
  v_cust uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_cat uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_order jsonb;
  v_order2 jsonb;
  v_idem uuid := gen_random_uuid();
  n integer; v_bad integer; v_pts integer; v_bal integer;
begin
  set local session_replication_role = replica;
  -- profiles.id references auth.users(id), so the auth user must exist first;
  -- handle_new_user() then creates the profile row, which is why the insert
  -- below upserts rather than plain-inserts.
  insert into auth.users (id) values (v_cust) on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role, loyalty_points)
    values (v_cust, 'Test Customer', '+966500000009', 'customer', 0)
  on conflict (id) do update set full_name = excluded.full_name,
    phone_number = excluded.phone_number, role = excluded.role,
    loyalty_points = excluded.loyalty_points;
  insert into public.branches (id, name_en, name_ar, address_en, address_ar, phone,
                               latitude, longitude, delivery_fee, min_delivery_order, is_active)
    values (v_branch,'B','ب','A','ع','+966500000000',24.7,46.7,15,40,true);
  insert into public.categories (id, name_en, name_ar, sort_order) values (v_cat,'C','ك',1);
  insert into public.products (id, category_id, name_en, name_ar, price, is_active, sort_order)
    values (v_prod, v_cat, 'P','م', 100, true, 1);
  set local session_replication_role = origin;

  -- Loyalty must be ON so earn rows are actually produced.
  update public.app_settings set loyalty_enabled = true, points_per_riyal = 1 where id = true;

  perform set_config('test.auth_uid', v_cust::text, true);

  v_order := to_jsonb(public.place_order(
    v_branch, 'pickup'::public.order_type,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
    null, null, null, 0, v_idem, 'cash'));

  select count(*) into n from public.loyalty_transactions
   where profile_id = v_cust and type = 'earn';
  if n <> 1 then raise exception 'AWARD FAILED: expected exactly 1 earn row, got %', n; end if;

  -- IDEMPOTENCY: the same key must not award twice.
  v_order2 := to_jsonb(public.place_order(
    v_branch, 'pickup'::public.order_type,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
    null, null, null, 0, v_idem, 'cash'));
  if (v_order2->>'id') is distinct from (v_order->>'id') then
    raise exception 'IDEMPOTENCY FAILED: a second order was created'; end if;
  select count(*) into n from public.loyalty_transactions
   where profile_id = v_cust and type = 'earn';
  if n <> 1 then raise exception 'IDEMPOTENCY FAILED: awarded % times', n; end if;

  -- Nothing written by the real pricing path leaks the identifier.
  select count(*) into v_bad from public.loyalty_transactions
   where profile_id = v_cust and public.text_has_internal_order_number(reason);
  if v_bad <> 0 then raise exception 'LEAK: % loyalty rows carry an order number', v_bad; end if;

  -- Amounts and balances are unchanged by the text normalization.
  select points, balance_after into v_pts, v_bal from public.loyalty_transactions
   where profile_id = v_cust and type = 'earn';
  if v_pts <> 100 then raise exception 'AWARD FAILED: expected 100 points, got %', v_pts; end if;
  if v_bal <> 100 then raise exception 'AWARD FAILED: balance_after = %', v_bal; end if;
  if (select loyalty_points from public.profiles where id = v_cust) <> 100 then
    raise exception 'AWARD FAILED: profile balance not updated'; end if;

  -- The order itself still carries its authoritative pricing.
  if (v_order->>'total')::numeric <> 100 then
    raise exception 'PRICING CHANGED: total = %', v_order->>'total'; end if;
  if (v_order->>'loyalty_points_earned')::int <> 100 then
    raise exception 'PRICING CHANGED: points_earned = %', v_order->>'loyalty_points_earned'; end if;

  perform set_config('test.auth_uid', '', true);
  raise notice 'PLACE_ORDER AWARD OK';
end $$;

-- ---- D. free-text reasons are redacted, not destroyed -----------------------
do $$
declare v_cust uuid := gen_random_uuid(); v_reason text;
begin
  set local session_replication_role = replica;
  -- profiles.id references auth.users(id), so the auth user must exist first;
  -- handle_new_user() then creates the profile row, which is why the insert
  -- below upserts rather than plain-inserts.
  insert into auth.users (id) values (v_cust) on conflict (id) do nothing;
  insert into public.profiles (id, role, loyalty_points) values (v_cust, 'customer', 0)
  on conflict (id) do update set role = excluded.role,
    loyalty_points = excluded.loyalty_points;
  set local session_replication_role = origin;

  insert into public.loyalty_transactions
    (profile_id, order_id, type, points, balance_after, reason, created_by)
  values (v_cust, null, 'adjustment', 5, 5,
          'Goodwill for the late delivery on SM-2026-000042, approved by ops', v_cust);

  select reason into v_reason from public.loyalty_transactions
   where profile_id = v_cust and type = 'adjustment';
  if public.text_has_internal_order_number(v_reason) then
    raise exception 'REDACT FAILED: admin note still leaks (%)', v_reason; end if;
  if position('Goodwill for the late delivery' in v_reason) = 0
     or position('approved by ops' in v_reason) = 0 then
    raise exception 'REDACT FAILED: operator note was destroyed (%)', v_reason; end if;
  if position('[order]' in v_reason) = 0 then
    raise exception 'REDACT FAILED: no redaction marker (%)', v_reason; end if;

  raise notice 'REDACT OK';
end $$;

-- ---- E. the CUSTOMER-READABLE projection carries no SM-… anywhere ----------
do $$
declare v_bad integer;
begin
  -- Every column a customer can select from this table, scanned by VALUE.
  select count(*) into v_bad from public.loyalty_transactions t
   where public.text_has_internal_order_number(t.reason)
      or public.text_has_internal_order_number(t.type::text);
  if v_bad <> 0 then
    raise exception 'CUSTOMER PROJECTION LEAKS: % rows', v_bad; end if;
  raise notice 'CUSTOMER PROJECTION OK';
end $$;

-- ---- F. access contract -----------------------------------------------------
do $$
declare n integer;
begin
  -- Staff/customer read access is UNCHANGED (not revoked to fix the leak).
  if not has_table_privilege('authenticated', 'public.loyalty_transactions', 'select') then
    raise exception 'ACCESS FAILED: authenticated lost SELECT (staff would break)'; end if;
  if has_table_privilege('anon', 'public.loyalty_transactions', 'select') then
    raise exception 'ACCESS FAILED: anon may read loyalty'; end if;
  if has_table_privilege('authenticated', 'public.loyalty_transactions', 'insert')
     or has_table_privilege('authenticated', 'public.loyalty_transactions', 'update') then
    raise exception 'ACCESS FAILED: authenticated may write loyalty'; end if;

  -- The owning RLS policy still exists (no policy was dropped to fix this).
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'loyalty_transactions';
  if n < 1 then raise exception 'ACCESS FAILED: RLS policy missing'; end if;

  -- The helpers are not reachable by anon.
  if has_function_privilege('anon', 'public.loyalty_safe_reason(text,uuid,text)', 'execute') then
    raise exception 'ACCESS FAILED: anon may call loyalty_safe_reason'; end if;

  raise notice 'ACCESS OK';
end $$;

-- ---- F2. ENFORCEMENT CONTRACT: the trigger, and deliberately NO table CHECK --
-- This section replaces an earlier assertion that a NOT VALID CHECK constraint
-- existed. 20260724190000 DROPPED that constraint on purpose: a table CHECK sees
-- only the resulting row, so it cannot distinguish "a new bad write" from "an old
-- row being touched for an unrelated reason", and it therefore REJECTED
-- legitimate updates to historical rows (PostgreSQL evaluates a NOT VALID
-- constraint on every later INSERT *and UPDATE*).
--
-- The contract asserted here is the one that actually holds: enforcement rests
-- solely on the BEFORE INSERT OR UPDATE trigger, which is writer-independent and
-- can tell a genuine reason write from an unrelated update.
do $$
declare
  n integer;
  v_tg record;
begin
  -- (i) NO table CHECK is relied upon to police historical rows.
  select count(*) into n from pg_constraint
   where conrelid = 'public.loyalty_transactions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%order_number%';
  if n <> 0 then
    raise exception 'ENFORCEMENT FAILED: a reason CHECK constraint is back (%). '
                    'It would reject unrelated updates to historical rows.', n;
  end if;

  -- (ii) The trigger IS the enforcement point, and is bound for INSERT + UPDATE.
  select t.tgname,
         (t.tgtype & 1)  <> 0 as is_row,
         (t.tgtype & 2)  <> 0 as is_before,
         (t.tgtype & 4)  <> 0 as on_insert,
         (t.tgtype & 16) <> 0 as on_update
    into v_tg
    from pg_trigger t
   where t.tgrelid = 'public.loyalty_transactions'::regclass
     and not t.tgisinternal
     and t.tgname = 'set_loyalty_transactions_safe_reason';
  if v_tg is null then
    raise exception 'ENFORCEMENT FAILED: set_loyalty_transactions_safe_reason is missing';
  end if;
  if not (v_tg.is_row and v_tg.is_before and v_tg.on_insert and v_tg.on_update) then
    raise exception 'ENFORCEMENT FAILED: trigger binding wrong (row=% before=% ins=% upd=%)',
                    v_tg.is_row, v_tg.is_before, v_tg.on_insert, v_tg.on_update;
  end if;

  raise notice 'ENFORCEMENT OK: trigger-based, no history-hostile CHECK';
end $$;

-- ---- F3. The behaviour that replaces the constraint, proven end to end -------
-- A historical row (written before the rule) must survive an unrelated UPDATE:
-- permitted, not rejected, and NOT silently rewritten — while a genuine reason
-- write is still sanitized. Points/balances must be untouched throughout.
do $$
declare
  v_p      uuid := gen_random_uuid();
  v_id     uuid := gen_random_uuid();
  v_reason text;
  v_points integer;
  v_bal    integer;
begin
  -- profiles.id references auth.users(id), so the auth user must exist first;
  -- handle_new_user() then creates the profile row, which is why the insert
  -- below upserts rather than plain-inserts.
  insert into auth.users (id) values (v_p) on conflict (id) do nothing;
  insert into public.profiles (id) values (v_p) on conflict (id) do nothing;

  -- A pre-rule row, written with the trigger disabled so it is stored verbatim.
  alter table public.loyalty_transactions disable trigger set_loyalty_transactions_safe_reason;
  insert into public.loyalty_transactions (id, profile_id, type, points, balance_after, reason)
    values (v_id, v_p, 'earn', 25, 25, 'Earned on order SM-2026-000501');
  alter table public.loyalty_transactions enable trigger set_loyalty_transactions_safe_reason;

  if (select reason from public.loyalty_transactions where id = v_id)
       <> 'Earned on order SM-2026-000501' then
    raise exception 'F3 PRECONDITION FAILED: historical fixture not stored verbatim';
  end if;

  -- (a) an unrelated UPDATE is PERMITTED (no CHECK rejects it) ...
  begin
    update public.loyalty_transactions set balance_after = 999 where id = v_id;
  exception when others then
    raise exception 'F3 FAILED: unrelated update on a historical row was rejected: % / %',
                    sqlstate, sqlerrm;
  end;

  -- (b) ... and does NOT rewrite the historical reason.
  select reason, points, balance_after into v_reason, v_points, v_bal
    from public.loyalty_transactions where id = v_id;
  if v_reason <> 'Earned on order SM-2026-000501' then
    raise exception 'F3 FAILED: historical reason was silently rewritten to %', v_reason;
  end if;
  if v_bal <> 999 then raise exception 'F3 FAILED: the unrelated column did not change'; end if;
  if v_points <> 25 then raise exception 'F3 FAILED: points changed (% <> 25)', v_points; end if;

  -- (c) a GENUINE reason change IS sanitized, even on this historical row.
  update public.loyalty_transactions
     set reason = 'Manual correction for order SM-2026-000501' where id = v_id;
  select reason, points into v_reason, v_points
    from public.loyalty_transactions where id = v_id;
  if public.text_has_internal_order_number(v_reason) then
    raise exception 'F3 FAILED: a genuine reason change kept the internal number (%)', v_reason;
  end if;
  if v_points <> 25 then
    raise exception 'F3 FAILED: sanitizing a reason changed points (% <> 25)', v_points;
  end if;

  -- (d) a NEW insert carrying the internal number is sanitized on the way in.
  insert into public.loyalty_transactions (profile_id, type, points, balance_after, reason)
    values (v_p, 'earn', 5, 1004, 'Earned on order SM-2026-000502')
    returning reason into v_reason;
  if public.text_has_internal_order_number(v_reason) then
    raise exception 'F3 FAILED: a new insert stored the internal number (%)', v_reason;
  end if;

  raise notice 'F3 OK: history preserved + updatable; genuine writes sanitized; points intact';
end $$;

-- ---- E2. END-TO-END: what a REAL customer session can read, by VALUE --------
-- Executes as role `authenticated` with auth.uid() set, so RLS decides the rows
-- exactly as PostgREST would. This is the check that catches auto-exposure the
-- application code never touches.
do $$
declare
  v_cust uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_ord uuid := gen_random_uuid();
  v_reason text; n integer;
begin
  set local session_replication_role = replica;
  -- profiles.id references auth.users(id), so the auth user must exist first;
  -- handle_new_user() then creates the profile row, which is why the insert
  -- below upserts rather than plain-inserts.
  insert into auth.users (id) values (v_cust) on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role, loyalty_points)
    values (v_cust, 'C', '+966500000021', 'customer', 0)
  on conflict (id) do update set full_name = excluded.full_name,
    phone_number = excluded.phone_number, role = excluded.role,
    loyalty_points = excluded.loyalty_points;
  insert into public.branches (id,name_en,name_ar,address_en,address_ar,phone,
                               latitude,longitude,delivery_fee,min_delivery_order,is_active)
    values (v_branch,'B','ب','A','ع','+966500000000',24.7,46.7,15,40,true);
  insert into public.orders (id,customer_id,order_number,branch_id,order_type,
                             subtotal,total,payment_method,payment_status)
    values (v_ord, v_cust, 'SM-2026-000998', v_branch, 'pickup', 50, 50, 'cash', 'pending');
  set local session_replication_role = origin;

  -- Written the way place_order writes it, with the trigger ACTIVE.
  insert into public.loyalty_transactions
    (profile_id, order_id, type, points, balance_after, reason, created_by)
  values (v_cust, v_ord, 'earn', 50, 50, 'Earned on order SM-2026-000998', v_cust);

  perform set_config('test.auth_uid', v_cust::text, true);
  perform set_config('test.is_admin', '', true);
  perform set_config('test.is_staff', '', true);
  set local role authenticated;

  -- The loyalty surface this migration exists to close.
  select count(*) into n from public.loyalty_transactions
   where public.text_has_internal_order_number(reason);
  if n <> 0 then
    raise exception 'CUSTOMER SCAN: loyalty reason still leaks an order number (% rows)', n; end if;
  select reason into v_reason from public.loyalty_transactions limit 1;
  if v_reason is distinct from 'Points earned from an order' then
    raise exception 'CUSTOMER SCAN: unexpected loyalty reason (%)', v_reason; end if;

  -- Operational tables must expose NO rows at all to a plain customer.
  select count(*) into n from public.payment_records;
  if n <> 0 then raise exception 'CUSTOMER SCAN: payment_records visible (% rows)', n; end if;
  select count(*) into n from public.integration_sync_logs;
  if n <> 0 then raise exception 'CUSTOMER SCAN: integration_sync_logs visible (% rows)', n; end if;
  select count(*) into n from public.order_refunds;
  if n <> 0 then raise exception 'CUSTOMER SCAN: order_refunds visible (% rows)', n; end if;

  reset role;
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.auth_uid', '', true);
  raise notice 'CUSTOMER SCAN OK';
end $$;

-- ---- G. SECURITY DEFINER / search_path contract unchanged -------------------
do $$
declare v_bad text;
begin
  -- The pricing authority must still be SECURITY DEFINER with a pinned path.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('place_order', 'insert_order_from_snapshot')
     and (not p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') !~ 'search_path=public');
  if v_bad is not null then
    raise exception 'SECURITY REGRESSION in: %', v_bad; end if;

  -- The new trigger function is deliberately NOT security definer (it only
  -- rewrites NEW) and must still pin its search_path.
  if (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='set_loyalty_safe_reason') then
    raise exception 'set_loyalty_safe_reason must not be SECURITY DEFINER'; end if;
  if (select coalesce(array_to_string(proconfig, ','), '') from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='set_loyalty_safe_reason') !~ 'search_path=public' then
    raise exception 'set_loyalty_safe_reason must pin search_path'; end if;

  raise notice 'SECURITY CONTRACT OK';
end $$;

rollback;
