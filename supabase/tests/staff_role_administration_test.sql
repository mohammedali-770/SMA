-- ============================================================================
-- Staff role administration regression coverage.
-- ============================================================================
begin;

do $$
declare
  v_admin1 uuid := 'a1000000-0000-0000-0000-000000000001';
  v_admin2 uuid := 'a1000000-0000-0000-0000-000000000002';
  v_customer uuid := 'a1000000-0000-0000-0000-000000000003';
begin
  insert into auth.users(id) values (v_admin1),(v_admin2),(v_customer)
  on conflict (id) do nothing;

  insert into public.profiles(id, full_name, role)
  values
    (v_admin1, 'Role Admin One', 'admin'),
    (v_admin2, 'Role Admin Two', 'admin'),
    (v_customer, 'Role Customer', 'customer')
  on conflict (id) do update set role=excluded.role, full_name=excluded.full_name;
end $$;

-- Customer cannot grant themselves a role. The SQL CI harness makes
-- test.is_admin/test.is_staff authoritative whenever test.auth_uid is present.
select set_config('test.auth_uid','a1000000-0000-0000-0000-000000000003',true);
select set_config('test.is_admin','false',true);
select set_config('test.is_staff','false',true);
set local role authenticated;
do $$
begin
  begin
    perform public.admin_set_user_role(
      'a1000000-0000-0000-0000-000000000003', 'admin', 'self promotion');
    raise exception 'AUTH FAILED: customer self-promotion unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end $$;
reset role;

-- Admin promotes the customer to accountant and gets one audit row.
select set_config('test.auth_uid','a1000000-0000-0000-0000-000000000001',true);
select set_config('test.is_admin','true',true);
select set_config('test.is_staff','true',true);
set local role authenticated;
do $$
declare v jsonb; v_count integer;
begin
  v := public.admin_set_user_role(
    'a1000000-0000-0000-0000-000000000003', 'accountant', 'Finance reporting access');
  if (v->>'role') <> 'accountant' or coalesce((v->>'changed')::boolean,false) is not true then
    raise exception 'PROMOTE FAILED: unexpected result %', v;
  end if;
  if (select role from public.profiles where id='a1000000-0000-0000-0000-000000000003') <> 'accountant' then
    raise exception 'PROMOTE FAILED: profile role not changed';
  end if;
  select count(*) into v_count from public.role_change_audit
   where target_user_id='a1000000-0000-0000-0000-000000000003'
     and old_role='customer' and new_role='accountant'
     and changed_by='a1000000-0000-0000-0000-000000000001'
     and reason='Finance reporting access';
  if v_count <> 1 then raise exception 'AUDIT FAILED: expected one exact audit row, got %', v_count; end if;
end $$;

-- Same-role is idempotent: no extra audit noise.
do $$
declare v_before integer; v_after integer; v jsonb;
begin
  select count(*) into v_before from public.role_change_audit;
  v := public.admin_set_user_role(
    'a1000000-0000-0000-0000-000000000003', 'accountant', 'No-op confirmation');
  select count(*) into v_after from public.role_change_audit;
  if coalesce((v->>'changed')::boolean,true) is not false or v_after <> v_before then
    raise exception 'IDEMPOTENCY FAILED: result %, audit % -> %', v, v_before, v_after;
  end if;
end $$;

-- With two admins, demoting admin2 is allowed.
select public.admin_set_user_role(
  'a1000000-0000-0000-0000-000000000002', 'accountant', 'Remove administrator access');

-- The remaining/last admin cannot demote themselves.
do $$
begin
  begin
    perform public.admin_set_user_role(
      'a1000000-0000-0000-0000-000000000001', 'accountant', 'Would remove last admin');
    raise exception 'LAST ADMIN FAILED: final admin demotion unexpectedly succeeded';
  exception when sqlstate '23514' then null;
  end;
end $$;

-- Admin directory exposes only staff roles, not ordinary customers.
do $$
declare v jsonb;
begin
  v := public.admin_list_staff();
  if jsonb_array_length(v) <> 3 then
    raise exception 'STAFF LIST FAILED: expected 3 staff rows, got %', jsonb_array_length(v);
  end if;
  if exists (select 1 from jsonb_array_elements(v) e where e->>'role'='customer') then
    raise exception 'STAFF LIST FAILED: customer leaked into staff directory';
  end if;
end $$;
reset role;

-- Once not-admin, an accountant cannot read the role-change audit through RLS.
select set_config('test.auth_uid','a1000000-0000-0000-0000-000000000002',true);
select set_config('test.is_admin','false',true);
select set_config('test.is_staff','true',true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.role_change_audit) <> 0 then
    raise exception 'RLS FAILED: accountant can read admin role audit';
  end if;
end $$;
reset role;

rollback;
