-- ============================================================================
-- Catalogue delete vs. a checkout that is still being paid (migration
-- 20261021120000_catalog_delete_open_checkout_guard.sql, audit finding
-- F-X03-001).
--
-- The defect: a card checkout freezes product / size / option ids in its
-- snapshot and writes the order only after the payment is captured. Hard-
-- deleting any of those rows in that window made finalize_checkout_session fail
-- on an order-line FK — money captured, no order, no refund path.
--
-- Runs against the full migration chain (same harness as every suite here).
-- Each case RAISES on failure, so the script aborts non-zero; a clean run
-- prints NOTICEs and commits nothing. Deletes run as the real `authenticated`
-- role with the harness admin claim — the PostgREST shape of the console's
-- Delete button — unless a case says otherwise. Every case runs inside its own
-- savepoint, so no case sees another's sessions or deletes.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

-- ---- Fixtures --------------------------------------------------------------
do $$
declare
  v_cust  uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_cat   uuid;
  v_grp   uuid := gen_random_uuid();
  v_p     uuid := gen_random_uuid();
  v_p2    uuid := gen_random_uuid();
  v_v     uuid := gen_random_uuid();
  v_m     uuid := gen_random_uuid();
  v_branch uuid;
begin
  insert into auth.users (id, email) values
    (v_cust, 'catguard-c@example.com'), (v_admin, 'catguard-a@example.com')
    on conflict (id) do nothing;
  -- No phone number: none is needed, and every number in this public
  -- repository must be on scripts/test-phone-allowlist.json.
  insert into public.profiles (id, full_name, role) values
    (v_cust, 'Catalogue Guard Customer', 'customer'),
    (v_admin, 'Catalogue Guard Admin', 'admin')
    on conflict (id) do update set role = excluded.role;

  -- The reachability gate: begin_checkout_session refuses every card checkout
  -- while online payment is off.
  update public.app_settings set online_payment_enabled = true where id = true;

  select id into v_branch from public.branches where is_active order by id limit 1;
  if v_branch is null then
    raise exception 'FIXTURE: no active branch in the seeded chain';
  end if;
  select id into v_cat from public.categories order by sort_order, id limit 1;
  if v_cat is null then
    raise exception 'FIXTURE: no category in the seeded chain';
  end if;

  insert into public.products (id, category_id, name_en, name_ar, price) values
    (v_p,  v_cat, 'Guard Burger', 'برجر الاختبار', 25.00),
    (v_p2, v_cat, 'Guard Fries',  'بطاطس الاختبار', 9.00);
  insert into public.product_variants (id, product_id, name_en, name_ar, price) values
    (v_v, v_p, 'Large', 'كبير', 30.00);
  insert into public.modifier_groups (id, name_en, name_ar, min_select, max_select) values
    (v_grp, 'Guard Sauce', 'صوص الاختبار', 0, 1);
  insert into public.modifiers (id, group_id, name_en, name_ar, price) values
    (v_m, v_grp, 'Garlic', 'ثوم', 2.00);
  insert into public.product_modifier_groups (product_id, group_id, sort_order) values
    (v_p, v_grp, 0);

  perform set_config('cg.cust',   v_cust::text,   false);
  perform set_config('cg.admin',  v_admin::text,  false);
  perform set_config('cg.branch', v_branch::text, false);
  perform set_config('cg.p',      v_p::text,      false);
  perform set_config('cg.p2',     v_p2::text,     false);
  perform set_config('cg.v',      v_v::text,      false);
  perform set_config('cg.m',      v_m::text,      false);
  perform set_config('cg.grp',    v_grp::text,    false);
end $$;

-- A customer opens a real card checkout for Guard Burger / Large / Garlic, and
-- optionally the service role opens a LIVE payment attempt on it.
create or replace function pg_temp.open_checkout(p_with_attempt boolean) returns uuid
language plpgsql as $$
declare v_sess uuid;
begin
  perform set_config('test.auth_uid', current_setting('cg.cust'), true);
  perform set_config('test.is_admin', '', true);
  perform set_config('test.is_staff', '', true);
  set local role authenticated;
  select (r).id into v_sess from (select public.begin_checkout_session(
      current_setting('cg.branch')::uuid, 'pickup',
      jsonb_build_array(jsonb_build_object(
        'product_id', current_setting('cg.p'), 'quantity', 1,
        'variant_id', current_setting('cg.v'),
        'modifier_ids', jsonb_build_array(current_setting('cg.m')))),
      null, null, null, 0, gen_random_uuid()) r) s;
  reset role;
  perform set_config('test.auth_uid', '', true);
  if v_sess is null then
    raise exception 'FIXTURE: begin_checkout_session returned no session';
  end if;
  if p_with_attempt then
    set local role service_role;
    perform public.begin_session_attempt(v_sess, 'moyasar', 'live', 30);
    reset role;
  end if;
  return v_sess;
end $$;

-- Run one statement as an administrator through PostgREST's role (or as
-- another role), returning 'OK:<rows>' or '<sqlstate>:<message>'. A refused
-- statement is rolled back by its own subtransaction.
create or replace function pg_temp.try_as(p_role text, p_sql text) returns text
language plpgsql as $$
declare v_rows integer; v_out text;
begin
  if p_role = 'authenticated' then
    perform set_config('test.auth_uid', current_setting('cg.admin'), true);
    perform set_config('test.is_admin', 'true', true);
  end if;
  begin
    execute format('set local role %I', p_role);
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := 'OK:' || v_rows;
  exception when others then
    v_out := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('test.auth_uid', '', true);
  perform set_config('test.is_admin', '', true);
  return v_out;
end $$;

create or replace function pg_temp.admin_try(p_sql text) returns text
language sql as $$ select pg_temp.try_as('authenticated', p_sql) $$;

-- The provider has captured the money: finalize, as the webhook would.
create or replace function pg_temp.finalize(p_sess uuid) returns text
language plpgsql as $$
declare v_tot numeric; v_ord uuid; v_out text;
begin
  select total into v_tot from public.checkout_sessions where id = p_sess;
  set local role service_role;
  begin
    select (public.finalize_checkout_session(p_sess, 'moyasar', 'pay_cg_' || replace(p_sess::text, '-', ''),
              v_tot, 'SAR', '{}'::jsonb, 'visa', '4242')).id into v_ord;
    v_out := 'OK:' || v_ord;
  exception when others then
    v_out := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v_out;
end $$;

create or replace function pg_temp.expect_refused(p_case text, p_got text, p_what text) returns void
language plpgsql as $$
begin
  if p_got not like '55006:' || p_what || ' cannot be deleted while a customer is paying%' then
    raise exception '% FAILED: expected 55006 "% cannot be deleted…", got %', p_case, p_what, p_got;
  end if;
  if p_got not like '%Deactivate%instead%' then
    raise exception '% FAILED: the refusal does not tell the admin to deactivate instead: %', p_case, p_got;
  end if;
end $$;

create or replace function pg_temp.expect_ok(p_case text, p_got text, p_rows integer) returns void
language plpgsql as $$
begin
  if p_got is distinct from 'OK:' || p_rows then
    raise exception '% FAILED: expected OK:%, got %', p_case, p_rows, coalesce(p_got, 'NULL');
  end if;
end $$;

savepoint c1;
-- ---- CASE 1: product delete refused while a live attempt is open; the
--      payment then still becomes an order --------------------------------------
do $$
declare v_sess uuid; v_got text; v_ord text;
begin
  v_sess := pg_temp.open_checkout(true);
  v_got := pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p')));
  perform pg_temp.expect_refused('CASE 1', v_got, 'This product');
  if not exists (select 1 from public.products where id = current_setting('cg.p')::uuid)
     or not exists (select 1 from public.product_variants where id = current_setting('cg.v')::uuid) then
    raise exception 'CASE 1 FAILED: the refused delete still removed the product or its size';
  end if;
  v_ord := pg_temp.finalize(v_sess);
  if v_ord not like 'OK:%' then
    raise exception 'CASE 1 FAILED: finalize after a refused delete did not create the order: %', v_ord;
  end if;
  if (select count(*) from public.order_items oi
        join public.order_item_modifiers om on om.order_item_id = oi.id
       where oi.order_id = substr(v_ord, 4)::uuid
         and oi.product_id = current_setting('cg.p')::uuid
         and oi.variant_id = current_setting('cg.v')::uuid
         and om.modifier_id = current_setting('cg.m')::uuid) is distinct from 1::bigint then
    raise exception 'CASE 1 FAILED: the order line does not carry the product, size and option';
  end if;
  raise notice 'CASE 1 ok: product delete refused (55006), payment finalized into a full order';
end $$;
rollback to savepoint c1;

savepoint c2;
-- ---- CASE 2: size-only and option-only deletes refused ---------------------
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  perform pg_temp.expect_refused('CASE 2a',
    pg_temp.admin_try(format('delete from public.product_variants where id = %L', current_setting('cg.v'))),
    'This size');
  perform pg_temp.expect_refused('CASE 2b',
    pg_temp.admin_try(format('delete from public.modifiers where id = %L', current_setting('cg.m'))),
    'This option');
  if pg_temp.finalize(v_sess) not like 'OK:%' then
    raise exception 'CASE 2 FAILED: finalize did not succeed after the refused deletes';
  end if;
  raise notice 'CASE 2 ok: size-only and option-only deletes refused';
end $$;
rollback to savepoint c2;

savepoint c3;
-- ---- CASE 3: cascades. Deleting an option GROUP cascades to its options;
--      deleting a product cascades to its sizes. Both are refused by the
--      child's trigger firing inside the cascade --------------------------------
do $$
declare v_sess uuid; v_got text;
begin
  v_sess := pg_temp.open_checkout(true);
  v_got := pg_temp.admin_try(format('delete from public.modifier_groups where id = %L', current_setting('cg.grp')));
  perform pg_temp.expect_refused('CASE 3a (group -> options)', v_got, 'This option');
  if not exists (select 1 from public.modifiers where id = current_setting('cg.m')::uuid) then
    raise exception 'CASE 3a FAILED: the option is gone after a refused group delete';
  end if;

  -- A snapshot that names ONLY the size, so the products trigger has nothing
  -- to find: the refusal must come from product_variants inside the cascade.
  update public.checkout_sessions
     set snapshot = jsonb_build_object('items', jsonb_build_array(
           jsonb_build_object('variant_id', current_setting('cg.v'), 'quantity', 1)))
   where id = v_sess;
  v_got := pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p')));
  perform pg_temp.expect_refused('CASE 3b (product -> sizes)', v_got, 'This size');
  raise notice 'CASE 3 ok: group->options and product->sizes cascades are refused';
end $$;
rollback to savepoint c3;

savepoint c4;
-- ---- CASE 4: an open session with NO attempt yet is still protected -------
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(false);
  perform pg_temp.expect_refused('CASE 4',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))),
    'This product');
  raise notice 'CASE 4 ok: a session inside its window blocks before any attempt exists';
end $$;
rollback to savepoint c4;

-- ---- CASE 5: late settlement. Session 'expired', attempt past its own
--      expiry but inside the 24 h grace — 'initiated' and locally 'failed'
--      alike — is still protected; past the grace it is not -------------------
savepoint c5;
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  update public.checkout_sessions set status = 'expired', expires_at = now() - interval '2 hours' where id = v_sess;
  update public.payment_records set expires_at = now() - interval '1 hour' where checkout_session_id = v_sess;
  perform pg_temp.expect_refused('CASE 5a (initiated, lapsed 1 h)',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))),
    'This product');

  update public.payment_records
     set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
   where checkout_session_id = v_sess;
  perform pg_temp.expect_refused('CASE 5b (failed locally, lapsed 1 h)',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))),
    'This product');

  -- And the money can still land: the session is 'expired' and finalize
  -- accepts that on purpose.
  if pg_temp.finalize(v_sess) not like 'OK:%' then
    raise exception 'CASE 5 FAILED: a late capture on an expired session did not finalize';
  end if;
  raise notice 'CASE 5a/5b ok: a lapsed attempt inside the grace still blocks, and still finalizes';
end $$;
rollback to savepoint c5;

savepoint c5c;
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  update public.checkout_sessions set status = 'expired', expires_at = now() - interval '26 hours' where id = v_sess;
  update public.payment_records set expires_at = now() - interval '25 hours' where checkout_session_id = v_sess;
  perform pg_temp.expect_ok('CASE 5c (initiated, lapsed 25 h)',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))), 1);
  raise notice 'CASE 5c ok: past the grace the delete goes through';
end $$;
rollback to savepoint c5c;

-- ---- CASE 6: states that can no longer capture do not block ---------------
savepoint c6a;
do $$
declare v_sess uuid;
begin
  -- pending_payment past its window, no attempt: begin_session_attempt would
  -- refuse it, so nothing can be paid.
  v_sess := pg_temp.open_checkout(false);
  update public.checkout_sessions set expires_at = now() - interval '1 minute' where id = v_sess;
  perform pg_temp.expect_ok('CASE 6a (lapsed, no attempt)',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))), 1);
end $$;
rollback to savepoint c6a;

savepoint c6b;
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  update public.checkout_sessions set status = 'cancelled' where id = v_sess;
  perform pg_temp.expect_ok('CASE 6b (cancelled)',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))), 1);
end $$;
rollback to savepoint c6b;

savepoint c6c;
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  update public.checkout_sessions set status = 'expired', expires_at = now() - interval '1 hour' where id = v_sess;
  update public.payment_records set status = 'refunded' where checkout_session_id = v_sess;
  perform pg_temp.expect_ok('CASE 6c (expired, attempt refunded)',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))), 1);
end $$;
rollback to savepoint c6c;

-- CASE 6d: once the checkout has become an order, the option, the size and
-- the product are each deletable again, and order history keeps the line with
-- its ids SET NULL, as before.
--
-- The size goes first ON PURPOSE. Deleting a product whose size has ever been
-- ORDERED fails on order_items_variant_id_fkey before and after this migration
-- (the product's SET NULL rewrites the order line while the cascaded size
-- delete has not yet nulled variant_id). That is a separate, pre-existing
-- defect and not this guard's.
savepoint c6d;
do $$
declare v_sess uuid; v_ord text;
begin
  v_sess := pg_temp.open_checkout(true);
  v_ord := pg_temp.finalize(v_sess);
  if v_ord not like 'OK:%' then raise exception 'CASE 6d FAILED: finalize: %', v_ord; end if;
  perform pg_temp.expect_ok('CASE 6d (consumed: option)',
    pg_temp.admin_try(format('delete from public.modifiers where id = %L', current_setting('cg.m'))), 1);
  perform pg_temp.expect_ok('CASE 6d (consumed: size)',
    pg_temp.admin_try(format('delete from public.product_variants where id = %L', current_setting('cg.v'))), 1);
  perform pg_temp.expect_ok('CASE 6d (consumed: product)',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p'))), 1);
  if (select count(*) from public.order_items oi
        join public.order_item_modifiers om on om.order_item_id = oi.id
       where oi.order_id = substr(v_ord, 4)::uuid and oi.product_id is null and oi.variant_id is null
         and om.modifier_id is null and oi.name_en = 'Guard Burger') is distinct from 1::bigint then
    raise exception 'CASE 6d FAILED: the historical line was not kept with its ids SET NULL';
  end if;
  raise notice 'CASE 6 ok: lapsed, cancelled, refunded and consumed sessions do not block';
end $$;
rollback to savepoint c6d;

-- ---- CASE 7: soft delete still works while the session is open, and the
--      payment still finalizes ---------------------------------------------------
savepoint c7;
do $$
declare v_sess uuid; v_ord text;
begin
  v_sess := pg_temp.open_checkout(true);
  perform pg_temp.expect_ok('CASE 7a (deactivate product)',
    pg_temp.admin_try(format('update public.products set is_active = false where id = %L', current_setting('cg.p'))), 1);
  perform pg_temp.expect_ok('CASE 7b (deactivate size)',
    pg_temp.admin_try(format('update public.product_variants set is_active = false where id = %L', current_setting('cg.v'))), 1);
  perform pg_temp.expect_ok('CASE 7c (deactivate option)',
    pg_temp.admin_try(format('update public.modifiers set is_active = false where id = %L', current_setting('cg.m'))), 1);
  perform pg_temp.expect_ok('CASE 7d (rename product)',
    pg_temp.admin_try(format('update public.products set name_en = %L where id = %L', 'Guard Burger II', current_setting('cg.p'))), 1);
  v_ord := pg_temp.finalize(v_sess);
  if v_ord not like 'OK:%' then
    raise exception 'CASE 7 FAILED: finalize after deactivation: %', v_ord;
  end if;
  raise notice 'CASE 7 ok: deactivating product, size and option is allowed and still finalizes';
end $$;
rollback to savepoint c7;

savepoint c8;
-- ---- CASE 8: changing a referenced id is refused like a delete -----------
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  perform pg_temp.expect_refused('CASE 8',
    pg_temp.admin_try(format('update public.products set id = gen_random_uuid() where id = %L', current_setting('cg.p'))),
    'This product');
  raise notice 'CASE 8 ok: UPDATE OF id on a referenced product is refused';
end $$;
rollback to savepoint c8;

-- ---- CASE 9: the guard is narrow. An unrelated product is deletable while
--      another product's checkout is open ------------------------------------
savepoint c9;
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  perform pg_temp.expect_ok('CASE 9',
    pg_temp.admin_try(format('delete from public.products where id = %L', current_setting('cg.p2'))), 1);
  raise notice 'CASE 9 ok: a product no open checkout names is still deletable';
end $$;
rollback to savepoint c9;

savepoint c10;
-- ---- CASE 10: no role exemption. A server-side delete would break finalize
--      exactly the same way, so service_role and the owner are refused too ----
do $$
declare v_sess uuid;
begin
  v_sess := pg_temp.open_checkout(true);
  perform pg_temp.expect_refused('CASE 10a (service_role)',
    pg_temp.try_as('service_role', format('delete from public.products where id = %L', current_setting('cg.p'))),
    'This product');
  perform pg_temp.expect_refused('CASE 10b (owner)',
    pg_temp.try_as('postgres', format('delete from public.modifiers where id = %L', current_setting('cg.m'))),
    'This option');
  raise notice 'CASE 10 ok: service_role and owner deletes are refused too';
end $$;
rollback to savepoint c10;

savepoint c11;
-- ---- CASE 11: the console's message path. PostgREST hands the client
--      `message` only (src/lib/api.ts wrapDelete), so the instruction must be
--      in the message, not the hint ----------------------------------------------
do $$
declare v_sess uuid; v_msg text; v_state text;
begin
  v_sess := pg_temp.open_checkout(true);
  perform set_config('test.auth_uid', current_setting('cg.admin'), true);
  perform set_config('test.is_admin', 'true', true);
  set local role authenticated;
  begin
    delete from public.products where id = current_setting('cg.p')::uuid;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  reset role;
  if v_state is distinct from '55006' then
    raise exception 'CASE 11 FAILED: sqlstate %', coalesce(v_state, 'NULL (delete was not refused)');
  end if;
  if v_msg not like '%Deactivate the product instead%' or v_msg not like '%deleted once that checkout has finished%' then
    raise exception 'CASE 11 FAILED: message is not self-sufficient: %', v_msg;
  end if;
  raise notice 'CASE 11 ok: the message alone tells the admin to deactivate instead';
end $$;
rollback to savepoint c11;

rollback;
