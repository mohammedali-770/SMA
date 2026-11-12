-- ============================================================================
-- A staff account can be deleted after it has done ordinary work
-- (20261002120000_staff_actor_fk_set_null).
--
-- WHAT THIS SUITE PROVES. Before that file, four actor columns referenced
-- profiles with ON DELETE NO ACTION. A branch operator who had filed a
-- delivery-closure request, a call-centre user who had resolved one, an operator
-- who had revealed a reference secret and an admin who had created a reference
-- entry each made their own account undeletable (23503). CASE 1 has each of them
-- do exactly that work and then deletes the account. CASE 2 is the catalog guard
-- that stops a future table reintroducing the block.
--
-- IMPERSONATION NOTE. As in branch_delivery_requests_test.sql and
-- branch_reference_entries_test.sql, impersonation is through
-- request.jwt.claim.sub, because the test.* GUCs cannot express call_center or
-- branch_staff.
--
-- Single transaction, rolled back. Disposable/local database only.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid := 'd1000000-0000-0000-0000-000000000001';
  v_op    uuid := 'd1000000-0000-0000-0000-000000000002';
  v_cc    uuid := 'd1000000-0000-0000-0000-000000000003';
  v_op2   uuid := 'd1000000-0000-0000-0000-000000000004';
  v_idle  uuid := 'd1000000-0000-0000-0000-000000000005';
begin
  insert into auth.users(id) values (v_admin),(v_op),(v_cc),(v_op2),(v_idle)
  on conflict (id) do nothing;

  insert into public.profiles(id, full_name, role) values
    (v_admin, 'Del Admin', 'admin'),
    (v_op,    'Del Branch Operator', 'branch_staff'),
    (v_cc,    'Del Call Centre', 'call_center'),
    (v_op2,   'Del Second Operator', 'branch_staff'),
    (v_idle,  'Del Idle Operator', 'branch_staff')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

  insert into public.branches (id, name_en, name_ar, is_active, delivery_enabled)
  values ('bd000000-0000-0000-0000-0000000000aa', 'Del Branch', 'فرع الحذف', true, true)
  on conflict (id) do update set is_active = true, delivery_enabled = true;

  insert into public.staff_branch_assignments(user_id, branch_id) values
    (v_op,   'bd000000-0000-0000-0000-0000000000aa'),
    (v_op2,  'bd000000-0000-0000-0000-0000000000aa'),
    (v_idle, 'bd000000-0000-0000-0000-0000000000aa')
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

create or replace function pg_temp.as_user(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, true); $$;

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- ---- CASE 1: ordinary work, then each account is deleted -----------------------
do $$
declare
  v_req   uuid;
  v_entry uuid;
  v_out   jsonb;
  v_err   text;
  r       record;
begin
  -- The operator files a delivery-closure request; the call centre declines it.
  perform pg_temp.as_user('d1000000-0000-0000-0000-000000000002');
  v_out := public.request_branch_delivery_pause(
    'bd000000-0000-0000-0000-0000000000aa', 30, 'no_driver', 'Deletion fixture');
  v_req := (v_out ->> 'id')::uuid;
  if v_req is null then
    raise exception 'CASE 1: the request was not filed: %', v_out;
  end if;

  perform pg_temp.as_user('d1000000-0000-0000-0000-000000000003');
  perform public.resolve_branch_delivery_request(v_req, false, null, 'Deletion fixture: declined');

  -- The admin creates a secret entry; the second operator reveals it.
  perform pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
  v_out := public.admin_upsert_branch_reference(
    'bd000000-0000-0000-0000-0000000000aa', 'secret', 'Fixture login', 'دخول تجريبي', 'not-a-real-secret');
  v_entry := (v_out ->> 'id')::uuid;

  perform pg_temp.as_user('d1000000-0000-0000-0000-000000000004');
  perform public.branch_reference_reveal(v_entry);

  -- The work is attributed before anyone is deleted.
  if (select requested_by from public.branch_delivery_requests where id = v_req)
       is distinct from 'd1000000-0000-0000-0000-000000000002'::uuid
     or (select resolved_by from public.branch_delivery_requests where id = v_req)
       is distinct from 'd1000000-0000-0000-0000-000000000003'::uuid
     or (select created_by from public.branch_reference_entries where id = v_entry)
       is distinct from 'd1000000-0000-0000-0000-000000000001'::uuid
     or not exists (select 1 from public.branch_reference_reveals
                     where entry_id = v_entry
                       and revealed_by = 'd1000000-0000-0000-0000-000000000004') then
    raise exception 'CASE 1: the fixture did not attribute the work as expected';
  end if;

  -- Each delete is what the console's staff "Delete" does (auth.users, which
  -- cascades to profiles). Every one must succeed.
  for r in select * from (values
      ('d1000000-0000-0000-0000-000000000002'::uuid, 'operator who filed a request'),
      ('d1000000-0000-0000-0000-000000000003'::uuid, 'call centre that resolved it'),
      ('d1000000-0000-0000-0000-000000000004'::uuid, 'operator who revealed a secret'),
      ('d1000000-0000-0000-0000-000000000001'::uuid, 'admin who created the entry'),
      ('d1000000-0000-0000-0000-000000000005'::uuid, 'operator with no history (control)')) t(id, who) loop
    v_err := pg_temp.err(format('delete from auth.users where id = %L', r.id));
    if v_err is not null then
      raise exception 'CASE 1: deleting the % failed: %', r.who, v_err;
    end if;
    if exists (select 1 from public.profiles where id = r.id) then
      raise exception 'CASE 1: the % still has a profile after deletion', r.who;
    end if;
  end loop;

  -- The records stay, without an actor, and still make sense.
  if not exists (select 1 from public.branch_delivery_requests
                  where id = v_req and status = 'declined' and resolved_at is not null
                    and requested_by is null and resolved_by is null) then
    raise exception 'CASE 1: the request must survive, declined, with both actors cleared';
  end if;
  if not exists (select 1 from public.branch_reference_entries
                  where id = v_entry and created_by is null) then
    raise exception 'CASE 1: the entry must survive with created_by cleared';
  end if;
  if not exists (select 1 from public.branch_reference_reveals
                  where entry_id = v_entry and revealed_by is null) then
    raise exception 'CASE 1: the reveal record must survive with revealed_by cleared';
  end if;

  raise notice 'CASE 1 OK — every staff account deleted; its records kept without an actor';
end $$;

-- ---- CASE 2: nothing in public may block deleting a profile or an account --------
do $$
declare v_list text;
begin
  select string_agg(c.conrelid::regclass || '.' || c.conname, ', ' order by 1)
    into v_list
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
     and c.confdeltype in ('a', 'r');
  if v_list is not null then
    raise exception 'CASE 2: these keys block deleting a profile or account: %', v_list;
  end if;
  raise notice 'CASE 2 OK — no NO ACTION or RESTRICT key into profiles or auth.users';
end $$;

rollback;
