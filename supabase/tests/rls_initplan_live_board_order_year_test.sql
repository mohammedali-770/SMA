-- ============================================================================
-- RLS init-plans, the live board's id set, and the order-number year
-- (migration 20261006120000_rls_initplan_live_board_order_year.sql).
--
-- Cases 1, 3, 4 and 5 FAIL on the chain before that migration and pass with
-- it. Case 2 passes on both, which is its point: the rewrite changes no
-- visible row. Each case raises 'CASE n FAILED: ...', so the harness run
-- (ON_ERROR_STOP) aborts non-zero. To see every case on an older chain, run
-- it with -v ON_ERROR_STOP=0 -v ON_ERROR_ROLLBACK=on.
--
--   CASE 1  P01#2  the three policies read (owner = (select auth.uid()))
--                  or (select public.is_staff()); checkout_sessions untouched
--   CASE 2  P01#2  same rows for every caller: against an oracle, and against
--                  the old policies in the same transaction
--   CASE 3  P01#2  the plan calls is_staff() once, as an InitPlan
--   CASE 4  P01#3  the live board returns the same orders, in the same order,
--                  for every p_limit, behind the same gate; one UNION id set
--   CASE 5  R06#5  the order-number year is the Riyadh year, whatever the
--                  session time zone; 2026-12-31 21:30 UTC is SM-2027
--
-- One transaction, rolled back.
-- ============================================================================
begin;

-- The harness replaces jwt_has_aal2() with true. Restore the production body
-- for this transaction so aal1 and aal2 differ: an administrator at aal1 must
-- see only their own rows.
create or replace function public.jwt_has_aal2()
returns boolean language sql stable set search_path = public as $$
  select public.aal_claim_satisfies_staff_mfa(auth.jwt() ->> 'aal');
$$;

-- Become a signed-in caller the way PostgREST does it: the JWT claims and the
-- authenticated role, with every test.* override cleared so current_app_role()
-- reads the caller's real profile. `discard plans` first: a plan cached while
-- this session ran as postgres must not be reused under another role.
create or replace function pg_temp.become(p_uid uuid, p_aal text) returns void
language plpgsql as $$
begin
  perform set_config('test.auth_uid', '', true);
  perform set_config('test.is_staff', '', true);
  perform set_config('test.is_admin', '', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  discard plans;
  set local role authenticated;
end $$;

create or replace function pg_temp.unbecome() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- The rows a caller can see in one table, as 'count:md5(sorted ids)'.
create or replace function pg_temp.visible(p_uid uuid, p_aal text, p_tbl text) returns text
language plpgsql as $$
declare s text;
begin
  perform pg_temp.become(p_uid, p_aal);
  execute format(
    'select count(*) || '':'' || md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.%I',
    p_tbl) into s;
  perform pg_temp.unbecome();
  return s;
end $$;

-- The same, computed as postgres from what the policy is meant to say.
create or replace function pg_temp.oracle(p_uid uuid, p_aal text, p_tbl text) returns text
language plpgsql as $$
declare
  v_staff boolean := p_aal = 'aal2' and exists (
    select 1 from public.profiles where id = p_uid and role in ('admin', 'accountant'));
  v_col text := case p_tbl when 'orders' then 'customer_id' when 'profiles' then 'id' else 'profile_id' end;
  s text;
begin
  execute format(
    'select count(*) || '':'' || md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.%I where %I = $1 or $2',
    p_tbl, v_col) into s using p_uid, v_staff;
  return s;
end $$;

-- The live board as a caller, reported as a value: the id list or the SQLSTATE.
create or replace function pg_temp.board(p_uid uuid, p_aal text, p_limit integer) returns text
language plpgsql as $$
declare v jsonb; s text;
begin
  perform pg_temp.become(p_uid, p_aal);
  begin
    v := public.admin_list_orders_with_items(p_limit);
    select coalesce(string_agg(e ->> 'id', ',' order by ord), '') into s
      from jsonb_array_elements(v) with ordinality as x(e, ord);
  exception when others then
    s := sqlstate;
  end;
  perform pg_temp.unbecome();
  return s;
end $$;

create temporary table t_actor (k text primary key, uid uuid);

-- ---------------------------------------------------------------------------
-- Fixtures: a customer with 7 orders, one with 25, one with none, an
-- administrator and an accountant; 10 orders of a fourth customer. Distinct
-- created_at values, so "the N most recent" has one answer. Old orders that
-- are still open, and recent ones that are settled, so the live board's two
-- arms disagree.
-- ---------------------------------------------------------------------------
do $$
declare
  v_branch uuid := (select id from public.branches order by id limit 1);
  v_n      integer := 0;
  r        record;
  j        integer;
begin
  insert into t_actor (k, uid) values
    ('median', gen_random_uuid()), ('heavy', gen_random_uuid()), ('none', gen_random_uuid()),
    ('other', gen_random_uuid()), ('admin', gen_random_uuid()), ('accountant', gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at)
    select uid, k || '-initplan@example.test', now() from t_actor;
  update public.profiles set role = 'admin' where id = (select uid from t_actor where k = 'admin');
  update public.profiles set role = 'accountant' where id = (select uid from t_actor where k = 'accountant');

  set local session_replication_role = replica;
  for r in select * from (values ('median', 7), ('heavy', 25), ('other', 10)) as x(k, n) loop
    for j in 1 .. r.n loop
      v_n := v_n + 1;
      insert into public.orders (order_number, customer_id, branch_id, order_type, status,
                                 subtotal, total, payment_method, created_at, updated_at)
      values ('T-INITPLAN-' || lpad(v_n::text, 3, '0'),
              (select uid from t_actor where t_actor.k = r.k), v_branch, 'pickup',
              -- every fifth order is still open; the rest are settled
              (case when v_n % 5 = 0 then 'preparing' when v_n % 7 = 0 then 'cancelled'
                    else 'delivered' end)::public.order_status,
              10, 10, 'cash',
              now() - v_n * interval '1 hour', now() - v_n * interval '1 hour');
      if j <= 3 then
        insert into public.loyalty_transactions (profile_id, type, points, created_at)
        values ((select uid from t_actor where t_actor.k = r.k), 'earn', 1, now() - v_n * interval '1 hour');
      end if;
    end loop;
  end loop;
  set local session_replication_role = origin;
end $$;


-- ---------------------------------------------------------------------------
-- CASE 1 — the three policies, exactly; checkout_sessions untouched
-- ---------------------------------------------------------------------------
do $$
declare r record; v text;
begin
  for r in
    select * from (values
      ('profiles', 'profiles_select_own_or_staff', 'id'),
      ('orders', 'orders_select_own_or_staff', 'customer_id'),
      ('loyalty_transactions', 'loyalty_tx_select_own_or_staff', 'profile_id')
    ) as x(tbl, pol, col)
  loop
    select qual into v from pg_policies
     where schemaname = 'public' and tablename = r.tbl and policyname = r.pol
       and cmd = 'SELECT' and roles = '{authenticated}'::name[] and permissive = 'PERMISSIVE'
       and with_check is null;
    if v is distinct from format('((%s = ( SELECT auth.uid() AS uid)) OR ( SELECT is_staff() AS is_staff))', r.col) then
      raise exception 'CASE 1 FAILED: %.% reads %', r.tbl, r.pol, coalesce(v, 'NULL');
    end if;
  end loop;

  select qual into v from pg_policies
   where schemaname = 'public' and tablename = 'checkout_sessions' and policyname = 'checkout_sessions_select_own';
  if v is distinct from '((customer_id = auth.uid()) OR is_staff())' then
    raise exception 'CASE 1 FAILED: checkout_sessions_select_own reads %', coalesce(v, 'NULL');
  end if;

  raise notice 'CASE 1 ok: three own-or-staff policies wrap is_staff(); checkout_sessions unchanged';
end $$;


-- ---------------------------------------------------------------------------
-- CASE 2 — the same rows for every caller
-- ---------------------------------------------------------------------------
-- Against an oracle (owner, or admin/accountant at aal2), and then against
-- the pre-image policies, put back for a moment in this transaction.
create temporary table t_seen (actor text, aal text, tbl text, now_seen text, primary key (actor, aal, tbl));

do $$
declare
  a record; t text; v text; o text;
  v_orig record;
begin
  for a in
    select * from (values
      ('median', 'aal1'), ('heavy', 'aal1'), ('none', 'aal1'),
      ('admin', 'aal2'), ('admin', 'aal1'), ('accountant', 'aal2'), ('accountant', 'aal1')
    ) as x(actor, aal)
  loop
    foreach t in array array['orders', 'profiles', 'loyalty_transactions'] loop
      v := pg_temp.visible((select uid from t_actor where k = a.actor), a.aal, t);
      o := pg_temp.oracle((select uid from t_actor where k = a.actor), a.aal, t);
      if v is distinct from o then
        raise exception 'CASE 2 FAILED: % at % sees % in %, the policy says %', a.actor, a.aal, v, t, o;
      end if;
      insert into t_seen values (a.actor, a.aal, t, v);
    end loop;
  end loop;

  -- The fixture is not vacuous: each caller sees what it should.
  if (select now_seen from t_seen where actor = 'median' and tbl = 'orders') not like '7:%'
     or (select now_seen from t_seen where actor = 'heavy' and tbl = 'orders') not like '25:%'
     or (select now_seen from t_seen where actor = 'none' and tbl = 'orders') not like '0:%'
     or (select now_seen from t_seen where actor = 'admin' and aal = 'aal1' and tbl = 'orders') not like '0:%'
     or (select now_seen from t_seen where actor = 'admin' and aal = 'aal1' and tbl = 'profiles') not like '1:%'
     or (select now_seen from t_seen where actor = 'admin' and aal = 'aal1' and tbl = 'loyalty_transactions') not like '0:%'
     or (select now_seen from t_seen where actor = 'accountant' and aal = 'aal1' and tbl = 'orders') not like '0:%'
     or (select now_seen from t_seen where actor = 'admin' and aal = 'aal2' and tbl = 'orders')
        is distinct from ((select count(*) from public.orders)::text || ':' ||
                          (select md5(string_agg(id::text, ',' order by id)) from public.orders))
     or (select now_seen from t_seen where actor = 'accountant' and aal = 'aal2' and tbl = 'profiles') not like
        (select count(*) from public.profiles)::text || ':%' then
    raise exception 'CASE 2 FAILED: a caller sees the wrong number of rows: %',
      (select string_agg(actor || '/' || aal || '/' || tbl || '=' || split_part(now_seen, ':', 1), ' ' order by actor, aal, tbl) from t_seen);
  end if;

  -- The pre-image policies, for a moment. What is there now is saved and put
  -- back exactly, so on a chain without the migration CASE 1 and CASE 3 still
  -- see the old quals.
  create temporary table t_qual on commit drop as
    select tablename, policyname, qual from pg_policies
     where schemaname = 'public' and policyname in
           ('profiles_select_own_or_staff', 'orders_select_own_or_staff', 'loyalty_tx_select_own_or_staff');
  alter policy profiles_select_own_or_staff on public.profiles
    using ((id = (select auth.uid())) or public.is_staff());
  alter policy orders_select_own_or_staff on public.orders
    using ((customer_id = (select auth.uid())) or public.is_staff());
  alter policy loyalty_tx_select_own_or_staff on public.loyalty_transactions
    using ((profile_id = (select auth.uid())) or public.is_staff());

  for v_orig in select * from t_seen loop
    v := pg_temp.visible((select uid from t_actor where k = v_orig.actor), v_orig.aal, v_orig.tbl);
    if v is distinct from v_orig.now_seen then
      raise exception 'CASE 2 FAILED: % at % sees % in % under the old policy, % under the new',
        v_orig.actor, v_orig.aal, v, v_orig.tbl, v_orig.now_seen;
    end if;
  end loop;

  for v_orig in select * from t_qual loop
    execute format('alter policy %I on public.%I using (%s)', v_orig.policyname, v_orig.tablename, v_orig.qual);
  end loop;

  raise notice 'CASE 2 ok: % caller/table pairs see the rows the policy describes, identical under the old and new quals',
    (select count(*) from t_seen);
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — is_staff() is an InitPlan, not a per-row filter call
-- ---------------------------------------------------------------------------
do $$
declare
  t text; line text; v_plan text;
  v_uid uuid := (select uid from t_actor where k = 'median');
begin
  foreach t in array array['orders', 'profiles', 'loyalty_transactions'] loop
    v_plan := '';
    perform pg_temp.become(v_uid, 'aal1');
    for line in execute format('explain (costs off) select id from public.%I', t) loop
      v_plan := v_plan || line || E'\n';
    end loop;
    perform pg_temp.unbecome();

    if v_plan ~ 'is_staff\(\)' then
      raise exception 'CASE 3 FAILED: the % plan calls is_staff() per row:%', t, E'\n' || v_plan;
    end if;
    if (select count(*) from regexp_matches(v_plan, 'InitPlan', 'g')) <> 2
       or v_plan !~ 'Filter: \(\(\w+ = \$0\) OR \$1\)' then
      raise exception 'CASE 3 FAILED: the % plan does not filter on two InitPlans:%', t, E'\n' || v_plan;
    end if;
  end loop;

  raise notice 'CASE 3 ok: orders, profiles and loyalty_transactions filter on ((owner = $0) OR $1)';
end $$;


-- ---------------------------------------------------------------------------
-- CASE 4 — the live board: same orders, same order, same gate
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid := (select uid from t_actor where k = 'admin');
  v_acct  uuid := (select uid from t_actor where k = 'accountant');
  v_cust  uuid := (select uid from t_actor where k = 'median');
  v_lim   integer;
  v_got   text;
  v_want  text;
  v_src   text;
begin
  -- The old predicate, run as postgres, is the oracle.
  foreach v_lim in array array[null, -1, 0, 1, 3, 10, 30, 1000]::integer[] loop
    select coalesce(string_agg(o.id::text, ',' order by o.created_at desc), '') into v_want
      from public.orders o
     where v_lim is null
        or o.id in (select r.id from public.orders r order by r.created_at desc limit greatest(1, v_lim))
        or o.status not in ('delivered', 'cancelled');
    v_got := pg_temp.board(v_admin, 'aal2', v_lim);
    if v_got is distinct from v_want then
      raise exception 'CASE 4 FAILED: p_limit % returned [%], expected [%]', coalesce(v_lim::text, 'null'), v_got, v_want;
    end if;
    if pg_temp.board(v_acct, 'aal2', v_lim) is distinct from v_want then
      raise exception 'CASE 4 FAILED: an accountant at aal2 got a different board for p_limit %', coalesce(v_lim::text, 'null');
    end if;
  end loop;

  -- The fixture is not vacuous: with p_limit 3 the board holds the 3 most
  -- recent orders AND older open ones, and leaves older settled ones out.
  v_got := pg_temp.board(v_admin, 'aal2', 3);
  if not exists (select 1 from public.orders o
                  where o.status not in ('delivered', 'cancelled')
                    and o.created_at < (select min(created_at) from (select created_at from public.orders order by created_at desc limit 3) x)
                    and position(o.id::text in v_got) > 0)
     or exists (select 1 from public.orders o
                 where o.status in ('delivered', 'cancelled')
                   and o.created_at < (select min(created_at) from (select created_at from public.orders order by created_at desc limit 3) x)
                   and position(o.id::text in v_got) > 0) then
    raise exception 'CASE 4 FAILED: the fixture does not separate the two arms';
  end if;

  -- The gate, as a value.
  if pg_temp.board(v_cust, 'aal1', 5) is distinct from '42501'
     or pg_temp.board(v_admin, 'aal1', 5) is distinct from '42501'
     or pg_temp.board(v_acct, 'aal1', 5) is distinct from '42501' then
    raise exception 'CASE 4 FAILED: a customer or a staff member at aal1 got past the gate';
  end if;

  -- One id set, with no top-level OR left for the planner to trip on.
  select prosrc into v_src from pg_proc where oid = 'public.admin_list_orders_with_items(integer)'::regprocedure;
  if position('union' in v_src) = 0 or v_src ~ 'or o\.status not in'
     or v_src ~ 'where p_limit is null\s+(--[^\n]*\s+)*or o\.id' then
    raise exception 'CASE 4 FAILED: admin_list_orders_with_items still ORs its two arms at the top of the WHERE';
  end if;

  raise notice 'CASE 4 ok: same board for 8 p_limit values and both staff roles; gate holds at aal1; one UNION id set';
end $$;


-- ---------------------------------------------------------------------------
-- CASE 5 — the order-number year is the Riyadh year
-- ---------------------------------------------------------------------------
-- now() is the transaction's start and cannot be moved, so the STORED body is
-- run with now() replaced by a fixed instant, as a trigger on a scratch table.
-- Everything else in it, nextval() included, runs as written.
do $$
declare
  v_src text := (select prosrc from pg_proc where oid = 'public.set_order_number()'::regprocedure);
  v_got text;
  v_order uuid := gen_random_uuid();
  r record;
  z text;
begin
  if (length(v_src) - length(replace(v_src, 'now()', ''))) / length('now()') <> 1 then
    raise exception 'CASE 5 FAILED: set_order_number does not call now() exactly once';
  end if;
  create temporary table t_numbered (order_number text);

  foreach z in array array['UTC', 'Asia/Riyadh', 'America/Los_Angeles'] loop
    perform set_config('TimeZone', z, true);
    for r in
      select * from (values
        ('2026-12-31 21:30:00+00', 'SM-2027-'),  -- 00:30 on 1 January in Riyadh
        ('2026-12-31 20:59:59+00', 'SM-2026-'),  -- 23:59:59 on 31 December in Riyadh
        ('2025-12-31 21:00:00+00', 'SM-2026-'),  -- midnight in Riyadh, to the second
        ('2027-01-01 00:00:00+00', 'SM-2027-'),
        ('2026-07-01 12:00:00+00', 'SM-2026-')
      ) as x(at_utc, prefix)
    loop
      execute format(
        'create or replace function pg_temp.numbered_at() returns trigger language plpgsql as %L',
        replace(v_src, 'now()', format('timestamptz %L', r.at_utc)));
      drop trigger if exists numbered on t_numbered;
      create trigger numbered before insert on t_numbered
        for each row execute function pg_temp.numbered_at();
      insert into t_numbered values (null) returning order_number into v_got;
      if v_got is null or v_got !~ ('^' || r.prefix || '[0-9]{6}$') then
        raise exception 'CASE 5 FAILED: with TimeZone %, an order placed at % UTC is numbered %, expected %NNNNNN',
          z, r.at_utc, coalesce(v_got, 'NULL'), r.prefix;
      end if;
    end loop;
  end loop;
  perform set_config('TimeZone', 'UTC', true);

  -- The real trigger on the real table still numbers an order, today.
  set local session_replication_role = replica;
  alter table public.orders enable always trigger set_orders_number;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total)
  values (v_order, null, (select id from public.branches order by id limit 1), 'pickup', 10, 10);
  alter table public.orders enable trigger set_orders_number;
  set local session_replication_role = origin;
  select order_number into v_got from public.orders where id = v_order;
  if v_got is null or v_got !~ ('^SM-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-[0-9]{6}$') then
    raise exception 'CASE 5 FAILED: the orders trigger numbered a new order %', coalesce(v_got, 'NULL');
  end if;

  raise notice 'CASE 5 ok: 2026-12-31 21:30 UTC is SM-2027 in three session time zones; the real trigger gave %', v_got;
end $$;

rollback;
