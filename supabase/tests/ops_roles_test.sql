-- ============================================================================
-- Operations roles (branch_staff / call_center) authorization coverage.
--
-- IMPERSONATION NOTE. The CI harness overrides current_app_role() so that
-- setting ANY of test.auth_uid / test.is_admin / test.is_staff forces the role
-- to admin | accountant | customer. That override cannot express the new roles,
-- so this suite impersonates through request.jwt.claim.sub instead, which lets
-- current_app_role() fall through to the real profiles lookup. Do not add
-- test.* GUCs to this file — they would silently mask every assertion below.
--
-- The harness also stubs jwt_has_aal2() to true, so the MFA carve-out cannot be
-- observed behaviourally here. It is asserted structurally against
-- pg_get_functiondef, the same technique staff_mfa_aal2_test.sql uses.
-- ============================================================================
begin;

do $$
declare
  v_admin    uuid := 'c1000000-0000-0000-0000-000000000001';
  v_opa      uuid := 'c1000000-0000-0000-0000-000000000002';
  v_opb      uuid := 'c1000000-0000-0000-0000-000000000003';
  v_cc       uuid := 'c1000000-0000-0000-0000-000000000004';
  v_unassigned uuid := 'c1000000-0000-0000-0000-000000000005';
  v_branch1  uuid := 'b0000000-0000-0000-0000-000000000001';
  v_branch2  uuid := 'b0000000-0000-0000-0000-000000000002';
begin
  insert into auth.users(id)
  values (v_admin),(v_opa),(v_opb),(v_cc),(v_unassigned)
  on conflict (id) do nothing;

  insert into public.profiles(id, full_name, role)
  values
    (v_admin,      'Ops Admin',         'admin'),
    (v_opa,        'Branch Operator A', 'branch_staff'),
    (v_opb,        'Branch Operator B', 'branch_staff'),
    (v_cc,         'Call Centre',       'call_center'),
    (v_unassigned, 'Unassigned Op',     'branch_staff')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

  -- v_unassigned deliberately gets NO assignment row.
  insert into public.staff_branch_assignments(user_id, branch_id)
  values (v_opa, v_branch1), (v_opb, v_branch2)
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The MFA carve-out is exactly where we intended it, and nowhere else.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin_def  text := pg_get_functiondef('public.is_admin()'::regprocedure);
  v_staff_def  text := pg_get_functiondef('public.is_staff()'::regprocedure);
  v_branch_def text := pg_get_functiondef('public.is_branch_operator(uuid)'::regprocedure);
  v_cc_def     text := pg_get_functiondef('public.is_call_center()'::regprocedure);
begin
  -- Existing controls must NOT have been weakened by this work.
  if position('jwt_has_aal2' in v_admin_def) = 0 then
    raise exception 'REGRESSION: is_admin() no longer requires aal2';
  end if;
  if position('jwt_has_aal2' in v_staff_def) = 0 then
    raise exception 'REGRESSION: is_staff() no longer requires aal2';
  end if;
  -- The new predicates are the deliberate carve-out (owner decision 2026-08-20).
  if position('jwt_has_aal2' in v_branch_def) <> 0 then
    raise exception 'CARVE-OUT FAILED: is_branch_operator unexpectedly requires aal2';
  end if;
  if position('jwt_has_aal2' in v_cc_def) <> 0 then
    raise exception 'CARVE-OUT FAILED: is_call_center unexpectedly requires aal2';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Fail-closed: a branch_staff profile with no assignment gets nothing.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000005',true);
do $$
begin
  if public.current_app_role() <> 'branch_staff' then
    raise exception 'FIXTURE FAILED: impersonation did not resolve branch_staff (got %)',
      public.current_app_role();
  end if;
  if public.current_staff_branch_id() is not null then
    raise exception 'SCOPE FAILED: unassigned operator resolved a branch';
  end if;
  if public.is_branch_operator('b0000000-0000-0000-0000-000000000001')
     or public.is_branch_operator('b0000000-0000-0000-0000-000000000002') then
    raise exception 'SCOPE FAILED: unassigned operator authorized for a branch';
  end if;
  if public.is_ops_operator('b0000000-0000-0000-0000-000000000001') then
    raise exception 'SCOPE FAILED: unassigned operator is an ops operator';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Branch scoping: operator A reaches branch 1 and ONLY branch 1.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000002',true);
do $$
begin
  if public.current_staff_branch_id() <> 'b0000000-0000-0000-0000-000000000001' then
    raise exception 'SCOPE FAILED: operator A pinned to the wrong branch';
  end if;
  if not public.is_branch_operator('b0000000-0000-0000-0000-000000000001') then
    raise exception 'SCOPE FAILED: operator A denied their own branch';
  end if;
  if public.is_branch_operator('b0000000-0000-0000-0000-000000000002') then
    raise exception 'SCOPE FAILED: operator A authorized for another branch';
  end if;
  if public.is_branch_operator(null) then
    raise exception 'SCOPE FAILED: null branch authorized';
  end if;
  if not public.is_ops_operator('b0000000-0000-0000-0000-000000000001')
     or public.is_ops_operator('b0000000-0000-0000-0000-000000000002') then
    raise exception 'SCOPE FAILED: is_ops_operator does not track branch scope';
  end if;
  -- A new role must inherit NO existing staff privilege.
  if public.is_admin() or public.is_staff() or public.is_call_center() then
    raise exception 'PRIVILEGE FAILED: branch operator gained admin/staff/call-centre rights';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Branch operators cannot write the catalog (RLS is the boundary).
-- ---------------------------------------------------------------------------
set local role authenticated;
do $$
declare v_rows integer;
begin
  update public.products set price = price where true;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS FAILED: branch operator updated % catalog rows', v_rows;
  end if;

  begin
    insert into public.categories(name_en, name_ar) values ('X','س');
    raise exception 'RLS FAILED: branch operator inserted a category';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Operators see their own assignment row and nobody else's.
do $$
declare v_rows integer;
begin
  select count(*) into v_rows from public.staff_branch_assignments;
  if v_rows <> 1 then
    raise exception 'RLS FAILED: operator saw % assignment rows, expected exactly 1', v_rows;
  end if;
  if (select branch_id from public.staff_branch_assignments)
     <> 'b0000000-0000-0000-0000-000000000001' then
    raise exception 'RLS FAILED: operator saw the wrong assignment row';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Call centre: cross-branch ops authority, no branch pin, no staff rights.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000004',true);
do $$
begin
  if not public.is_call_center() then
    raise exception 'ROLE FAILED: call centre not recognized';
  end if;
  if public.current_staff_branch_id() is not null then
    raise exception 'SCOPE FAILED: call centre has a pinned branch';
  end if;
  if public.is_branch_operator('b0000000-0000-0000-0000-000000000001') then
    raise exception 'SCOPE FAILED: call centre reported as a branch operator';
  end if;
  -- Call centre is an ops operator for EVERY branch — that is the whole point.
  if not public.is_ops_operator('b0000000-0000-0000-0000-000000000001')
     or not public.is_ops_operator('b0000000-0000-0000-0000-000000000002') then
    raise exception 'SCOPE FAILED: call centre denied cross-branch ops authority';
  end if;
  if public.is_admin() or public.is_staff() then
    raise exception 'PRIVILEGE FAILED: call centre gained admin/staff rights';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Assignments have no client write path at all.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated','public.staff_branch_assignments','INSERT')
     or has_table_privilege('authenticated','public.staff_branch_assignments','UPDATE')
     or has_table_privilege('authenticated','public.staff_branch_assignments','DELETE') then
    raise exception 'PRIVILEGE FAILED: authenticated can write staff_branch_assignments';
  end if;
  if has_table_privilege('anon','public.staff_branch_assignments','SELECT') then
    raise exception 'PRIVILEGE FAILED: anon can read staff_branch_assignments';
  end if;
  if has_function_privilege('anon','public.is_ops_operator(uuid)','EXECUTE')
     or has_function_privilege('anon','public.is_branch_operator(uuid)','EXECUTE')
     or has_function_privilege('anon','public.is_call_center()','EXECUTE')
     or has_function_privilege('anon','public.current_staff_branch_id()','EXECUTE') then
    raise exception 'PRIVILEGE FAILED: an ops predicate is anon-executable';
  end if;
end $$;

-- One branch per operator is enforced by the primary key, not by convention.
do $$
begin
  begin
    insert into public.staff_branch_assignments(user_id, branch_id)
    values ('c1000000-0000-0000-0000-000000000002',
            'b0000000-0000-0000-0000-000000000002');
    raise exception 'UNIQUENESS FAILED: an operator was pinned to two branches';
  exception when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. admin_set_staff_branch / admin_clear_staff_branch.
-- ---------------------------------------------------------------------------
-- Non-admin callers are rejected before anything else happens.
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000002',true);
do $$
begin
  begin
    perform public.admin_set_staff_branch(
      'c1000000-0000-0000-0000-000000000005',
      'b0000000-0000-0000-0000-000000000001');
    raise exception 'AUTH FAILED: branch operator assigned a branch';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.admin_clear_staff_branch('c1000000-0000-0000-0000-000000000002');
    raise exception 'AUTH FAILED: branch operator cleared an assignment';
  exception when sqlstate '42501' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);
do $$
declare v jsonb;
begin
  if not public.is_admin() then
    raise exception 'FIXTURE FAILED: admin impersonation did not resolve admin';
  end if;

  -- Assigning a role that has no use for a branch is refused, not silently kept.
  begin
    perform public.admin_set_staff_branch(
      'c1000000-0000-0000-0000-000000000004',
      'b0000000-0000-0000-0000-000000000001');
    raise exception 'GUARD FAILED: call centre account was pinned to a branch';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.admin_set_staff_branch(
      'c1000000-0000-0000-0000-000000000005',
      'b0000000-0000-0000-0000-0000000000ff');
    raise exception 'GUARD FAILED: unknown branch accepted';
  exception when sqlstate 'P0002' then null;
  end;

  v := public.admin_set_staff_branch(
    'c1000000-0000-0000-0000-000000000005',
    'b0000000-0000-0000-0000-000000000002');
  if (v->>'branch_id') <> 'b0000000-0000-0000-0000-000000000002' then
    raise exception 'ASSIGN FAILED: unexpected result %', v;
  end if;

  -- Re-assigning moves the operator rather than erroring on the primary key.
  v := public.admin_set_staff_branch(
    'c1000000-0000-0000-0000-000000000005',
    'b0000000-0000-0000-0000-000000000001');
  if (select branch_id from public.staff_branch_assignments
       where user_id = 'c1000000-0000-0000-0000-000000000005')
     <> 'b0000000-0000-0000-0000-000000000001' then
    raise exception 'REASSIGN FAILED: operator not moved';
  end if;

  perform public.admin_clear_staff_branch('c1000000-0000-0000-0000-000000000005');
  if exists (select 1 from public.staff_branch_assignments
              where user_id = 'c1000000-0000-0000-0000-000000000005') then
    raise exception 'CLEAR FAILED: assignment survived';
  end if;
end $$;

rollback;
