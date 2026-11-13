-- ============================================================================
-- Dropping push_devices_admin_select (migration 20261011120000).
--
-- WHAT THIS PINS. After the drop:
--
--   * an administrator at AAL2 reading push_devices directly sees NO row, so
--     no client role can read another customer's Expo token;
--   * a customer still sees exactly their own rows;
--   * Push Tools still gets its numbers, through customer_push_device_counts();
--   * no SELECT policy left on the table is keyed to a staff predicate.
--
-- Without the migration, case 1 fails: the administrator reads every row.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- The harness replaces jwt_has_aal2() with true. Restore the production body for
-- this transaction so an AAL2 administrator is a real one.
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

-- What a caller sees reading push_devices directly: 'rows:tokens' for the
-- fixture tokens, or the SQLSTATE.
create or replace function pg_temp.read_as(p_uid uuid, p_aal text) returns text
language plpgsql as $$
declare v_rows bigint; v_tokens text; s text;
begin
  perform pg_temp.become(p_uid, p_aal);
  begin
    select count(*), string_agg(expo_push_token, ',' order by expo_push_token)
      into v_rows, v_tokens
      from public.push_devices
     where expo_push_token like 'ExponentPushToken[DropTest%';
    s := v_rows || ':' || coalesce(v_tokens, '');
  exception when others then
    s := sqlstate;
  end;
  perform pg_temp.unbecome();
  return s;
end $$;

create or replace function pg_temp.counts_as(p_uid uuid, p_aal text) returns text
language plpgsql as $$
declare v jsonb; s text;
begin
  perform pg_temp.become(p_uid, p_aal);
  begin
    v := public.customer_push_device_counts();
    s := v::text;
  exception when others then
    s := sqlstate;
  end;
  perform pg_temp.unbecome();
  return s;
end $$;

create temporary table t_actor (k text primary key, uid uuid);

do $$
begin
  insert into t_actor (k, uid) values
    ('admin', gen_random_uuid()), ('alice', gen_random_uuid()), ('bob', gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at)
    select uid, k || '-droptest@example.test', now() from t_actor;
  update public.profiles set role = 'admin' where id = (select uid from t_actor where k = 'admin');
  insert into public.push_devices (customer_id, expo_push_token, platform, is_active, promos_enabled)
  values ((select uid from t_actor where k = 'alice'), 'ExponentPushToken[DropTestAlice]', 'ios', true, true),
         ((select uid from t_actor where k = 'bob'),   'ExponentPushToken[DropTestBob]',   'android', true, false);
end $$;

-- ---- CASE 1: an AAL2 administrator reads no token ----------------------------
do $$
declare v text;
begin
  v := pg_temp.read_as((select uid from t_actor where k = 'admin'), 'aal2');
  if v is distinct from '0:' then
    raise exception 'CASE 1 FAILED: an aal2 admin reading push_devices got %, expected no row', v;
  end if;
  raise notice 'CASE 1 ok: an aal2 admin reads no push_devices row';
end $$;

-- ---- CASE 2: a customer still reads exactly their own row --------------------
do $$
declare v text;
begin
  v := pg_temp.read_as((select uid from t_actor where k = 'alice'), 'aal1');
  if v is distinct from '1:ExponentPushToken[DropTestAlice]' then
    raise exception 'CASE 2 FAILED: alice got %, expected only her own row', v;
  end if;
  v := pg_temp.read_as((select uid from t_actor where k = 'bob'), 'aal1');
  if v is distinct from '1:ExponentPushToken[DropTestBob]' then
    raise exception 'CASE 2 FAILED: bob got %, expected only his own row', v;
  end if;
  raise notice 'CASE 2 ok: each customer reads only their own row';
end $$;

-- ---- CASE 3: Push Tools still gets its numbers --------------------------------
do $$
declare v text;
begin
  v := pg_temp.counts_as((select uid from t_actor where k = 'admin'), 'aal2');
  if v !~ '^\{' then
    raise exception 'CASE 3 FAILED: the counts RPC got %, expected an object', v;
  end if;
  if (v::jsonb ->> 'active_devices')::bigint
       is distinct from (select count(*) from public.push_devices where is_active)
     or (v::jsonb ->> 'promo_opt_ins')::bigint
       is distinct from (select count(*) from public.push_devices where is_active and promos_enabled) then
    raise exception 'CASE 3 FAILED: % disagrees with a direct count', v;
  end if;
  raise notice 'CASE 3 ok: %', v;
end $$;

-- ---- CASE 4: no staff-keyed SELECT policy remains ---------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'push_devices'
     and cmd in ('SELECT', 'ALL')
     and coalesce(qual, '') ~ '(is_admin|is_staff|is_call_center|is_branch_operator)';
  if v_n <> 0 then
    raise exception 'CASE 4 FAILED: % staff-keyed SELECT policy(ies) remain on push_devices', v_n;
  end if;
  raise notice 'CASE 4 ok: no staff-keyed SELECT policy on push_devices';
end $$;

rollback;
