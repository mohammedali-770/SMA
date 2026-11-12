-- ============================================================================
-- Audit trail (20261007120000): order status, broadcasts, staff accounts and
-- admin table edits.
--
-- Runs against a THROWAWAY Postgres with the whole migration chain applied
-- (`.github/sql-ci/run.sh`). Every case RAISES EXCEPTION on failure; the outer
-- transaction rolls every fixture back.
--
-- The harness impersonates callers with test.* settings: test.auth_uid is what
-- auth.uid() returns, test.is_admin / test.is_staff decide is_admin() and
-- is_staff(), and jwt_has_aal2() is true, so an admin here is an AAL2 admin.
-- The migration's own check fires its trigger FUNCTIONS on temporary tables;
-- this suite fires the REAL triggers on the real tables.
--
-- Covers:
--   1. Placing an order writes no status audit row.
--   2. An AAL2 admin advancing it through admin_set_order_status writes one
--      row: old/new status, changed_by = the admin, actor_role admin, manual.
--   3. A second transition writes a second row, chained from the first.
--   4. A status change with no auth.uid() (service role, cron) is
--      'automatic' with a null changed_by.
--   5. A non-status update (the POS webhook's lazywait_status) and a write of
--      the same status write nothing.
--   6. anon and authenticated cannot write either audit table (42501); anon
--      cannot read them; a customer reads no status row; an accountant and an
--      admin read the status trail.
--   7. A product price change by an admin writes admin_action_audit with
--      changed_columns {price}, the old and new price, and the admin as actor.
--   8. An app_settings change records the column and value; a key-like column
--      is recorded by name with no value; an updated_at-only write and a
--      coupons usage_count-only write record nothing.
--  8b. Only an admin reads admin_action_audit: a customer and an accountant
--      read none of its rows.
--   9. record_admin_action is refused for anon and authenticated (42501),
--      works for service_role, and refuses a credential-like detail key.
--  10. notification_log carries sent_by/content, a client cannot write it,
--      and a customer cannot read it.
--  11. Both audit tables are append-only for every role, the owner included.
-- ============================================================================
begin;

\set eater  '''0a000000-0000-0000-0000-0000000a0001'''
\set admin  '''0a000000-0000-0000-0000-0000000a0ad1'''
\set clerk  '''0a000000-0000-0000-0000-0000000a0ac1'''

insert into auth.users (id, email) values
  (:eater, 'audit-eater@x'),
  (:admin, 'audit-admin@x'),
  (:clerk, 'audit-clerk@x');

insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:eater, 'customer',   'Audit Eater', '+966500000701', 0),
  (:admin, 'admin',      'Audit Admin', '+966500000702', 0),
  (:clerk, 'accountant', 'Audit Clerk', '+966500000703', 0)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number,
  loyalty_points = excluded.loyalty_points;

update public.app_settings
   set cash_payment_enabled = true,
       online_payment_enabled = false,
       default_payment_method = 'cash'
 where id = true;

create temp table t_ctx (label text primary key, order_id uuid);
grant select on t_ctx to authenticated, anon, service_role;

-- admin_action_audit already holds rows when this suite starts: on the CI chain
-- the migration runs BEFORE supabase/seed.sql, so every seeded product,
-- category and coupon was recorded as a system insert, and the setup write
-- above may have been too. Cases 7-9 look only at rows after this mark.
create temp table t_mark as select coalesce(max(id), 0) as id from public.admin_action_audit;
grant select on t_mark to authenticated, anon, service_role;

-- Impersonation helpers, so each case states who it is in one line.
create function pg_temp.as_customer() returns void language sql as $$
  select set_config('test.auth_uid', '0a000000-0000-0000-0000-0000000a0001', true),
         set_config('test.is_admin', 'false', true),
         set_config('test.is_staff', 'false', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('test.auth_uid', '0a000000-0000-0000-0000-0000000a0ad1', true),
         set_config('test.is_admin', 'true', true),
         set_config('test.is_staff', 'true', true);
$$;
create function pg_temp.as_clerk() returns void language sql as $$
  select set_config('test.auth_uid', '0a000000-0000-0000-0000-0000000a0ac1', true),
         set_config('test.is_admin', 'false', true),
         set_config('test.is_staff', 'true', true);
$$;
create function pg_temp.as_nobody() returns void language sql as $$
  select set_config('test.auth_uid', '', true),
         set_config('test.is_admin', '', true),
         set_config('test.is_staff', '', true);
$$;

-- ============================================================================
-- CASE 1 — placing an order writes no status audit row.
-- ============================================================================
do $$
declare o public.orders; v_n integer;
begin
  perform pg_temp.as_customer();
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  insert into t_ctx values ('order', o.id);
  if o.status is distinct from 'received' then
    raise exception 'CASE 1: new order is %, expected received', o.status; end if;
  select count(*) into v_n from public.order_status_audit where order_id = o.id;
  if v_n <> 0 then
    raise exception 'CASE 1: placing an order wrote % status audit row(s)', v_n; end if;
  raise notice 'CASE 1 ok — placement writes no status audit row';
end $$;

-- ============================================================================
-- CASE 2 — an AAL2 admin's admin_set_order_status is recorded as manual.
-- ============================================================================
select pg_temp.as_admin();
set local role authenticated;
select public.admin_set_order_status((select order_id from t_ctx where label = 'order'), 'preparing');
reset role;

do $$
declare r public.order_status_audit; v_n integer;
begin
  select count(*) into v_n from public.order_status_audit
   where order_id = (select order_id from t_ctx where label = 'order');
  if v_n <> 1 then
    raise exception 'CASE 2: % audit rows after one transition, expected 1', v_n; end if;
  select * into r from public.order_status_audit
   where order_id = (select order_id from t_ctx where label = 'order');
  if r.old_status is distinct from 'received' or r.new_status is distinct from 'preparing' then
    raise exception 'CASE 2: recorded % -> %, expected received -> preparing', r.old_status, r.new_status; end if;
  if r.changed_by is distinct from '0a000000-0000-0000-0000-0000000a0ad1'::uuid then
    raise exception 'CASE 2: changed_by %, expected the admin', r.changed_by; end if;
  if r.actor_role is distinct from 'admin' then
    raise exception 'CASE 2: actor_role %, expected admin', r.actor_role; end if;
  if r.source is distinct from 'manual' then
    raise exception 'CASE 2: source %, expected manual', r.source; end if;
  if r.changed_at is null then
    raise exception 'CASE 2: changed_at is null'; end if;
  raise notice 'CASE 2 ok — admin transition recorded with actor, role and source manual';
end $$;

-- ============================================================================
-- CASE 3 — a second transition writes a second row. (Clients hold no UPDATE
-- on orders since 20260724200000, so admin_set_order_status is the only
-- client path; CASE 4 covers the server-side one.)
-- ============================================================================
select pg_temp.as_admin();
set local role authenticated;
select public.admin_set_order_status((select order_id from t_ctx where label = 'order'), 'ready');
reset role;

do $$
declare r public.order_status_audit;
begin
  select * into r from public.order_status_audit
   where order_id = (select order_id from t_ctx where label = 'order')
     and new_status = 'ready';
  if not found then
    raise exception 'CASE 3: the second transition was not audited'; end if;
  if r.old_status is distinct from 'preparing' or r.source is distinct from 'manual'
     or r.changed_by is distinct from '0a000000-0000-0000-0000-0000000a0ad1'::uuid then
    raise exception 'CASE 3: recorded % -> % by % (%)', r.old_status, r.new_status, r.changed_by, r.source; end if;
  raise notice 'CASE 3 ok — each transition is its own row';
end $$;

-- ============================================================================
-- CASE 4 — no auth.uid(): automatic, null changed_by.
-- ============================================================================
select pg_temp.as_nobody();
set local role service_role;
update public.orders set status = 'delivered'
 where id = (select order_id from t_ctx where label = 'order');
reset role;

do $$
declare r public.order_status_audit;
begin
  if auth.uid() is not null then
    raise exception 'CASE 4: setup — auth.uid() is %, expected null', auth.uid(); end if;
  select * into r from public.order_status_audit
   where order_id = (select order_id from t_ctx where label = 'order')
     and new_status = 'delivered';
  if not found then
    raise exception 'CASE 4: a service-role status change was not audited'; end if;
  if r.source is distinct from 'automatic' then
    raise exception 'CASE 4: source %, expected automatic', r.source; end if;
  if r.changed_by is not null or r.actor_role is not null then
    raise exception 'CASE 4: changed_by % / actor_role %, expected both null', r.changed_by, r.actor_role; end if;
  if r.old_status is distinct from 'ready' then
    raise exception 'CASE 4: old_status %, expected ready', r.old_status; end if;
  raise notice 'CASE 4 ok — a status change with no caller is automatic, with no actor';
end $$;

-- ============================================================================
-- CASE 5 — a non-status update and a same-status write record nothing.
-- ============================================================================
do $$
declare v_before integer; v_after integer; v_order uuid;
begin
  select order_id into v_order from t_ctx where label = 'order';
  select count(*) into v_before from public.order_status_audit where order_id = v_order;
  perform pg_temp.as_nobody();
  -- What lazywait-webhook writes.
  update public.orders set lazywait_status = 'accepted', updated_at = now() where id = v_order;
  -- A status write that does not change it.
  update public.orders set status = status where id = v_order;
  perform pg_temp.as_admin();
  update public.orders set status = 'delivered' where id = v_order;
  select count(*) into v_after from public.order_status_audit where order_id = v_order;
  if v_after <> v_before then
    raise exception 'CASE 5: % row(s) written by writes that changed no status', v_after - v_before; end if;
  if v_before <> 3 then
    raise exception 'CASE 5: % rows for the order, expected exactly the 3 real transitions', v_before; end if;
  raise notice 'CASE 5 ok — only a real status change is audited';
end $$;

-- ============================================================================
-- CASE 6 — client roles cannot write either table; reads follow the policies.
-- ============================================================================
do $$
declare
  v_state text;
  v_role  text;
  v_sql   text;
  v_n     integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_sql in array array[
      'insert into public.order_status_audit (order_id, new_status, source) values (gen_random_uuid(), ''received'', ''manual'')',
      'update public.order_status_audit set source = ''manual''',
      'delete from public.order_status_audit',
      'truncate public.order_status_audit',
      'insert into public.admin_action_audit (action, target_table) values (''x'', ''y'')',
      'update public.admin_action_audit set action = ''x''',
      'delete from public.admin_action_audit',
      'truncate public.admin_action_audit'
    ] loop
      perform pg_temp.as_admin();   -- even an admin's JWT cannot write
      execute format('set local role %I', v_role);
      begin
        execute v_sql;
        v_state := null;
      exception when others then
        v_state := sqlstate;
      end;
      reset role;
      if v_state is distinct from '42501' then
        raise exception 'CASE 6: % ran "%" with SQLSTATE %, expected 42501', v_role, v_sql, coalesce(v_state, 'SUCCESS');
      end if;
    end loop;
  end loop;

  -- anon cannot read either table at all.
  foreach v_sql in array array['select count(*) from public.order_status_audit',
                                'select count(*) from public.admin_action_audit'] loop
    perform pg_temp.as_nobody();
    set local role anon;
    begin
      execute v_sql;
      v_state := null;
    exception when others then
      v_state := sqlstate;
    end;
    reset role;
    if v_state is distinct from '42501' then
      raise exception 'CASE 6: anon ran "%" with SQLSTATE %, expected 42501', v_sql, coalesce(v_state, 'SUCCESS');
    end if;
  end loop;

  -- A customer reads nothing, though rows exist (and they are about their
  -- order). The admin_action_audit read checks are in CASE 8b, once that table
  -- certainly holds rows; a count of zero proves nothing about an empty table.
  perform pg_temp.as_customer();
  set local role authenticated;
  select count(*) into v_n from public.order_status_audit;
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 6: a customer read % order_status_audit row(s)', v_n; end if;

  -- An accountant reads the status trail.
  perform pg_temp.as_clerk();
  set local role authenticated;
  select count(*) into v_n from public.order_status_audit
   where order_id = (select order_id from t_ctx where label = 'order');
  reset role;
  if v_n <> 3 then
    raise exception 'CASE 6: an accountant read % status rows, expected 3', v_n; end if;

  -- An admin reads the status trail.
  perform pg_temp.as_admin();
  set local role authenticated;
  select count(*) into v_n from public.order_status_audit
   where order_id = (select order_id from t_ctx where label = 'order');
  reset role;
  if v_n <> 3 then
    raise exception 'CASE 6: an admin read % status rows, expected 3', v_n; end if;

  raise notice 'CASE 6 ok — no client writes; anon reads nothing; a customer reads no status row; staff and admins read the status trail';
end $$;

-- ============================================================================
-- CASE 7 — a product price change by an admin.
-- ============================================================================
select pg_temp.as_admin();
set local role authenticated;
update public.products set price = price + 1
 where id = 'a0000000-0000-0000-0000-000000000001';
reset role;

do $$
declare r public.admin_action_audit; v_price numeric; v_n integer;
begin
  select price into v_price from public.products where id = 'a0000000-0000-0000-0000-000000000001';
  select count(*) into v_n from public.admin_action_audit
   where id > (select id from t_mark)
     and target_table = 'products' and target_id = 'a0000000-0000-0000-0000-000000000001';
  if v_n <> 1 then
    raise exception 'CASE 7: % products audit row(s), expected 1', v_n; end if;
  select * into r from public.admin_action_audit
   where id > (select id from t_mark)
     and target_table = 'products' and target_id = 'a0000000-0000-0000-0000-000000000001';
  if r.action is distinct from 'update' then
    raise exception 'CASE 7: action %, expected update', r.action; end if;
  if r.changed_columns is distinct from array['price'] then
    raise exception 'CASE 7: changed_columns %, expected {price} (updated_at must not count)', r.changed_columns; end if;
  if (r.detail #>> '{new,price}')::numeric is distinct from v_price
     or (r.detail #>> '{old,price}')::numeric is distinct from v_price - 1 then
    raise exception 'CASE 7: detail %, expected old % new %', r.detail, v_price - 1, v_price; end if;
  if r.actor is distinct from '0a000000-0000-0000-0000-0000000a0ad1'::uuid or r.actor_role is distinct from 'admin' then
    raise exception 'CASE 7: actor % / %, expected the admin', r.actor, r.actor_role; end if;

  -- The admin can read it back through the policy.
  perform pg_temp.as_admin();
  set local role authenticated;
  select count(*) into v_n from public.admin_action_audit
   where id > (select id from t_mark)
     and target_table = 'products' and target_id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  if v_n <> 1 then
    raise exception 'CASE 7: an admin read % row(s) back, expected 1', v_n; end if;
  raise notice 'CASE 7 ok — price change recorded with column, old/new value and actor';
end $$;

-- ============================================================================
-- CASE 8 — app_settings values and names; nothing for bookkeeping-only writes.
-- ============================================================================
select pg_temp.as_admin();
set local role authenticated;
update public.app_settings
   set order_limit_per_hour = case when order_limit_per_hour = 20 then 21 else 20 end
 where id = true;
update public.app_settings
   set admin_push_vapid_public_key = 'probe-public-key-value'
 where id = true;
update public.app_settings set updated_at = now() + interval '1 minute' where id = true;
reset role;

do $$
declare r public.admin_action_audit; v_n integer; v_lim integer;
begin
  select order_limit_per_hour into v_lim from public.app_settings where id = true;
  select count(*) into v_n from public.admin_action_audit
   where id > (select id from t_mark) and target_table = 'app_settings';
  if v_n <> 2 then
    raise exception 'CASE 8: % app_settings rows, expected 2 (the updated_at-only write must not count)', v_n; end if;

  select * into r from public.admin_action_audit
   where id > (select id from t_mark)
     and target_table = 'app_settings' and changed_columns = array['order_limit_per_hour'];
  if not found then
    raise exception 'CASE 8: no row naming order_limit_per_hour'; end if;
  if (r.detail #>> '{new,order_limit_per_hour}')::integer is distinct from v_lim then
    raise exception 'CASE 8: detail %, expected new order_limit_per_hour %', r.detail, v_lim; end if;
  if r.target_id is distinct from 'true' or r.actor is distinct from '0a000000-0000-0000-0000-0000000a0ad1'::uuid then
    raise exception 'CASE 8: target_id % actor %', r.target_id, r.actor; end if;

  select * into r from public.admin_action_audit
   where id > (select id from t_mark)
     and target_table = 'app_settings' and changed_columns = array['admin_push_vapid_public_key'];
  if not found then
    raise exception 'CASE 8: the key column change was not recorded by name'; end if;
  if r.detail::text like '%probe-public-key-value%' then
    raise exception 'CASE 8: a key-like column VALUE was recorded: %', r.detail; end if;

  -- coupons.usage_count is order bookkeeping, not an admin edit.
  perform pg_temp.as_customer();
  update public.coupons set usage_count = usage_count + 1;
  select count(*) into v_n from public.admin_action_audit
   where id > (select id from t_mark) and target_table = 'coupons';
  if v_n <> 0 then
    raise exception 'CASE 8: % coupons row(s) for a usage_count-only write', v_n; end if;
  -- …but a real coupon edit is.
  perform pg_temp.as_admin();
  update public.coupons set is_active = not is_active
   where id = (select id from public.coupons order by code limit 1);
  select count(*) into v_n from public.admin_action_audit
   where id > (select id from t_mark)
     and target_table = 'coupons' and changed_columns = array['is_active'];
  if v_n <> 1 then
    raise exception 'CASE 8: % coupons rows for an is_active edit, expected 1', v_n; end if;
  raise notice 'CASE 8 ok — settings values recorded, key-like columns by name only, bookkeeping writes skipped';
end $$;

-- ============================================================================
-- CASE 8b — admin_action_audit is for admins: not a customer, not an accountant.
-- ============================================================================
do $$
declare v_total integer; v_n integer;
begin
  select count(*) into v_total from public.admin_action_audit;
  if v_total < 3 then
    raise exception 'CASE 8b: setup — only % rows to hide, expected at least 3', v_total; end if;

  perform pg_temp.as_customer();
  set local role authenticated;
  select count(*) into v_n from public.admin_action_audit;
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 8b: a customer read % of % admin_action_audit rows', v_n, v_total; end if;

  perform pg_temp.as_clerk();
  set local role authenticated;
  select count(*) into v_n from public.admin_action_audit;
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 8b: an accountant read % of % admin_action_audit rows', v_n, v_total; end if;

  perform pg_temp.as_admin();
  set local role authenticated;
  select count(*) into v_n from public.admin_action_audit;
  reset role;
  if v_n <> v_total then
    raise exception 'CASE 8b: an admin read % of % rows', v_n, v_total; end if;
  raise notice 'CASE 8b ok — only an admin reads admin_action_audit';
end $$;

-- ============================================================================
-- CASE 9 — record_admin_action: service_role only; no credential-like keys.
-- ============================================================================
do $$
declare v_state text; v_role text; v_id bigint; r public.admin_action_audit;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    perform pg_temp.as_admin();
    execute format('set local role %I', v_role);
    begin
      perform public.record_admin_action('0a000000-0000-0000-0000-0000000a0ad1'::uuid,
        'staff_password_reset', 'auth.users', gen_random_uuid()::text, '{}'::jsonb);
      v_state := null;
    exception when others then
      v_state := sqlstate;
    end;
    reset role;
    if v_state is distinct from '42501' then
      raise exception 'CASE 9: % called record_admin_action with SQLSTATE %, expected 42501', v_role, coalesce(v_state, 'SUCCESS');
    end if;
  end loop;

  perform pg_temp.as_nobody();
  set local role service_role;
  v_id := public.record_admin_action('0a000000-0000-0000-0000-0000000a0ad1'::uuid,
    'staff_account_delete', 'auth.users', '0a000000-0000-0000-0000-0000000a0ac1',
    jsonb_build_object('target_role', 'call_center'));
  reset role;
  select * into r from public.admin_action_audit where id = v_id;
  if r.actor is distinct from '0a000000-0000-0000-0000-0000000a0ad1'::uuid
     or r.actor_role is distinct from 'admin'
     or r.action is distinct from 'staff_account_delete'
     or r.target_id is distinct from '0a000000-0000-0000-0000-0000000a0ac1'
     or r.detail is distinct from '{"target_role": "call_center"}'::jsonb then
    raise exception 'CASE 9: service_role call wrote %', row_to_json(r); end if;

  foreach v_role in array array['{"password": "x"}', '{"meta": {"new_password": "x"}}', '{"api_token": 1}'] loop
    set local role service_role;
    begin
      perform public.record_admin_action('0a000000-0000-0000-0000-0000000a0ad1'::uuid,
        'staff_password_reset', 'auth.users', null, v_role::jsonb);
      v_state := null;
    exception when others then
      v_state := sqlstate;
    end;
    reset role;
    if v_state is distinct from '22023' then
      raise exception 'CASE 9: detail % accepted with SQLSTATE %, expected 22023', v_role, coalesce(v_state, 'SUCCESS');
    end if;
  end loop;

  set local role service_role;
  begin
    perform public.record_admin_action('0a000000-0000-0000-0000-0000000a0ad1'::uuid,
      'anything_else', 'auth.users', null, '{}'::jsonb);
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  if v_state is distinct from '22023' then
    raise exception 'CASE 9: an unknown action was accepted (SQLSTATE %)', coalesce(v_state, 'SUCCESS'); end if;
  raise notice 'CASE 9 ok — record_admin_action is service_role only and refuses credential keys';
end $$;

-- ============================================================================
-- CASE 10 — notification_log: new columns; still no client write, no customer read.
-- ============================================================================
do $$
declare v_state text; v_n integer; v_id uuid;
begin
  -- What push-dispatch writes as service_role.
  perform pg_temp.as_nobody();
  set local role service_role;
  insert into public.notification_log (kind, sent_by, content, send_status, targeted, sent)
  values ('broadcast', '0a000000-0000-0000-0000-0000000a0ad1',
          '{"titleEn":"t","titleAr":"ت","bodyEn":"b","bodyAr":"ب"}', 'sent', 1, 1)
  returning id into v_id;
  reset role;

  perform pg_temp.as_admin();
  set local role authenticated;
  begin
    insert into public.notification_log (kind, sent_by, content) values ('broadcast', gen_random_uuid(), '{}');
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'CASE 10: an authenticated client wrote notification_log (SQLSTATE %)', coalesce(v_state, 'SUCCESS'); end if;

  perform pg_temp.as_customer();
  set local role authenticated;
  select count(*) into v_n from public.notification_log where id = v_id;
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 10: a customer read the broadcast row'; end if;

  perform pg_temp.as_admin();
  set local role authenticated;
  select count(*) into v_n from public.notification_log
   where id = v_id and sent_by = '0a000000-0000-0000-0000-0000000a0ad1' and content ->> 'bodyAr' = 'ب';
  reset role;
  if v_n <> 1 then
    raise exception 'CASE 10: an admin could not read sender and content back'; end if;
  raise notice 'CASE 10 ok — broadcasts carry sender and content; reads and writes unchanged';
end $$;

-- ============================================================================
-- CASE 11 — append-only, for the owner too.
-- ============================================================================
do $$
declare v_state text; v_sql text;
begin
  foreach v_sql in array array[
    'update public.order_status_audit set source = ''manual''',
    'delete from public.order_status_audit',
    'truncate public.order_status_audit',
    'update public.admin_action_audit set action = ''x''',
    'delete from public.admin_action_audit',
    'truncate public.admin_action_audit'
  ] loop
    begin
      execute v_sql;
      v_state := null;
    exception when others then
      v_state := sqlstate;
    end;
    if v_state is distinct from '42501' then
      raise exception 'CASE 11: the owner ran "%" with SQLSTATE %, expected 42501', v_sql, coalesce(v_state, 'SUCCESS');
    end if;
  end loop;
  if not exists (select 1 from public.order_status_audit) or not exists (select 1 from public.admin_action_audit) then
    raise exception 'CASE 11: rows went missing'; end if;
  raise notice 'CASE 11 ok — both audit tables are append-only';
end $$;

rollback;
