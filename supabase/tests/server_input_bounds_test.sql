-- ============================================================================
-- Server input bounds and customer order limits
-- (migration 20261005120000_server_input_bounds.sql).
--
-- Every case below FAILS on the chain before that migration and passes with
-- it. Each raises 'CASE n FAILED: ...' on failure, so the harness run (which
-- sets ON_ERROR_STOP) aborts non-zero. To see every case on an older chain,
-- run it with -v ON_ERROR_STOP=0 -v ON_ERROR_ROLLBACK=on.
--
--   CASE 1   S04#1  quantity above 50 refused on both order paths; 50 accepted
--   CASE 2   S04#2  name and email bounds; existing rows stay updatable
--   CASE 3   S04#2  address label and coordinate bounds; same guarantee
--   CASE 4   villa  'villa' is a usable landmark; vertical tabs are whitespace
--   CASE 5   S05#3  an administrator's delete removes the image; nothing lists
--   CASE 6   S02#1  a customer without a verified phone cannot order
--   CASE 7   S07#1  an honest customer orders normally, up to the open limit
--   CASE 8   S07#1  the hourly limit
--   CASE 9   S07#1  the thresholds are read from app_settings
--   CASE 10  S04#2  a staff account provisioned with a long name
--   CASE 11  S07#1  two sessions at the limit: only one order is created
--   CASE 12  S07#1  comped customers: still free, still bounded
--
-- Cases 1-10 and 12 run in one transaction that is rolled back. Case 11 needs two
-- real backends, so it commits its fixtures (this database is disposable) and
-- drives them with dblink. It FAILS rather than skips when dblink cannot
-- connect, because a concurrency rule tested by nothing is not tested.
-- ============================================================================
begin;

-- Every impersonation helper runs `discard plans` before switching role. A
-- plan cached while this session ran as postgres can inline a SQL function
-- and skip its EXECUTE check, so a trigger that a real customer could not run
-- would pass here. That is exactly how the first draft of the migration, which
-- revoked the name helpers from authenticated, passed this suite.

-- Call place_customer_order as a customer and report the outcome as a value:
-- 'OK <order id>' or '<sqlstate> <message>'.
create or replace function pg_temp.try_order(
  p_uid uuid, p_branch uuid, p_items jsonb, p_key uuid default null
) returns text language plpgsql as $$
declare v jsonb; s text;
begin
  perform set_config('test.auth_uid', p_uid::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  discard plans;
  set local role authenticated;
  begin
    v := public.place_customer_order(p_branch, 'pickup', p_items, null, null, null, 0, p_key, 'cash');
    set constraints all immediate;
    s := 'OK ' || (v ->> 'id');
  exception when others then
    s := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('test.auth_uid', '', true);
  return s;
end $$;

-- Run one statement as a signed-in customer and report the SQLSTATE, or 'OK'.
create or replace function pg_temp.as_customer(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare s text;
begin
  perform set_config('test.auth_uid', p_uid::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  discard plans;
  set local role authenticated;
  begin
    execute p_sql;
    s := 'OK';
  exception when others then
    s := sqlstate;
  end;
  reset role;
  perform set_config('test.auth_uid', '', true);
  return s;
end $$;

-- A phone-verified customer, created the way a WhatsApp/phone sign-in creates
-- one: an auth.users row with a confirmed phone, profile made by handle_new_user.
create or replace function pg_temp.new_customer(p_phone text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, phone, phone_confirmed_at) values (v, p_phone, now());
  update public.profiles set full_name = 'Bounds Customer' where id = v;
  return v;
end $$;

create temporary table t_fx (k text primary key, v uuid);

do $$
declare
  v_branch uuid := gen_random_uuid();
  v_cat    uuid := gen_random_uuid();
  v_prod   uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.branches (id, name_en, name_ar, address_en, address_ar, phone,
                               latitude, longitude, delivery_fee, min_delivery_order, is_active)
    values (v_branch, 'Bounds', 'حدود', 'A', 'ع', '+966500000000', 24.7, 46.7, 15, 40, true);
  insert into public.categories (id, name_en, name_ar, sort_order) values (v_cat, 'C', 'ك', 1);
  insert into public.products (id, category_id, name_en, name_ar, price, is_active, sort_order)
    values (v_prod, v_cat, 'P', 'م', 10, true, 1);
  set local session_replication_role = origin;
  insert into t_fx values ('branch', v_branch), ('prod', v_prod);
end $$;

-- ---------------------------------------------------------------------------
-- CASE 1 — S04#1: at most 50 of one item
-- ---------------------------------------------------------------------------
do $$
declare
  v_c      uuid := pg_temp.new_customer('966500000201');
  v_branch uuid := (select v from t_fx where k = 'branch');
  v_prod   uuid := (select v from t_fx where k = 'prod');
  v_order  uuid;
  r        text;
begin
  r := pg_temp.try_order(v_c, v_branch, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 51)));
  if r not like '23514%order_items_quantity_max%' then
    raise exception 'CASE 1 FAILED: 51 of one item gave "%", expected 23514 on order_items_quantity_max', r;
  end if;
  r := pg_temp.try_order(v_c, v_branch, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1000000)));
  if r not like '23514%' then
    raise exception 'CASE 1 FAILED: 1,000,000 of one item gave "%"', r;
  end if;
  if exists (select 1 from public.orders where customer_id = v_c) then
    raise exception 'CASE 1 FAILED: a refused order left an order row';
  end if;

  r := pg_temp.try_order(v_c, v_branch, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 50)));
  if r not like 'OK %' then
    raise exception 'CASE 1 FAILED: exactly 50 was refused: %', r;
  end if;

  -- The table bound also covers the snapshot path, which inserts lines itself.
  v_order := substr(r, 4)::uuid;
  begin
    insert into public.order_items (order_id, product_id, name_en, name_ar,
                                    unit_price, quantity, line_total)
      values (v_order, v_prod, 'P', 'م', 10, 51, 510);
    raise exception 'CASE 1 FAILED: a direct order_items insert of 51 succeeded';
  exception when check_violation then null;
  end;

  raise notice 'CASE 1 ok: 51 and 1,000,000 refused with 23514 and no order; 50 accepted; direct insert bounded';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — S04#2: name and email
-- ---------------------------------------------------------------------------
do $$
declare
  v_c    uuid := pg_temp.new_customer('966500000202');
  v_old  uuid := gen_random_uuid();
  v_name text;
  r      text;
begin
  -- The assessment's own payload: 9,900 letters, a newline, markup, a
  -- right-to-left override, and a 5,000-character email.
  r := pg_temp.as_customer(v_c, format(
    'update public.profiles set full_name = %L, email = %L where id = %L',
    repeat('A', 9900) || E'\n<img src=x onerror=alert(1)>' || chr(8238) || 'evil',
    repeat('x', 5000) || '@not-an-email', v_c));
  if r <> '23514' then
    raise exception 'CASE 2 FAILED: the assessment payload gave %', r;
  end if;

  r := pg_temp.as_customer(v_c, format('update public.profiles set full_name = %L where id = %L', repeat('A', 81), v_c));
  if r <> '23514' then raise exception 'CASE 2 FAILED: an 81-character name gave %', r; end if;
  r := pg_temp.as_customer(v_c, format('update public.profiles set full_name = %L where id = %L', 'Ali' || chr(8238) || 'evil', v_c));
  if r <> '23514' then raise exception 'CASE 2 FAILED: a bidi override gave %', r; end if;
  -- Each of the twelve bidi formatting characters, one at a time. The rule
  -- holds them as \uXXXX escapes; a slip in one escape shows up here.
  declare c int;
  begin
    foreach c in array array[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297] loop
      r := pg_temp.as_customer(v_c, format('update public.profiles set full_name = %L where id = %L', 'Ali' || chr(c) || 'b', v_c));
      if r <> '23514' then raise exception 'CASE 2 FAILED: U+% in a name gave %', upper(to_hex(c)), r; end if;
    end loop;
    -- A zero-width non-joiner, which Persian and some Arabic names carry, is not refused.
    r := pg_temp.as_customer(v_c, format('update public.profiles set full_name = %L where id = %L', 'Ali' || chr(8204) || 'b', v_c));
    if r <> 'OK' then raise exception 'CASE 2 FAILED: U+200C in a name gave %', r; end if;
  end;
  r := pg_temp.as_customer(v_c, format('update public.profiles set full_name = %L where id = %L', 'Ali' || chr(7), v_c));
  if r <> '23514' then raise exception 'CASE 2 FAILED: a control character gave %', r; end if;
  r := pg_temp.as_customer(v_c, format('update public.profiles set email = %L where id = %L', repeat('x', 243) || '@example.com', v_c));
  if r <> '23514' then raise exception 'CASE 2 FAILED: a 255-character email gave %', r; end if;

  -- What the app sends is accepted, and whitespace is folded the same way.
  r := pg_temp.as_customer(v_c, format('update public.profiles set full_name = %L where id = %L', repeat('A', 80), v_c));
  if r <> 'OK' then raise exception 'CASE 2 FAILED: an 80-character name gave %', r; end if;
  r := pg_temp.as_customer(v_c, format('update public.profiles set full_name = %L where id = %L', E'  محمد \t\n علي  ', v_c));
  if r <> 'OK' then raise exception 'CASE 2 FAILED: an Arabic name gave %', r; end if;
  select full_name into v_name from public.profiles where id = v_c;
  if v_name is distinct from 'محمد علي' then
    raise exception 'CASE 2 FAILED: stored name is %, expected it normalised', v_name;
  end if;
  r := pg_temp.as_customer(v_c, format('update public.profiles set email = %L where id = %L', repeat('x', 242) || '@example.com', v_c));
  if r <> 'OK' then raise exception 'CASE 2 FAILED: a 254-character email gave %', r; end if;

  -- A row that predates the rule stays updatable on every other column.
  set local session_replication_role = replica;
  insert into auth.users (id) values (v_old);
  insert into public.profiles (id, full_name, email, role)
    values (v_old, repeat('O', 200) || chr(7), repeat('y', 300), 'customer');
  set local session_replication_role = origin;
  update public.profiles set phone_number = '966500000099', loyalty_points = 3 where id = v_old;
  r := pg_temp.as_customer(v_old, format('update public.profiles set full_name = full_name, email = email where id = %L', v_old));
  if r <> 'OK' then
    raise exception 'CASE 2 FAILED: re-saving an unchanged legacy name gave %', r;
  end if;

  raise notice 'CASE 2 ok: long, control and bidi names and long emails refused; app values accepted; legacy rows updatable';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — S04#2: address label and coordinates
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_customer('966500000211');
  v_old uuid := gen_random_uuid();
  r     text;
  ins   text := 'insert into public.addresses (customer_id, label, description, latitude, longitude) values (%L, %L, %L, %s, %s)';
begin
  r := pg_temp.as_customer(v_c, format(ins, v_c, repeat('L', 10000), 'blue gate beside the pharmacy', '24.7', '46.7'));
  if r <> '23514' then raise exception 'CASE 3 FAILED: a 10,000-character label gave %', r; end if;
  r := pg_temp.as_customer(v_c, format(ins, v_c, repeat('L', 61), 'blue gate beside the pharmacy', '24.7', '46.7'));
  if r <> '23514' then raise exception 'CASE 3 FAILED: a 61-character label gave %', r; end if;
  r := pg_temp.as_customer(v_c, format(ins, v_c, 'Home', 'blue gate beside the pharmacy', '999', '-999'));
  if r <> '23514' then raise exception 'CASE 3 FAILED: lat 999 / lng -999 gave %', r; end if;
  r := pg_temp.as_customer(v_c, format(ins, v_c, 'Home', 'blue gate beside the pharmacy', '24.7', '180.5'));
  if r <> '23514' then raise exception 'CASE 3 FAILED: lng 180.5 gave %', r; end if;
  r := pg_temp.as_customer(v_c, format(ins, v_c, 'Home', 'blue gate beside the pharmacy', '''NaN''::float8', '46.7'));
  if r <> '23514' then raise exception 'CASE 3 FAILED: a NaN latitude gave %', r; end if;

  r := pg_temp.as_customer(v_c, format(ins, v_c, repeat('L', 60), 'blue gate beside the pharmacy', '-90', '180'));
  if r <> 'OK' then raise exception 'CASE 3 FAILED: a 60-character label at (-90, 180) gave %', r; end if;
  r := pg_temp.as_customer(v_c, format('update public.addresses set latitude = 91 where customer_id = %L', v_c));
  if r <> '23514' then raise exception 'CASE 3 FAILED: moving a pin to lat 91 gave %', r; end if;

  -- A row that predates the rule stays updatable on every other column.
  set local session_replication_role = replica;
  insert into public.addresses (id, customer_id, label, description, latitude, longitude)
    values (v_old, v_c, repeat('Z', 90), 'old landmark text', 500, 500);
  set local session_replication_role = origin;
  r := pg_temp.as_customer(v_c, format('update public.addresses set description = %L, is_default = true where id = %L',
                                       'the green door after the mosque', v_old));
  if r <> 'OK' then raise exception 'CASE 3 FAILED: editing the landmark of a legacy address gave %', r; end if;

  raise notice 'CASE 3 ok: long labels and impossible coordinates refused; 60 characters and the poles accepted; legacy rows updatable';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — the villa bug
-- ---------------------------------------------------------------------------
do $$
declare
  v_c uuid := pg_temp.new_customer('966500000212');
  r   text;
begin
  if not public.address_description_is_usable('villa') then
    raise exception 'CASE 4 FAILED: ''villa'' is not a usable landmark (the trim set holds the letter v)';
  end if;
  -- Six visible characters. The app accepts it; before the fix the server
  -- trimmed every v and refused it.
  if not public.address_description_is_usable('vvvv v') then
    raise exception 'CASE 4 FAILED: ''vvvv v'' was trimmed to nothing';
  end if;
  if public.address_description_is_usable(repeat(chr(11), 6)) then
    raise exception 'CASE 4 FAILED: six vertical tabs are a usable landmark';
  end if;
  if public.address_description_is_usable(chr(11) || ' ' || chr(9) || chr(11) || chr(10) || chr(11) || ' ' || chr(11)) then
    raise exception 'CASE 4 FAILED: mixed whitespace with vertical tabs is a usable landmark';
  end if;
  if public.address_description_is_usable(chr(11) || 'abc' || chr(11)) then
    raise exception 'CASE 4 FAILED: vertical tabs counted toward the five-character minimum';
  end if;

  r := pg_temp.as_customer(v_c, format(
    'insert into public.addresses (customer_id, label, description, latitude, longitude) values (%L, %L, %L, 24.7, 46.7)',
    v_c, 'Home', 'villa'));
  if r <> 'OK' then raise exception 'CASE 4 FAILED: saving the landmark ''villa'' gave %', r; end if;

  raise notice 'CASE 4 ok: villa and vvvv v accepted; vertical-tab whitespace refused';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — S05#3: an administrator's remove() deletes the image
-- ---------------------------------------------------------------------------
-- The harness replaces jwt_has_aal2() with true. Restore the production body
-- for this transaction so aal1 and aal2 differ, and grant anon what Production
-- grants it on storage.objects (read live 2026-11-11), so the anon checks
-- cannot pass for want of a privilege.
create or replace function public.jwt_has_aal2()
returns boolean language sql stable set search_path = public as $$
  select public.aal_claim_satisfies_staff_mfa(auth.jwt() ->> 'aal');
$$;
grant select, insert, update, delete on storage.objects to anon;

create or replace function pg_temp.storage_count(
  p_role text, p_uid uuid, p_aal text, p_operation text, p_sql text
) returns text language plpgsql as $$
declare n bigint; s text;
begin
  perform set_config('test.auth_uid', '', true);
  perform set_config('test.is_staff', '', true);
  perform set_config('test.is_admin', '', true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"anon"}'
         else json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  -- What the Storage server does for the route it is serving.
  perform set_config('storage.operation', coalesce(p_operation, ''), true);
  discard plans;
  execute format('set local role %I', p_role);
  begin
    execute format('with q as (%s) select count(*) from q', p_sql) into n;
    s := n::text;
  exception when others then
    s := sqlstate;
  end;
  reset role;
  perform set_config('storage.operation', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return s;
end $$;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_cust  uuid := pg_temp.new_customer('966500000213');
  r       text;
  del_p   text := $q$delete from storage.objects where bucket_id = 'product-images' and name = 'products/1700000000000-x.jpg' returning 1$q$;
  del_b   text := $q$delete from storage.objects where bucket_id = 'banner-images' and name = 'banners/1700000000000-y.jpg' returning 1$q$;
begin
  insert into auth.users (id, email, email_confirmed_at) values (v_admin, 'bounds-admin@example.test', now());
  update public.profiles set role = 'admin' where id = v_admin;

  insert into storage.objects (bucket_id, name, owner) values
    ('product-images', 'products/1700000000000-x.jpg', v_admin),
    ('product-images', 'products/1700000000001-z.jpg', v_admin),
    ('banner-images',  'banners/1700000000000-y.jpg',  v_admin);

  -- Nobody can list: not anon, not a customer, not even an administrator, and
  -- not under the list operation.
  r := pg_temp.storage_count('anon', null, null, null, 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: anon lists % objects', r; end if;
  r := pg_temp.storage_count('authenticated', v_cust, 'aal1', 'storage.object.list', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: a customer lists % objects', r; end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', null, 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator lists % objects outside a delete', r; end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'storage.object.list_v2', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator lists % objects under list_v2', r; end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'storage.object.list', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator lists % objects under list', r; end if;
  -- Any other operation the Storage server names, too: reading one object,
  -- getting its info, signing a URL.
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'storage.object.get_authenticated', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator sees % objects under get_authenticated', r; end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'object.get_authenticated_info', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator sees % objects under get_authenticated_info', r; end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'storage.object.sign', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator sees % objects under sign', r; end if;

  -- Inside a delete, the rows are visible to an administrator at AAL2 only.
  r := pg_temp.storage_count('authenticated', v_cust, 'aal1', 'storage.object.delete_many', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: a customer sees % objects during a delete', r; end if;
  r := pg_temp.storage_count('anon', null, null, 'storage.object.delete_many', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: anon sees % objects during a delete', r; end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal1', 'storage.object.delete_many', 'select 1 from storage.objects');
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator at aal1 sees % objects during a delete', r; end if;

  -- Nobody but an administrator at AAL2 deletes, even under a delete operation.
  r := pg_temp.storage_count('anon', null, null, 'storage.object.delete_many', del_p);
  if r <> '0' then raise exception 'CASE 5 FAILED: anon deleted % objects', r; end if;
  r := pg_temp.storage_count('authenticated', v_cust, 'aal1', 'storage.object.delete_many', del_p);
  if r <> '0' then raise exception 'CASE 5 FAILED: a customer deleted % objects', r; end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal1', 'storage.object.delete_many', del_p);
  if r <> '0' then raise exception 'CASE 5 FAILED: an administrator at aal1 deleted % objects', r; end if;

  -- The defect: an administrator's remove() (delete_many) matched nothing.
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'storage.object.delete_many', del_p);
  if r <> '1' then raise exception 'CASE 5 FAILED: an administrator''s remove() deleted % product images, expected 1', r; end if;
  if exists (select 1 from storage.objects where name = 'products/1700000000000-x.jpg') then
    raise exception 'CASE 5 FAILED: the product image is still stored';
  end if;
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'storage.object.delete_many', del_b);
  if r <> '1' then raise exception 'CASE 5 FAILED: an administrator''s remove() deleted % banner images, expected 1', r; end if;
  -- The single-object route too.
  r := pg_temp.storage_count('authenticated', v_admin, 'aal2', 'storage.object.delete',
    $q$delete from storage.objects where bucket_id = 'product-images' and name = 'products/1700000000001-z.jpg' returning 1$q$);
  if r <> '1' then raise exception 'CASE 5 FAILED: the single-object delete removed %, expected 1', r; end if;

  raise notice 'CASE 5 ok: admin@aal2 deletes product and banner images; no role lists either bucket';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — S02#1: no verified phone, no order
-- ---------------------------------------------------------------------------
do $$
declare
  v_email uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_unconf uuid := gen_random_uuid();
  v_branch uuid := (select v from t_fx where k = 'branch');
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', (select v from t_fx where k = 'prod'), 'quantity', 1));
  r text;
begin
  -- An email/password account, as the console's old Create Account tab made
  -- one. The metadata phone is not trusted (handle_new_user ignores it).
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (v_email, 'synthetic.signup@example.test', now(), '{"full_name":"Synthetic Signup","phone":"+966500009901"}');
  r := pg_temp.try_order(v_email, v_branch, v_items);
  if r not like 'P0001 Please verify your phone number before placing an order.%' then
    raise exception 'CASE 6 FAILED: an email-only account ordering gave "%"', r;
  end if;
  if exists (select 1 from public.orders where customer_id = v_email) then
    raise exception 'CASE 6 FAILED: the refused order left a row';
  end if;

  -- A phone that was never confirmed does not count: the profile carries the
  -- number, but nothing proved the caller owns it.
  insert into auth.users (id, phone) values (v_unconf, '966500000214');
  r := pg_temp.try_order(v_unconf, v_branch, v_items);
  if r not like 'P0001 Please verify your phone number%' then
    raise exception 'CASE 6 FAILED: an unconfirmed phone ordering gave "%"', r;
  end if;

  -- A staff account is not phone-verified either.
  insert into auth.users (id, email, email_confirmed_at) values (v_staff, 'bounds-cc@example.test', now());
  update public.profiles set role = 'call_center' where id = v_staff;
  r := pg_temp.try_order(v_staff, v_branch, v_items);
  if r not like 'P0001 Please verify your phone number%' then
    raise exception 'CASE 6 FAILED: a staff account ordering gave "%"', r;
  end if;

  -- The grant did not move.
  if has_function_privilege('anon',
       'public.place_customer_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)', 'execute') then
    raise exception 'CASE 6 FAILED: anon can execute place_customer_order';
  end if;

  raise notice 'CASE 6 ok: email-only, unconfirmed-phone and staff accounts refused with P0001; anon still has no grant';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — S07#1: an honest customer, and the open-order limit
-- ---------------------------------------------------------------------------
do $$
declare
  v_c      uuid := pg_temp.new_customer('966500000301');
  v_other  uuid := pg_temp.new_customer('966500000801');
  v_branch uuid := (select v from t_fx where k = 'branch');
  v_items  jsonb := jsonb_build_array(jsonb_build_object('product_id', (select v from t_fx where k = 'prod'), 'quantity', 2));
  v_key    uuid := gen_random_uuid();
  v_last   text;
  r        text;
  i        int;
begin
  -- Five ordinary orders, the last with an idempotency key.
  for i in 1..5 loop
    r := pg_temp.try_order(v_c, v_branch, v_items, case when i = 5 then v_key end);
    if r not like 'OK %' then
      raise exception 'CASE 7 FAILED: honest order % of 5 was refused: %', i, r;
    end if;
  end loop;
  v_last := r;

  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'P0001 You already have 5 orders in progress.%' then
    raise exception 'CASE 7 FAILED: a sixth open order gave "%"', r;
  end if;

  -- A lost-response retry of order 5 still returns order 5.
  r := pg_temp.try_order(v_c, v_branch, v_items, v_key);
  if r is distinct from v_last then
    raise exception 'CASE 7 FAILED: the idempotent retry gave "%", expected "%"', r, v_last;
  end if;

  -- Another customer is unaffected.
  r := pg_temp.try_order(v_other, v_branch, v_items);
  if r not like 'OK %' then raise exception 'CASE 7 FAILED: another customer was refused: %', r; end if;

  -- Delivering one order frees a slot.
  set local session_replication_role = replica;
  update public.orders set status = 'delivered'
   where id = (select id from public.orders where customer_id = v_c order by created_at, id limit 1);
  set local session_replication_role = origin;
  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'OK %' then raise exception 'CASE 7 FAILED: an order after one was delivered was refused: %', r; end if;

  -- An order nobody closed still counts at 23 hours: the window is a day,
  -- not two hours or one.
  set local session_replication_role = replica;
  update public.orders set created_at = now() - interval '23 hours'
   where customer_id = v_c and status = 'received';
  set local session_replication_role = origin;
  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'P0001 You already have 5 orders in progress.%' then
    raise exception 'CASE 7 FAILED: five open orders placed 23 hours ago gave "%", expected the open-order refusal', r;
  end if;

  -- An order nobody closed stops counting after 24 hours.
  set local session_replication_role = replica;
  update public.orders set created_at = now() - interval '25 hours'
   where customer_id = v_c and status = 'received';
  set local session_replication_role = origin;
  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'OK %' then raise exception 'CASE 7 FAILED: stale open orders still counted: %', r; end if;

  raise notice 'CASE 7 ok: 5 honest orders accepted, the 6th refused (also at 23 hours), retries and other customers unaffected, delivered and stale orders free slots';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — S07#1: the hourly limit
-- ---------------------------------------------------------------------------
do $$
declare
  v_c      uuid := pg_temp.new_customer('966500000802');
  v_branch uuid := (select v from t_fx where k = 'branch');
  v_items  jsonb := jsonb_build_array(jsonb_build_object('product_id', (select v from t_fx where k = 'prod'), 'quantity', 1));
  r        text;
  i        int;
begin
  -- Ten orders in the hour, each cancelled straight away so the open limit
  -- never applies.
  for i in 1..10 loop
    r := pg_temp.try_order(v_c, v_branch, v_items);
    if r not like 'OK %' then
      raise exception 'CASE 8 FAILED: order % of 10 was refused: %', i, r;
    end if;
    set local session_replication_role = replica;
    update public.orders set status = 'cancelled' where id = substr(r, 4)::uuid;
    set local session_replication_role = origin;
  end loop;

  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'P0001 You have placed 10 orders in the last hour.%' then
    raise exception 'CASE 8 FAILED: an eleventh order in the hour gave "%"', r;
  end if;

  -- At 59 minutes they still count: the window is an hour, not a minute.
  set local session_replication_role = replica;
  update public.orders set created_at = now() - interval '59 minutes' where customer_id = v_c;
  set local session_replication_role = origin;
  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'P0001 You have placed 10 orders in the last hour.%' then
    raise exception 'CASE 8 FAILED: ten orders placed 59 minutes ago gave "%", expected the hourly refusal', r;
  end if;

  -- Once the hour has passed, ordering works again.
  set local session_replication_role = replica;
  update public.orders set created_at = now() - interval '61 minutes' where customer_id = v_c;
  set local session_replication_role = origin;
  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'OK %' then raise exception 'CASE 8 FAILED: an order after the hour was refused: %', r; end if;

  raise notice 'CASE 8 ok: 10 orders in the hour accepted, the 11th refused (also at 59 minutes), accepted again after the hour';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9 — S07#1: thresholds come from app_settings
-- ---------------------------------------------------------------------------
do $$
declare
  v_c      uuid := pg_temp.new_customer('966500000803');
  v_branch uuid := (select v from t_fx where k = 'branch');
  v_items  jsonb := jsonb_build_array(jsonb_build_object('product_id', (select v from t_fx where k = 'prod'), 'quantity', 1));
  r        text;
begin
  execute 'update public.app_settings set order_limit_open = 2 where id = true';
  perform pg_temp.try_order(v_c, v_branch, v_items);
  perform pg_temp.try_order(v_c, v_branch, v_items);
  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'P0001 You already have 2 orders in progress.%' then
    raise exception 'CASE 9 FAILED: with order_limit_open = 2 a third order gave "%"', r;
  end if;
  execute 'update public.app_settings set order_limit_open = 5 where id = true';

  begin
    execute 'update public.app_settings set order_limit_per_hour = 0 where id = true';
    raise exception 'CASE 9 FAILED: a zero hourly limit was stored';
  exception when check_violation then null;
  end;

  raise notice 'CASE 9 ok: order_limit_open is read live; a zero limit is refused';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10 — S04#2: staff provisioning with a long name cannot break
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_long  uuid := gen_random_uuid();
  v_name  text;
  v_email text;
  v_role  text;
begin
  insert into auth.users (id, email, email_confirmed_at) values (v_admin, 'bounds-admin2@example.test', now());
  update public.profiles set role = 'admin' where id = v_admin;

  -- What staff-accounts does: admin.createUser with user_metadata.full_name,
  -- then admin_set_user_role as the calling administrator.
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (v_staff, 'bounds-staff@example.test', now(),
            jsonb_build_object('full_name', '  ' || repeat('Nasser ', 20) || chr(7) || 'Al-Long  '));
  select full_name into v_name from public.profiles where id = v_staff;
  if v_name is null or char_length(v_name) > 80 or v_name ~ '[\x01-\x1f\x7f-\x9f]'
     or v_name <> btrim(v_name) then
    raise exception 'CASE 10 FAILED: provisioned name is % (% chars)', v_name, char_length(v_name);
  end if;

  -- Every bidi formatting character in a metadata name is removed, so the
  -- signup still succeeds and the stored name is clean.
  declare v_bidi uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      values (v_bidi, 'bounds-bidi@example.test', now(),
              jsonb_build_object('full_name', 'Sara' || chr(1564) || chr(8206) || chr(8207) || chr(8234) || chr(8235)
                || chr(8236) || chr(8237) || chr(8238) || chr(8294) || chr(8295) || chr(8296) || chr(8297) || ' Ali'));
    select full_name into v_name from public.profiles where id = v_bidi;
    if v_name is distinct from 'Sara Ali' then
      raise exception 'CASE 10 FAILED: a metadata name with bidi characters was stored as % (% chars)', v_name, char_length(v_name);
    end if;
  end;

  -- CASE 5 restored the production jwt_has_aal2() for this transaction, so the
  -- administrator needs a real aal2 claim here.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform public.admin_set_user_role(v_staff, 'call_center', 'Operations console account provisioning');
  perform set_config('test.auth_uid', '', true);
  perform set_config('test.is_admin', '', true);
  select role::text into v_role from public.profiles where id = v_staff;
  if v_role is distinct from 'call_center' then
    raise exception 'CASE 10 FAILED: the role change after provisioning left role %', v_role;
  end if;

  -- An email longer than the profile bound still signs up; the profile simply
  -- does not copy it.
  insert into auth.users (id, email, email_confirmed_at) values (v_long, repeat('e', 250) || '@example.test', now());
  select email into v_email from public.profiles where id = v_long;
  if not found then raise exception 'CASE 10 FAILED: a long email produced no profile'; end if;
  if v_email is not null then raise exception 'CASE 10 FAILED: a % character email was copied', char_length(v_email); end if;

  raise notice 'CASE 10 ok: a long metadata name is trimmed to 80 clean characters and the role change works';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 12 — comped customers go through the same wrapper
-- ---------------------------------------------------------------------------
-- A comped customer's cash order is placed by place_customer_order like any
-- other (SM-2026-000055 and -000056 were). The rules must not break a comp,
-- and a comp must not escape them: a comp is free food with no cap, which is
-- the reason the limit matters most here.
do $$
declare
  v_c      uuid := pg_temp.new_customer('966500000901');
  v_email  uuid := gen_random_uuid();
  v_branch uuid := (select v from t_fx where k = 'branch');
  v_items  jsonb := jsonb_build_array(jsonb_build_object('product_id', (select v from t_fx where k = 'prod'), 'quantity', 3));
  v_total  numeric;
  v_comp   boolean;
  r        text;
  i        int;
begin
  insert into public.comp_members (profile_id, is_active, note) values (v_c, true, 'bounds suite');
  for i in 1..5 loop
    r := pg_temp.try_order(v_c, v_branch, v_items);
    if r not like 'OK %' then raise exception 'CASE 12 FAILED: comped order % was refused: %', i, r; end if;
  end loop;
  select total, is_comped into v_total, v_comp from public.orders where id = substr(r, 4)::uuid;
  if v_total is distinct from 0 or v_comp is distinct from true then
    raise exception 'CASE 12 FAILED: the comped order is total %, is_comped %', v_total, v_comp;
  end if;
  r := pg_temp.try_order(v_c, v_branch, v_items);
  if r not like 'P0001 You already have 5 orders in progress.%' then
    raise exception 'CASE 12 FAILED: a sixth comped order gave "%"', r;
  end if;

  -- A comp keyed on the profile of an account with no verified phone does
  -- not let that account order.
  insert into auth.users (id, email, email_confirmed_at) values (v_email, 'bounds-comp@example.test', now());
  insert into public.comp_members (profile_id, is_active, note) values (v_email, true, 'bounds suite');
  r := pg_temp.try_order(v_email, v_branch, v_items);
  if r not like 'P0001 Please verify your phone number%' then
    raise exception 'CASE 12 FAILED: a comped email-only account ordering gave "%"', r;
  end if;

  raise notice 'CASE 12 ok: comped orders still total 0 through the wrapper, and are bounded like any other';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- CASE 11 — S07#1: two sessions at the limit, only one order
-- ---------------------------------------------------------------------------
-- The customer holds 4 open orders. Session A places the fifth and keeps its
-- transaction open. Session B then tries a fifth too. B must wait for A, see
-- A's order once it commits, and be refused. Without the lock B counts 4,
-- passes, and both commit: 6 open orders.
create extension if not exists dblink;

create or replace function public.zz_bounds_try(p_uid uuid, p_branch uuid, p_prod uuid)
returns text language plpgsql as $$
declare v jsonb;
begin
  perform set_config('test.auth_uid', p_uid::text, true);
  set local role authenticated;
  v := public.place_customer_order(p_branch, 'pickup',
         jsonb_build_array(jsonb_build_object('product_id', p_prod, 'quantity', 1)),
         null, null, null, 0, null, 'cash');
  reset role;
  return 'OK ' || (v ->> 'id');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create table public.zz_bounds_fx (k text primary key, v uuid);

do $$
declare
  v_branch uuid := gen_random_uuid();
  v_cat    uuid := gen_random_uuid();
  v_prod   uuid := gen_random_uuid();
  v_c      uuid := gen_random_uuid();
  r        text;
  i        int;
begin
  set local session_replication_role = replica;
  insert into public.branches (id, name_en, name_ar, address_en, address_ar, phone,
                               latitude, longitude, delivery_fee, min_delivery_order, is_active)
    values (v_branch, 'Race', 'سباق', 'A', 'ع', '+966500000000', 24.7, 46.7, 15, 40, true);
  insert into public.categories (id, name_en, name_ar, sort_order) values (v_cat, 'C', 'ك', 1);
  insert into public.products (id, category_id, name_en, name_ar, price, is_active, sort_order)
    values (v_prod, v_cat, 'P', 'م', 10, true, 1);
  set local session_replication_role = origin;
  insert into auth.users (id, phone, phone_confirmed_at) values (v_c, '966500000902', now());
  for i in 1..4 loop
    r := public.zz_bounds_try(v_c, v_branch, v_prod);
    if r not like 'OK %' then raise exception 'CASE 11 FAILED: fixture order % was refused: %', i, r; end if;
  end loop;
  insert into public.zz_bounds_fx values ('branch', v_branch), ('prod', v_prod), ('cust', v_c);
end $$;

do $$
declare
  v_conn   text := format('dbname=%s user=%s', current_database(), current_user);
  v_branch uuid := (select v from public.zz_bounds_fx where k = 'branch');
  v_prod   uuid := (select v from public.zz_bounds_fx where k = 'prod');
  v_c      uuid := (select v from public.zz_bounds_fx where k = 'cust');
  v_call   text;
  v_pid_b  int;
  v_wait   text;
  r_a      text;
  r_b      text;
  v_n      int;
  i        int;
begin
  perform dblink_connect('bounds_a', v_conn);
  perform dblink_connect('bounds_b', v_conn);
  v_call := format('select public.zz_bounds_try(%L, %L, %L)', v_c, v_branch, v_prod);

  -- A: place the fifth order and hold the transaction open.
  perform dblink_exec('bounds_a', 'begin');
  select t.r into r_a from dblink('bounds_a', v_call) as t(r text);
  if r_a not like 'OK %' then
    raise exception 'CASE 11 FAILED: session A was refused: %', r_a;
  end if;

  -- B: try the same while A is open.
  select t.p into v_pid_b from dblink('bounds_b', 'select pg_backend_pid()') as t(p int);
  perform dblink_exec('bounds_b', 'begin');
  perform dblink_send_query('bounds_b', v_call);

  -- B must be waiting on a lock A holds; otherwise this is not a race.
  for i in 1..200 loop
    select string_agg(distinct l.locktype, ',') into v_wait
      from pg_locks l where l.pid = v_pid_b and not l.granted;
    exit when v_wait is not null;
    perform pg_sleep(0.025);
  end loop;

  perform dblink_exec('bounds_a', 'commit');
  select t.r into r_b from dblink_get_result('bounds_b') as t(r text);
  perform * from dblink_get_result('bounds_b') as t(r text);
  perform dblink_exec('bounds_b', 'commit');
  perform dblink_disconnect('bounds_a');
  perform dblink_disconnect('bounds_b');

  select count(*) into v_n from public.orders where customer_id = v_c;
  raise notice 'CASE 11: A=% | B waited on [%] | B=% | orders=%', r_a, coalesce(v_wait, 'nothing'), r_b, v_n;

  if v_wait is null then
    raise exception 'CASE 11 FAILED: session B never waited for session A';
  end if;
  if r_b not like 'P0001 You already have 5 orders in progress.%' then
    raise exception 'CASE 11 FAILED: session B gave "%", expected the open-order refusal', r_b;
  end if;
  if v_n is distinct from 5 then
    raise exception 'CASE 11 FAILED: the customer has % orders, expected 5', v_n;
  end if;

  raise notice 'CASE 11 ok: two sessions at the limit, B waited on the lock and was refused; 5 orders';
end $$;

drop function public.zz_bounds_try(uuid, uuid, uuid);
drop table public.zz_bounds_fx;
