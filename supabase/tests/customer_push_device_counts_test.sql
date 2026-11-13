-- ============================================================================
-- customer_push_device_counts() (migration 20261010120000).
--
-- WHAT THIS PINS. Push Tools counted devices through push_devices_admin_select,
-- a policy that also lets an administrator session read every Expo token. The
-- replacement must:
--
--   * return the same two counts the console computed: active devices, and
--     active devices with offers on (the broadcast audience);
--   * return no token, checked as the absence of every seeded token from the
--     response text;
--   * refuse exactly who the policy refuses: an accountant, a customer, an
--     anonymous caller, and an administrator at AAL1.
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
create temporary table t_base (active bigint, promos bigint);

insert into t_base
  select count(*) filter (where is_active), count(*) filter (where is_active and promos_enabled)
    from public.push_devices;

-- ---------------------------------------------------------------------------
-- Fixtures: 14 devices across 14 customers.
--   7 active with offers on, 4 active with offers off, 3 inactive with offers on.
-- So active = +11 and promo opt-ins = +7. The inactive-with-offers rows are the
-- ones a count that forgot is_active would include.
-- ---------------------------------------------------------------------------
do $$
declare
  i integer;
  v_uid uuid;
begin
  insert into t_actor (k, uid) values
    ('admin', gen_random_uuid()), ('accountant', gen_random_uuid()), ('customer', gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at)
    select uid, k || '-pushcounts@example.test', now() from t_actor;
  update public.profiles set role = 'admin' where id = (select uid from t_actor where k = 'admin');
  update public.profiles set role = 'accountant' where id = (select uid from t_actor where k = 'accountant');

  for i in 1 .. 14 loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, email, email_confirmed_at)
      values (v_uid, 'd' || i || '-pushcounts@example.test', now());
    insert into public.push_devices (customer_id, expo_push_token, platform, is_active, promos_enabled)
      values (v_uid, 'ExponentPushToken[CountSecret' || i || ']', 'ios',
              i <= 11, i <= 7 or i >= 12);
  end loop;
end $$;

-- ---- CASE 1: the counts are exact, and match a direct count -----------------
do $$
declare
  b t_base;
  v text;
begin
  select * into b from t_base;
  v := pg_temp.counts_as((select uid from t_actor where k = 'admin'), 'aal2');
  if v::jsonb is distinct from jsonb_build_object('active_devices', b.active + 11, 'promo_opt_ins', b.promos + 7) then
    raise exception 'CASE 1 FAILED: admin at aal2 got %, expected active +11 and opt-ins +7 over %/%', v, b.active, b.promos;
  end if;
  if (v::jsonb ->> 'active_devices')::bigint
       is distinct from (select count(*) from public.push_devices where is_active)
     or (v::jsonb ->> 'promo_opt_ins')::bigint
       is distinct from (select count(*) from public.push_devices where is_active and promos_enabled) then
    raise exception 'CASE 1 FAILED: % disagrees with a direct count', v;
  end if;
  raise notice 'CASE 1 ok: %', v;
end $$;

-- ---- CASE 2: no token in the response ----------------------------------------
do $$
declare v text;
begin
  v := pg_temp.counts_as((select uid from t_actor where k = 'admin'), 'aal2');
  if v ~ '(ExponentPushToken|CountSecret)' then
    raise exception 'CASE 2 FAILED: a token reached the response: %', v;
  end if;
  if (select count(*) from jsonb_object_keys(v::jsonb)) <> 2 then
    raise exception 'CASE 2 FAILED: expected exactly two keys, got %', v;
  end if;
  raise notice 'CASE 2 ok: two counts, no token';
end $$;

-- ---- CASE 3: refused for everyone push_devices_admin_select refuses ----------
do $$
declare v text;
begin
  v := pg_temp.counts_as((select uid from t_actor where k = 'admin'), 'aal1');
  if v is distinct from '42501' then
    raise exception 'CASE 3 FAILED: an admin at aal1 got %, expected 42501', v;
  end if;
  v := pg_temp.counts_as((select uid from t_actor where k = 'accountant'), 'aal2');
  if v is distinct from '42501' then
    raise exception 'CASE 3 FAILED: an accountant got %, expected 42501', v;
  end if;
  v := pg_temp.counts_as((select uid from t_actor where k = 'customer'), 'aal2');
  if v is distinct from '42501' then
    raise exception 'CASE 3 FAILED: a customer got %, expected 42501', v;
  end if;
  raise notice 'CASE 3 ok: aal1 admin, accountant and customer refused with 42501';
end $$;

-- ---- CASE 4: anon holds no EXECUTE at all ------------------------------------
do $$
declare v_state text;
begin
  if has_function_privilege('anon', 'public.customer_push_device_counts()', 'EXECUTE') then
    raise exception 'CASE 4 FAILED: anon holds EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.customer_push_device_counts()', 'EXECUTE') then
    raise exception 'CASE 4 FAILED: authenticated lacks EXECUTE';
  end if;
  begin
    set local role anon;
    perform public.customer_push_device_counts();
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    reset role;
  end;
  if v_state is distinct from '42501' then
    raise exception 'CASE 4 FAILED: anon call got %, expected 42501', v_state;
  end if;
  raise notice 'CASE 4 ok: anon refused, authenticated granted';
end $$;

rollback;
