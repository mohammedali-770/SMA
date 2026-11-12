-- ============================================================================
-- RLS INIT-PLANS, THE LIVE BOARD'S ID SET, AND THE ORDER-NUMBER YEAR
--
-- Three findings from the 2026-11-11 assessment. None changes who can read
-- what, which orders the live board shows, or how an order is numbered within
-- a year.
--
--  1. P01#2. Three own-or-staff SELECT policies call is_staff() once per row:
--
--       profiles_select_own_or_staff     (id = (select auth.uid())) or is_staff()
--       orders_select_own_or_staff       (customer_id = ...)        or is_staff()
--       loyalty_tx_select_own_or_staff   (profile_id = ...)         or is_staff()
--
--     20260810130000 wrapped auth.uid() in a scalar SELECT and left is_staff()
--     bare on purpose. is_staff() is a SECURITY DEFINER SQL function, so it is
--     never inlined, and the OR keeps the (customer_id, created_at) index out
--     of reach. A customer's My Orders therefore walks orders_created_at_idx
--     and calls is_staff() on every other customer's row until it has 20
--     matches. A customer with fewer than 20 orders, including one with none,
--     pays for the whole table: about 2 s at 50 000 orders locally.
--
--     Each policy now reads (<owner> = (select auth.uid())) or
--     (select public.is_staff()). The scalar SELECT is an InitPlan: is_staff()
--     runs once per statement and the filter becomes ((owner = $0) OR $1).
--     is_staff() is STABLE and depends only on the caller's profile and JWT,
--     so its value cannot differ between rows of one statement. The visible
--     rows are the same for every caller, and an administrator at aal1 still
--     sees nothing that is not their own.
--
--  2. P01#3. admin_list_orders_with_items is the console's live board, polled
--     every 12 s while polling and every 60 s always. Its bounded arm was
--
--       where p_limit is null
--          or o.id in (<the p_limit most recent ids>)
--          or o.status not in ('delivered', 'cancelled')
--
--     A top-level OR stops the planner turning the IN into a join, so every
--     poll read every order through orders_created_at_idx and threw almost
--     all of them away: 49 500 of 50 000 rows removed, about 340 ms locally,
--     growing with history rather than with open work. The predicate is now
--     one IN over a UNION of the recent window and the open orders. The
--     unbounded call (p_limit null) moves inside the second arm, whose filter
--     it switches off, so it still returns every order.
--
--     That last detail departs from the finding's sketch, which kept
--     `p_limit is null or` at the top. Measured inside the function, that
--     shape is no faster (335-391 ms before, 348-415 ms after): the planner
--     pulls IN subqueries up into joins before it folds `p_limit is null`
--     away, so any OR at the top still leaves a filter over the whole table.
--     The shape used here measured 50-82 ms, and 71-118 ms with a generic
--     plan (50 000 orders, 60 open, p_limit 500, ten calls each).
--
--     Derived from 20260824130000, the only current definition, by ONE
--     anchored substitution of that WHERE clause. The signature, the
--     projection, the ORDER BY, the is_staff() gate, SECURITY DEFINER, STABLE,
--     search_path and the grants are unchanged, and so is the result: at
--     50 000 orders the returned document is byte-identical for p_limit 500,
--     20 000, 5, 1, 0, -3 and null.
--
--  3. R06#5. set_order_number took the year from now() in the session time
--     zone, which is UTC in Production. An order placed between 00:00 and
--     02:59 Riyadh time on 1 January was numbered SM-<previous year>-... on
--     the receipt, the console and the POS ticket. The year now comes from
--     now() at time zone 'Asia/Riyadh', whatever the session time zone is.
--     The sequence is global, so numbers were and stay unique. Derived from
--     20260709120000 by one substitution; nothing else in the body changes.
--
-- WHAT THIS DOES NOT DO
--   - It does not touch checkout_sessions_select_own. That policy still calls
--     auth.uid() and is_staff() per row; it belongs to the payment path, and
--     changing it is not part of this work. Its text is asserted unchanged.
--   - It does not touch any other policy. 24 more call is_staff() or
--     is_admin() bare (read 2026-11-12 on the local chain);
--     campaign_redemptions_select_own_or_staff has the same own-or-staff
--     shape. None was measured as a hot path, so they are left for a change
--     of their own. Every policy other than these three is asserted
--     byte-identical before and after.
--   - It does not change is_staff(), is_admin() or any function body other
--     than the two above, and it adds no index. A partial index on open
--     orders, without the rewrite, measured no faster (391-438 ms).
--   - It does not renumber an existing order.
--   - It does not touch the money path. place_order and compute_order_snapshot
--     are asserted unchanged before and after (12b6816d... / 22e2d429...).
--
-- PRE-IMAGES. Both function bodies are checked against what this file was
-- derived from before anything changes, comments and whitespace ignored. They
-- were read from the migration chain, not from Production. If Production
-- holds something else, the apply refuses rather than overwrite it.
--
-- NOT APPLIED TO PRODUCTION by this change. Applying it is a CLAUDE.md
-- section 5 action, named by version: "apply 20261006120000". Never
-- bulk-apply: 20260824100000 sorts ahead of everything outstanding.
--
-- NO DEPLOY IMPLIED. Both functions keep their signatures, so their callers
-- (the console's RPC, the orders INSERT trigger) bind to the new bodies; no
-- client reads a policy's text.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Preconditions. Fail before changing anything.
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n    integer;
  v_txt  text;
  r      record;
begin
  -- The three policies are what this file was written against: SELECT, TO
  -- authenticated, permissive, no WITH CHECK, and either the pre-image or
  -- (on a re-run) the post-image qual.
  for r in
    select * from (values
      ('profiles', 'profiles_select_own_or_staff', 'id'),
      ('orders', 'orders_select_own_or_staff', 'customer_id'),
      ('loyalty_transactions', 'loyalty_tx_select_own_or_staff', 'profile_id')
    ) as x(tbl, pol, col)
  loop
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = r.tbl and policyname = r.pol
       and cmd = 'SELECT' and roles = '{authenticated}'::name[]
       and permissive = 'PERMISSIVE' and with_check is null
       and qual in (
         format('((%s = ( SELECT auth.uid() AS uid)) OR is_staff())', r.col),
         format('((%s = ( SELECT auth.uid() AS uid)) OR ( SELECT is_staff() AS is_staff))', r.col));
    if v_n <> 1 then
      raise exception 'rls initplan: policy %.% is not the shape this file was written against', r.tbl, r.pol;
    end if;
  end loop;

  -- is_staff() is what the InitPlan calls, as the querying role.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_staff';
  if v_n <> 1 or to_regprocedure('public.is_staff()') is null then
    raise exception 'rls initplan: expected exactly one public.is_staff(), found %', v_n;
  end if;
  if not has_function_privilege('authenticated', 'public.is_staff()', 'execute') then
    raise exception 'rls initplan: authenticated cannot execute is_staff()';
  end if;

  -- The two function pre-images, comments and whitespace ignored. The second
  -- value of each pair is the post-image, so a re-run is accepted.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_list_orders_with_items';
  if v_n <> 1 or to_regprocedure('public.admin_list_orders_with_items(integer)') is null then
    raise exception 'rls initplan: expected exactly one admin_list_orders_with_items(integer), found %', v_n;
  end if;
  select md5(btrim(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
    into v_txt from pg_proc where oid = 'public.admin_list_orders_with_items(integer)'::regprocedure;
  if v_txt is null or v_txt not in ('cb8e6faf08dfa7faca6b72fe5d48faa1', 'fd76228fd5467be2044964b1a472c5e2') then
    raise exception 'rls initplan: admin_list_orders_with_items is not the 20260824130000 body (normalized md5 %)', coalesce(v_txt, 'NULL');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_order_number';
  if v_n <> 1 or to_regprocedure('public.set_order_number()') is null then
    raise exception 'rls initplan: expected exactly one set_order_number(), found %', v_n;
  end if;
  select md5(btrim(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
    into v_txt from pg_proc where oid = 'public.set_order_number()'::regprocedure;
  if v_txt is null or v_txt not in ('1af36649b7149765d12456ddf261f323', 'd0cf9b9758b941551fdc56246843789f') then
    raise exception 'rls initplan: set_order_number is not the 20260709120000 body (normalized md5 %)', coalesce(v_txt, 'NULL');
  end if;
  if to_regclass('public.order_number_seq') is null then
    raise exception 'rls initplan: public.order_number_seq is missing';
  end if;
  if not exists (select 1 from pg_timezone_names where name = 'Asia/Riyadh') then
    raise exception 'rls initplan: this server does not know the Asia/Riyadh time zone';
  end if;

  -- The money path, before anything changes.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('place_order', 'compute_order_snapshot');
  if v_n <> 2 then
    raise exception 'rls initplan: expected one place_order and one compute_order_snapshot, found % functions', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'rls initplan: place_order hashes %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'rls initplan: compute_order_snapshot hashes %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;
end
$pre$;

-- What the self-verification compares against: every other policy, the two
-- functions' grants, and set_order_number's body as it stood. Dropped at the
-- end of the file.
create temporary table if not exists rls_initplan_20261006_pre (k text primary key, v text);
truncate rls_initplan_20261006_pre;
insert into rls_initplan_20261006_pre (k, v)
select 'other_policies',
       md5(string_agg(
             concat_ws('|', schemaname, tablename, policyname, permissive, roles::text,
                       cmd, coalesce(qual, '<null>'), coalesce(with_check, '<null>')),
             E'\n' order by schemaname, tablename, policyname))
  from pg_policies
 where (tablename, policyname) not in (
         ('profiles', 'profiles_select_own_or_staff'),
         ('orders', 'orders_select_own_or_staff'),
         ('loyalty_transactions', 'loyalty_tx_select_own_or_staff'))
union all
select 'checkout_sessions_select_own', qual
  from pg_policies
 where schemaname = 'public' and tablename = 'checkout_sessions' and policyname = 'checkout_sessions_select_own'
union all
select 'acl_admin_list_orders_with_items', coalesce(proacl::text, '<default>')
  from pg_proc where oid = 'public.admin_list_orders_with_items(integer)'::regprocedure
union all
select 'acl_set_order_number', coalesce(proacl::text, '<default>')
  from pg_proc where oid = 'public.set_order_number()'::regprocedure
union all
select 'src_set_order_number', prosrc
  from pg_proc where oid = 'public.set_order_number()'::regprocedure;


-- ---------------------------------------------------------------------------
-- 1. P01#2 — is_staff() once per statement, not once per row
-- ---------------------------------------------------------------------------
alter policy profiles_select_own_or_staff on public.profiles
  using ((id = (select auth.uid())) or (select public.is_staff()));

alter policy orders_select_own_or_staff on public.orders
  using ((customer_id = (select auth.uid())) or (select public.is_staff()));

alter policy loyalty_tx_select_own_or_staff on public.loyalty_transactions
  using ((profile_id = (select auth.uid())) or (select public.is_staff()));


-- ---------------------------------------------------------------------------
-- 2. P01#3 — the live board reads the open orders and the recent window only
-- ---------------------------------------------------------------------------
-- 20260824130000_place_order_variants.sql, with its WHERE clause replaced.
create or replace function public.admin_list_orders_with_items(p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may list orders' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select
      o.id, o.order_number, o.customer_id, o.customer_name, o.customer_phone,
      o.branch_id, o.branch_name_en, o.branch_name_ar,
      o.status, o.order_type,
      o.subtotal, o.delivery_fee, o.discount_amount, o.loyalty_discount_amount,
      o.vat_amount, o.total,
      o.loyalty_points_earned, o.loyalty_points_redeemed,
      o.payment_status, o.payment_method, o.payment_provider, o.paid_at,
      o.coupon_code, o.notes, o.created_at, o.updated_at,
      o.sync_status, o.lazywait_sync_state, o.lazywait_ref,
      o.lazywait_order_number, o.lazywait_status,
      o.sync_attempt_count, o.sync_last_error, o.sync_blocked_reason,
      o.synced_at, o.first_pos_sync_failure_at, o.sync_next_attempt_at,
      o.pos_create_attempted_at, o.pos_customer_retry_count,
      o.pos_confirmation_reason, o.refund_state,
      o.address_snapshot,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id, 'order_id', i.order_id, 'product_id', i.product_id,
          'name_en', i.name_en, 'name_ar', i.name_ar,
          'unit_price', i.unit_price, 'quantity', i.quantity,
          'line_total', i.line_total, 'note', i.note,
          'variant_id', i.variant_id,
          'variant_name_en', i.variant_name_en, 'variant_name_ar', i.variant_name_ar,
          'order_item_modifiers', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', m.id, 'order_item_id', m.order_item_id,
              'modifier_id', m.modifier_id,
              'name_en', m.name_en, 'name_ar', m.name_ar, 'price', m.price)
              order by m.id)
            from public.order_item_modifiers m where m.order_item_id = i.id
          ), '[]'::jsonb))
          order by i.id)
        from public.order_items i where i.order_id = o.id
      ), '[]'::jsonb) as order_items
    from public.orders o
    -- The recent window, plus everything still owed to a customer however
    -- old, as ONE id set (20261006120000). The two used to be OR-ed arms of
    -- this WHERE, and a top-level OR stops the planner turning an IN into a
    -- join, so every poll tested every order in the table. The unbounded call
    -- (p_limit null) is the second arm with its filter switched off.
    where o.id in (
            (select r.id from public.orders r
              order by r.created_at desc
              limit greatest(1, p_limit))
            union
            (select s.id from public.orders s
              where p_limit is null
                 or s.status not in ('delivered', 'cancelled'))
          )
    order by o.created_at desc
  ) t;

  return v_rows;
end $$;


-- ---------------------------------------------------------------------------
-- 3. R06#5 — the order-number year is the Riyadh year
-- ---------------------------------------------------------------------------
-- 20260709120000_sec_trigger_search_path.sql, with one expression replaced.
create or replace function public.set_order_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number :=
      'SM-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' ||
      lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 4. Self-verification. One transaction: if any check fails, the file rolls
--    back. Outcomes are checked before hashes, so a wrong body reports what it
--    does wrong rather than only that it differs.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_n      integer;
  v_txt    text;
  v_pre    text;
  v_state  text;
  v_tz     text := current_setting('TimeZone');
  v_lim    integer;
  r        record;
begin
  -- 4.1 The three policies: exact qual, and nothing else about them moved.
  for r in
    select * from (values
      ('profiles', 'profiles_select_own_or_staff', 'id'),
      ('orders', 'orders_select_own_or_staff', 'customer_id'),
      ('loyalty_transactions', 'loyalty_tx_select_own_or_staff', 'profile_id')
    ) as x(tbl, pol, col)
  loop
    select qual into v_txt from pg_policies
     where schemaname = 'public' and tablename = r.tbl and policyname = r.pol
       and cmd = 'SELECT' and roles = '{authenticated}'::name[]
       and permissive = 'PERMISSIVE' and with_check is null;
    if v_txt is distinct from
       format('((%s = ( SELECT auth.uid() AS uid)) OR ( SELECT is_staff() AS is_staff))', r.col) then
      raise exception 'rls initplan verification failed: %.% reads %', r.tbl, r.pol, coalesce(v_txt, 'NULL (policy missing or reshaped)');
    end if;
  end loop;

  -- 4.2 Every other policy is byte-identical, checkout_sessions included.
  select md5(string_agg(
           concat_ws('|', schemaname, tablename, policyname, permissive, roles::text,
                     cmd, coalesce(qual, '<null>'), coalesce(with_check, '<null>')),
           E'\n' order by schemaname, tablename, policyname))
    into v_txt
    from pg_policies
   where (tablename, policyname) not in (
           ('profiles', 'profiles_select_own_or_staff'),
           ('orders', 'orders_select_own_or_staff'),
           ('loyalty_transactions', 'loyalty_tx_select_own_or_staff'));
  if v_txt is distinct from (select v from rls_initplan_20261006_pre where k = 'other_policies') then
    raise exception 'rls initplan verification failed: a policy other than the three changed';
  end if;
  if (select qual from pg_policies where schemaname = 'public' and tablename = 'checkout_sessions'
        and policyname = 'checkout_sessions_select_own')
     is distinct from (select v from rls_initplan_20261006_pre where k = 'checkout_sessions_select_own') then
    raise exception 'rls initplan verification failed: checkout_sessions_select_own changed';
  end if;

  -- 4.3 admin_list_orders_with_items. One overload, same contract.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_list_orders_with_items';
  if v_n <> 1 then
    raise exception 'rls initplan verification failed: % admin_list_orders_with_items overloads', v_n;
  end if;
  select count(*) into v_n from pg_proc
   where oid = 'public.admin_list_orders_with_items(integer)'::regprocedure
     and prorettype = 'jsonb'::regtype and prosecdef and provolatile = 's'
     and proconfig = array['search_path=public']
     and pg_get_function_arguments(oid) = 'p_limit integer DEFAULT NULL::integer';
  if v_n <> 1 then
    raise exception 'rls initplan verification failed: admin_list_orders_with_items changed its signature, return type, security, volatility or search_path';
  end if;
  if (select coalesce(proacl::text, '<default>') from pg_proc
       where oid = 'public.admin_list_orders_with_items(integer)'::regprocedure)
     is distinct from (select v from rls_initplan_20261006_pre where k = 'acl_admin_list_orders_with_items') then
    raise exception 'rls initplan verification failed: admin_list_orders_with_items grants changed';
  end if;

  -- The gate still runs first. This session is not staff, so the call must
  -- refuse with 42501 and read nothing.
  begin
    perform public.admin_list_orders_with_items(1);
    v_state := 'returned';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'rls initplan verification failed: a non-staff call to admin_list_orders_with_items gave %, expected 42501', v_state;
  end if;

  -- A plpgsql body is not name-resolved when it is created, and the gate
  -- stops the call above before the query. So run the new predicate itself,
  -- read-only, for both a bounded and the unbounded call.
  foreach v_lim in array array[1, null]::integer[] loop
    perform count(*) from public.orders o
     where o.id in (
             (select r2.id from public.orders r2
               order by r2.created_at desc
               limit greatest(1, v_lim))
             union
             (select s.id from public.orders s
               where v_lim is null
                  or s.status not in ('delivered', 'cancelled'))
           );
  end loop;

  -- The predicate is the UNION form and the top-level OR is gone.
  select prosrc into v_txt from pg_proc
   where oid = 'public.admin_list_orders_with_items(integer)'::regprocedure;
  if position('where o.id in (' in v_txt) = 0
     or (length(v_txt) - length(replace(v_txt, 'union', ''))) / length('union') <> 1
     or v_txt ~ 'or o\.status not in'
     or v_txt ~ 'where p_limit is null\s+(--[^\n]*\s+)*or o\.id' then
    raise exception 'rls initplan verification failed: admin_list_orders_with_items does not carry the single UNION id predicate';
  end if;

  -- 4.4 set_order_number. One overload, same contract, same grants, still
  --     the orders BEFORE INSERT trigger.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_order_number';
  if v_n <> 1 then
    raise exception 'rls initplan verification failed: % set_order_number overloads', v_n;
  end if;
  select count(*) into v_n from pg_proc
   where oid = 'public.set_order_number()'::regprocedure
     and prorettype = 'trigger'::regtype and not prosecdef
     and proconfig = array['search_path=public'];
  if v_n <> 1 then
    raise exception 'rls initplan verification failed: set_order_number changed its return type, security or search_path';
  end if;
  if (select coalesce(proacl::text, '<default>') from pg_proc where oid = 'public.set_order_number()'::regprocedure)
     is distinct from (select v from rls_initplan_20261006_pre where k = 'acl_set_order_number') then
    raise exception 'rls initplan verification failed: set_order_number grants changed';
  end if;
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.orders'::regclass and tgname = 'set_orders_number'
     and tgfoid = 'public.set_order_number()'::regprocedure and tgenabled = 'O';
  if v_n <> 1 then
    raise exception 'rls initplan verification failed: set_orders_number no longer fires set_order_number on orders';
  end if;

  -- The year, as an outcome. Run the STORED body with now() replaced by a
  -- fixed instant, in the session time zone Production uses. nextval() is
  -- replaced too, so the probe does not use up a real order number (a
  -- sequence advance survives a rollback). Both appear exactly once.
  select prosrc into v_txt from pg_proc where oid = 'public.set_order_number()'::regprocedure;
  if (length(v_txt) - length(replace(v_txt, 'now()', ''))) / length('now()') <> 1
     or (length(v_txt) - length(replace(v_txt, 'nextval(''public.order_number_seq'')', '')))
        / length('nextval(''public.order_number_seq'')') <> 1 then
    raise exception 'rls initplan verification failed: set_order_number does not call now() and nextval() exactly once each';
  end if;
  perform set_config('TimeZone', 'UTC', true);
  create temporary table rls_initplan_20261006_probe (order_number text);
  for r in
    select * from (values
      ('2026-12-31 21:30:00+00', 'SM-2027-000000'),  -- 00:30 on 1 January in Riyadh
      ('2026-12-31 20:59:59+00', 'SM-2026-000000'),  -- 23:59:59 on 31 December in Riyadh
      ('2026-06-15 12:00:00+00', 'SM-2026-000000')
    ) as x(at_utc, expected)
  loop
    -- The function name is a format() argument so that docs-generate, which
    -- reads `create function <name>` out of migration text, does not list it.
    execute format(
      'create or replace function %s() returns trigger language plpgsql as %L',
      'pg_temp.rls_initplan_20261006_probe',
      replace(replace(v_txt, 'now()', format('timestamptz %L', r.at_utc)),
              'nextval(''public.order_number_seq'')', '0'));
    execute 'create trigger probe before insert on pg_temp.rls_initplan_20261006_probe
               for each row execute function pg_temp.rls_initplan_20261006_probe()';
    insert into pg_temp.rls_initplan_20261006_probe values (null) returning order_number into v_state;
    execute 'drop trigger probe on pg_temp.rls_initplan_20261006_probe';
    if v_state is distinct from r.expected then
      raise exception 'rls initplan verification failed: an order placed at % UTC is numbered %, expected %',
        r.at_utc, coalesce(v_state, 'NULL'), r.expected;
    end if;
  end loop;
  drop table pg_temp.rls_initplan_20261006_probe;
  drop function pg_temp.rls_initplan_20261006_probe();
  perform set_config('TimeZone', v_tz, true);

  -- The body is the old one with that one expression replaced, and nothing
  -- else. On a re-run the old body is already the new one and this still holds.
  select v into v_pre from rls_initplan_20261006_pre where k = 'src_set_order_number';
  if v_txt is distinct from replace(v_pre, 'to_char(now(), ''YYYY'')',
                                    'to_char(now() at time zone ''Asia/Riyadh'', ''YYYY'')') then
    raise exception 'rls initplan verification failed: set_order_number differs from its pre-image by more than the year expression';
  end if;

  -- 4.5 The stored bodies are the ones in this file. md5(prosrc), computed
  --     from the file before it was applied.
  if (select md5(prosrc) from pg_proc where oid = 'public.admin_list_orders_with_items(integer)'::regprocedure)
     is distinct from '7f2f3803b60edc707fe1207a7496525f' then
    raise exception 'rls initplan verification failed: admin_list_orders_with_items body is not the one in this file';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.set_order_number()'::regprocedure)
     is distinct from 'ed203eebfde6c1a5026e39c625e1dc80' then
    raise exception 'rls initplan verification failed: set_order_number body is not the one in this file';
  end if;

  -- 4.6 is_staff() is still callable by the role that evaluates the policies.
  if not has_function_privilege('authenticated', 'public.is_staff()', 'execute') then
    raise exception 'rls initplan verification failed: authenticated cannot execute is_staff()';
  end if;

  -- 4.7 The money path is untouched.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'rls initplan: three policies call is_staff() once per statement, the live board reads only its id set, and order numbers take the Riyadh year';
end
$verify$;

drop table if exists rls_initplan_20261006_pre;
