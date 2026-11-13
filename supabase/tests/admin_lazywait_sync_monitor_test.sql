-- ============================================================================
-- admin_lazywait_sync_monitor() (migration 20261009120000).
--
-- WHAT THIS PINS. The Lazywait monitor used to read the general staff order
-- feed, so every row it fetched carried the customer's name, phone, address,
-- notes and coupon. The replacement must:
--
--   * return exactly the twelve sync columns and nothing about the customer,
--     checked both as the key set and as the absence of every seeded customer
--     value from the whole response text;
--   * keep only orders whose sync state is set and is not 'skipped', newest
--     first, with a default of 50 and a clamp to 1..200;
--   * carry pos_sync_deadline_at, which the console's requeue-eligibility
--     mirror reads and admin_list_orders never returned;
--   * refuse exactly who admin_list_orders refuses: a customer, an anonymous
--     caller, and staff at AAL1.
--
-- Callers are impersonated the way PostgREST does it, JWT claims plus the
-- authenticated role, with the harness's test.* overrides cleared.
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

-- The monitor as a caller: the jsonb, or the SQLSTATE as text.
create or replace function pg_temp.monitor_as(p_uid uuid, p_aal text, p_limit integer) returns text
language plpgsql as $$
declare v jsonb; s text;
begin
  perform pg_temp.become(p_uid, p_aal);
  begin
    if p_limit is null then
      v := public.admin_lazywait_sync_monitor();
    else
      v := public.admin_lazywait_sync_monitor(p_limit);
    end if;
    s := v::text;
  exception when others then
    s := sqlstate;
  end;
  perform pg_temp.unbecome();
  return s;
end $$;

create temporary table t_actor (k text primary key, uid uuid);
create temporary table t_branch (id uuid);

-- ---------------------------------------------------------------------------
-- Fixtures. 230 orders dated in 2099, so they are newer than anything the
-- chain or its seed holds and the newest-first window is entirely ours:
--   i = 1..230, created 2099-01-01 + i minutes, so i = 230 is the newest;
--   every 10th order is 'skipped' (23 rows) and must never appear;
--   the rest are 'failed', each with a distinct deadline.
-- Every order carries recognisable customer values that must never appear.
-- ---------------------------------------------------------------------------
do $$
declare
  i integer;
  v_bid uuid := gen_random_uuid();
  v_cust uuid;
begin
  insert into t_actor (k, uid) values
    ('admin', gen_random_uuid()), ('accountant', gen_random_uuid()), ('customer', gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at)
    select uid, k || '-lwmonitor@example.test', now() from t_actor;
  update public.profiles set role = 'admin' where id = (select uid from t_actor where k = 'admin');
  update public.profiles set role = 'accountant' where id = (select uid from t_actor where k = 'accountant');
  v_cust := (select uid from t_actor where k = 'customer');

  insert into public.branches (id, name_en, name_ar) values (v_bid, 'Monitor Branch', 'فرع المراقبة');
  insert into t_branch values (v_bid);

  for i in 1 .. 230 loop
    insert into public.orders (order_number, customer_id, branch_id, order_type, subtotal, total,
                               payment_status, customer_name, customer_phone, notes, coupon_code,
                               address_snapshot, created_at)
    values ('LWMON-' || lpad(i::text, 3, '0'), v_cust, v_bid, 'pickup', 10, 12,
            'pending', 'MonitorSecretName', '+966500000042', 'MonitorSecretNote', 'MONSECRET',
            jsonb_build_object('line1', 'MonitorSecretStreet'),
            timestamptz '2099-01-01 00:00:00+00' + make_interval(mins => i));
  end loop;

  update public.orders
     set lazywait_sync_state = case when (substr(order_number, 7)::int % 10) = 0 then 'skipped' else 'failed' end,
         sync_attempt_count = 1,
         sync_last_error = 'monitor fixture',
         pos_sync_deadline_at = timestamptz '2099-02-01 00:00:00+00' + make_interval(mins => substr(order_number, 7)::int)
   where order_number like 'LWMON-%';
end $$;

-- ---- CASE 1: the projection is the twelve sync columns, no customer value ---
do $$
declare
  v text;
  v_keys text;
begin
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal2', null);
  if v !~ '^\[' then
    raise exception 'CASE 1 FAILED: admin at aal2 got %, expected an array', v;
  end if;

  select string_agg(distinct k, ',' order by k) into v_keys
    from jsonb_array_elements(v::jsonb) e, jsonb_object_keys(e) k;
  if v_keys is distinct from
     'created_at,id,lazywait_order_number,lazywait_ref,lazywait_sync_state,order_number,order_type,pos_create_attempted_at,pos_sync_deadline_at,sync_attempt_count,sync_blocked_reason,sync_last_error' then
    raise exception 'CASE 1 FAILED: keys are %', v_keys;
  end if;

  if v ~ '(MonitorSecret|MONSECRET|500000042|customer)' then
    raise exception 'CASE 1 FAILED: a customer value reached the response';
  end if;
  raise notice 'CASE 1 ok: twelve sync columns, no customer value in the response text';
end $$;

-- ---- CASE 2: filter, order, default limit and clamp -------------------------
do $$
declare
  v jsonb;
  v_first text;
  v_last text;
begin
  -- Default 50: the newest 50 of ours that are not skipped. Of i = 230 down to
  -- 175, the skipped ones are 230, 220, 210, 200, 190 and 180, so the 50th is 175.
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal2', null)::jsonb;
  if jsonb_array_length(v) <> 50 then
    raise exception 'CASE 2 FAILED: default returned % rows, expected 50', jsonb_array_length(v);
  end if;
  v_first := v -> 0 ->> 'order_number';
  v_last  := v -> 49 ->> 'order_number';
  if v_first is distinct from 'LWMON-229' or v_last is distinct from 'LWMON-175' then
    raise exception 'CASE 2 FAILED: default window is % .. %, expected LWMON-229 .. LWMON-175', v_first, v_last;
  end if;
  if exists (select 1 from jsonb_array_elements(v) e where e ->> 'lazywait_sync_state' = 'skipped') then
    raise exception 'CASE 2 FAILED: a skipped order is listed';
  end if;
  -- Strictly newest first.
  if exists (
    select 1 from (
      select (e ->> 'created_at')::timestamptz as c, lag((e ->> 'created_at')::timestamptz) over (order by n) as prev
        from jsonb_array_elements(v) with ordinality x(e, n)
    ) s where s.prev is not null and s.c >= s.prev
  ) then
    raise exception 'CASE 2 FAILED: rows are not strictly newest first';
  end if;

  -- The clamp: 1 000 gives 200, 0 and -5 give 1, 7 gives 7.
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal2', 1000)::jsonb;
  if jsonb_array_length(v) <> 200 then
    raise exception 'CASE 2 FAILED: p_limit 1000 returned % rows, expected 200', jsonb_array_length(v);
  end if;
  if exists (select 1 from jsonb_array_elements(v) e where e ->> 'lazywait_sync_state' = 'skipped') then
    raise exception 'CASE 2 FAILED: a skipped order is listed at 200';
  end if;
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal2', 0)::jsonb;
  if jsonb_array_length(v) <> 1 or v -> 0 ->> 'order_number' is distinct from 'LWMON-229' then
    raise exception 'CASE 2 FAILED: p_limit 0 returned %', v;
  end if;
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal2', -5)::jsonb;
  if jsonb_array_length(v) <> 1 then
    raise exception 'CASE 2 FAILED: p_limit -5 returned % rows, expected 1', jsonb_array_length(v);
  end if;
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal2', 7)::jsonb;
  if jsonb_array_length(v) <> 7 then
    raise exception 'CASE 2 FAILED: p_limit 7 returned % rows, expected 7', jsonb_array_length(v);
  end if;
  raise notice 'CASE 2 ok: skipped excluded, newest first, default 50, clamped to 1..200';
end $$;

-- ---- CASE 3: pos_sync_deadline_at reaches the console -----------------------
do $$
declare v jsonb;
begin
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal2', 1)::jsonb;
  if (v -> 0 ->> 'pos_sync_deadline_at')::timestamptz
       is distinct from timestamptz '2099-02-01 00:00:00+00' + make_interval(mins => 229) then
    raise exception 'CASE 3 FAILED: deadline is %, expected 2099-02-01 03:49 UTC', v -> 0 ->> 'pos_sync_deadline_at';
  end if;
  raise notice 'CASE 3 ok: pos_sync_deadline_at is in the row';
end $$;

-- ---- CASE 4: refused for everyone admin_list_orders refuses ------------------
do $$
declare v text;
begin
  v := pg_temp.monitor_as((select uid from t_actor where k = 'accountant'), 'aal2', 5);
  if v !~ '^\[' then
    raise exception 'CASE 4 FAILED: an accountant at aal2 got %, expected rows', v;
  end if;
  v := pg_temp.monitor_as((select uid from t_actor where k = 'customer'), 'aal2', 5);
  if v is distinct from '42501' then
    raise exception 'CASE 4 FAILED: a customer got %, expected 42501', v;
  end if;
  v := pg_temp.monitor_as((select uid from t_actor where k = 'admin'), 'aal1', 5);
  if v is distinct from '42501' then
    raise exception 'CASE 4 FAILED: an admin at aal1 got %, expected 42501', v;
  end if;
  v := pg_temp.monitor_as((select uid from t_actor where k = 'accountant'), 'aal1', 5);
  if v is distinct from '42501' then
    raise exception 'CASE 4 FAILED: an accountant at aal1 got %, expected 42501', v;
  end if;
  raise notice 'CASE 4 ok: aal2 staff allowed; customer and aal1 staff refused with 42501';
end $$;

-- ---- CASE 5: anon holds no EXECUTE at all ------------------------------------
do $$
declare v_state text;
begin
  if has_function_privilege('anon', 'public.admin_lazywait_sync_monitor(integer)', 'EXECUTE') then
    raise exception 'CASE 5 FAILED: anon holds EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_lazywait_sync_monitor(integer)', 'EXECUTE') then
    raise exception 'CASE 5 FAILED: authenticated lacks EXECUTE';
  end if;
  begin
    set local role anon;
    perform public.admin_lazywait_sync_monitor(5);
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    reset role;
  end;
  if v_state is distinct from '42501' then
    raise exception 'CASE 5 FAILED: anon call got %, expected 42501', v_state;
  end if;
  raise notice 'CASE 5 ok: anon refused, authenticated granted';
end $$;

rollback;
