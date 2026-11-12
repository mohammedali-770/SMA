-- ============================================================================
-- admin_loyalty_stats() (migration 20261008120000).
--
-- WHAT THIS PINS. The Settings → Loyalty tiles used to be summed in the browser
-- over an unbounded profiles read, which PostgREST caps at 1 000 rows. The
-- replacement must:
--
--   * return the TRUE totals however many customers exist — the fixture seeds
--     1 200, past the cap the old read fell off;
--   * count customers only, as the client's `role === 'customer'` filter did;
--   * refuse exactly who `profiles_select_own_or_staff` refuses: a customer, an
--     anonymous caller, and an administrator at AAL1;
--   * and the ledger's page order (full_name, id) must be TOTAL: paging through
--     it visits every customer exactly once, with only seven distinct names
--     among 1 200 rows. full_name alone is not unique, so a name-only order
--     leaves the order of ties, and therefore page boundaries, unspecified.
--
-- Callers are impersonated the way PostgREST does it — JWT claims plus the
-- authenticated role — with the harness's test.* overrides cleared, so
-- current_app_role() reads each caller's real profile.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- The harness replaces jwt_has_aal2() with true. Restore the production body for
-- this transaction so aal1 and aal2 differ.
create or replace function public.jwt_has_aal2()
returns boolean language sql stable set search_path = public as $$
  select public.aal_claim_satisfies_staff_mfa(auth.jwt() ->> 'aal');
$$;

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

-- The stats as a caller: the jsonb, or the SQLSTATE as text.
create or replace function pg_temp.stats_as(p_uid uuid, p_aal text) returns text
language plpgsql as $$
declare v jsonb; s text;
begin
  perform pg_temp.become(p_uid, p_aal);
  begin
    v := public.admin_loyalty_stats();
    s := v::text;
  exception when others then
    s := sqlstate;
  end;
  perform pg_temp.unbecome();
  return s;
end $$;

-- The ledger as a caller, page by page, exactly as the console asks for it:
-- role = customer, order by full_name then id, 50 at a time. Returns
-- 'pages:rows:distinct ids'.
create or replace function pg_temp.ledger_walk(p_uid uuid, p_aal text, p_order text) returns text
language plpgsql as $$
declare
  v_from integer := 0;
  v_pages integer := 0;
  v_page uuid[];
  v_all uuid[] := '{}';
begin
  perform pg_temp.become(p_uid, p_aal);
  loop
    execute format(
      'select array_agg(id) from (select id from public.profiles where role = ''customer'' order by %s limit 50 offset %s) t',
      p_order, v_from)
      into v_page;
    exit when v_page is null;
    v_pages := v_pages + 1;
    v_all := v_all || v_page;
    v_from := v_from + 50;
  end loop;
  perform pg_temp.unbecome();
  return v_pages || ':' || coalesce(array_length(v_all, 1), 0) || ':'
      || (select count(distinct x) from unnest(v_all) x);
end $$;

create temporary table t_actor (k text primary key, uid uuid);
create temporary table t_base (members bigint, points bigint);

-- Whatever the chain and seed already hold, so the fixture's own figures can be
-- asserted exactly on top.
insert into t_base
  select count(*), coalesce(sum(loyalty_points), 0) from public.profiles where role = 'customer';

-- ---------------------------------------------------------------------------
-- Fixtures: 1 200 customers holding 1..1 200 points (720 600 in all) with only
-- seven distinct names, so a name-only order is not total; an administrator
-- and an accountant who hold points of their own, which must NOT be counted.
-- ---------------------------------------------------------------------------
do $$
declare
  i integer;
  v_uid uuid;
begin
  insert into t_actor (k, uid) values
    ('admin', gen_random_uuid()), ('accountant', gen_random_uuid()), ('caller', gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at)
    select uid, k || '-loyaltystats@example.test', now() from t_actor;
  update public.profiles set role = 'admin', loyalty_points = 900000
   where id = (select uid from t_actor where k = 'admin');
  update public.profiles set role = 'accountant', loyalty_points = 800000
   where id = (select uid from t_actor where k = 'accountant');
  -- 'caller' stays a customer with 0 points: it is one of the counted rows.

  for i in 1 .. 1200 loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, email, email_confirmed_at)
      values (v_uid, 'c' || i || '-loyaltystats@example.test', now());
    update public.profiles
       set full_name = 'Customer ' || (i % 7), loyalty_points = i
     where id = v_uid;
  end loop;
end $$;

-- ---- CASE 1: the totals are exact past 1 000 rows, staff balances excluded -----
do $$
declare
  b t_base;
  v text;
  v_expect jsonb;
begin
  select * into b from t_base;
  -- +1 for 'caller', a customer with 0 points.
  v_expect := jsonb_build_object('member_count', b.members + 1201, 'points_total', b.points + 720600);

  v := pg_temp.stats_as((select uid from t_actor where k = 'admin'), 'aal2');
  if v::jsonb is distinct from v_expect then
    raise exception 'CASE 1 FAILED: admin at aal2 got %, expected %', v, v_expect;
  end if;

  v := pg_temp.stats_as((select uid from t_actor where k = 'accountant'), 'aal2');
  if v::jsonb is distinct from v_expect then
    raise exception 'CASE 1 FAILED: accountant at aal2 got %, expected %', v, v_expect;
  end if;

  -- And it agrees with a direct count, so the fixture arithmetic is not the
  -- only witness.
  if (v::jsonb ->> 'member_count')::bigint
       is distinct from (select count(*) from public.profiles where role = 'customer')
     or (v::jsonb ->> 'points_total')::bigint
       is distinct from (select sum(loyalty_points) from public.profiles where role = 'customer') then
    raise exception 'CASE 1 FAILED: % disagrees with a direct count', v;
  end if;
  raise notice 'CASE 1 ok: % (1 200 seeded customers, staff balances excluded)', v;
end $$;

-- ---- CASE 2: refused for everyone profiles_select_own_or_staff refuses -------
do $$
declare v text;
begin
  v := pg_temp.stats_as((select uid from t_actor where k = 'caller'), 'aal2');
  if v is distinct from '42501' then
    raise exception 'CASE 2 FAILED: a customer got %, expected 42501', v;
  end if;

  v := pg_temp.stats_as((select uid from t_actor where k = 'admin'), 'aal1');
  if v is distinct from '42501' then
    raise exception 'CASE 2 FAILED: an admin at aal1 got %, expected 42501', v;
  end if;

  v := pg_temp.stats_as((select uid from t_actor where k = 'accountant'), 'aal1');
  if v is distinct from '42501' then
    raise exception 'CASE 2 FAILED: an accountant at aal1 got %, expected 42501', v;
  end if;
  raise notice 'CASE 2 ok: customer, aal1 admin and aal1 accountant refused with 42501';
end $$;

-- ---- CASE 3: anon holds no EXECUTE at all ------------------------------------
do $$
declare v_state text;
begin
  if has_function_privilege('anon', 'public.admin_loyalty_stats()', 'EXECUTE') then
    raise exception 'CASE 3 FAILED: anon holds EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_loyalty_stats()', 'EXECUTE') then
    raise exception 'CASE 3 FAILED: authenticated lacks EXECUTE';
  end if;
  begin
    set local role anon;
    perform public.admin_loyalty_stats();
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    reset role;
  end;
  if v_state is distinct from '42501' then
    raise exception 'CASE 3 FAILED: anon call got %, expected 42501', v_state;
  end if;
  raise notice 'CASE 3 ok: anon refused (permission denied), authenticated granted';
end $$;

-- ---- CASE 4: the ledger's page order is total --------------------------------
do $$
declare
  b t_base;
  v text;
  v_n bigint;
begin
  select * into b from t_base;
  v_n := b.members + 1201;

  v := pg_temp.ledger_walk((select uid from t_actor where k = 'admin'), 'aal2', 'full_name, id');
  if v is distinct from (ceil(v_n / 50.0)::integer || ':' || v_n || ':' || v_n) then
    raise exception 'CASE 4 FAILED: paging by (full_name, id) gave %, expected every one of % customers once', v, v_n;
  end if;

  -- The same walk as an accountant (the other role allowed in).
  v := pg_temp.ledger_walk((select uid from t_actor where k = 'accountant'), 'aal2', 'full_name, id');
  if split_part(v, ':', 3)::bigint is distinct from v_n then
    raise exception 'CASE 4 FAILED: accountant paging gave %', v;
  end if;

  -- A customer paging the same query sees only their own row (RLS), not the list.
  v := pg_temp.ledger_walk((select uid from t_actor where k = 'caller'), 'aal2', 'full_name, id');
  if v is distinct from '1:1:1' then
    raise exception 'CASE 4 FAILED: a customer paging the ledger saw %, expected only their own row', v;
  end if;

  -- An administrator at AAL1 is likewise reduced to their own row, which is not
  -- a customer row, so nothing.
  v := pg_temp.ledger_walk((select uid from t_actor where k = 'admin'), 'aal1', 'full_name, id');
  if v is distinct from '0:0:0' then
    raise exception 'CASE 4 FAILED: an aal1 admin paging the ledger saw %, expected nothing', v;
  end if;
  raise notice 'CASE 4 ok: (full_name, id) pages visit all % customers exactly once', v_n;
end $$;

rollback;
