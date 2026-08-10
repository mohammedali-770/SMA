-- ============================================================================
-- Staff Access bounded read-contract regression coverage.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid := 'a2000000-0000-0000-0000-000000000001';
  v_customer1 uuid := 'a2000000-0000-0000-0000-000000000002';
  v_customer2 uuid := 'a2000000-0000-0000-0000-000000000003';
begin
  insert into auth.users(id) values (v_admin),(v_customer1),(v_customer2)
  on conflict (id) do nothing;

  insert into public.profiles(id, full_name, email, phone_number, role)
  values
    (v_admin, 'Staff Search Admin', 'search.admin@example.test', '+966500002001', 'admin'),
    (v_customer1, 'Candidate Fatimah', 'fatimah.candidate@example.test', '+966500002002', 'customer'),
    (v_customer2, 'Unrelated Person', 'unrelated@example.test', '+966500002003', 'customer')
  on conflict (id) do update set
    full_name=excluded.full_name, email=excluded.email,
    phone_number=excluded.phone_number, role=excluded.role;
end $$;

-- Plain customer is denied both admin reads.
select set_config('test.auth_uid','a2000000-0000-0000-0000-000000000002',true);
select set_config('test.is_admin','false',true);
select set_config('test.is_staff','false',true);
set local role authenticated;
do $$
begin
  begin
    perform public.admin_search_role_candidates('Fat',20);
    raise exception 'AUTH FAILED: customer candidate search unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.admin_list_role_change_audit(50);
    raise exception 'AUTH FAILED: customer audit read unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

-- Admin search is bounded and targeted.
select set_config('test.auth_uid','a2000000-0000-0000-0000-000000000001',true);
select set_config('test.is_admin','true',true);
select set_config('test.is_staff','true',true);
set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.admin_search_role_candidates('Fat',20);
  if jsonb_array_length(v) <> 1 then
    raise exception 'SEARCH FAILED: expected one Fatimah result, got %', v;
  end if;
  if v->0->>'id' <> 'a2000000-0000-0000-0000-000000000002'
     or v->0->>'role' <> 'customer' then
    raise exception 'SEARCH FAILED: wrong candidate projection %', v;
  end if;

  begin
    perform public.admin_search_role_candidates('F',20);
    raise exception 'SEARCH FAILED: one-character search unexpectedly succeeded';
  exception when sqlstate '22023' then null; end;
end $$;

-- Role mutation feeds the audit read contract.
select public.admin_set_user_role(
  'a2000000-0000-0000-0000-000000000002',
  'accountant',
  'Finance access for audit read test'
);

do $$
declare v jsonb; v_hit jsonb;
begin
  v := public.admin_list_role_change_audit(50);
  select value into v_hit
    from jsonb_array_elements(v)
   where value->>'target_user_id'='a2000000-0000-0000-0000-000000000002'
     and value->>'new_role'='accountant'
   limit 1;
  if v_hit is null then
    raise exception 'AUDIT READ FAILED: promoted target missing from %', v;
  end if;
  if v_hit->>'target_name' <> 'Candidate Fatimah'
     or v_hit->>'changed_by' <> 'a2000000-0000-0000-0000-000000000001'
     or v_hit->>'reason' <> 'Finance access for audit read test' then
    raise exception 'AUDIT READ FAILED: projection incorrect %', v_hit;
  end if;
end $$;

-- After target Auth erasure, the operational audit survives safely with null
-- target identity and no FK block.
delete from auth.users where id='a2000000-0000-0000-0000-000000000002';
do $$
declare v jsonb; v_hit jsonb;
begin
  v := public.admin_list_role_change_audit(50);
  select value into v_hit
    from jsonb_array_elements(v)
   where value->>'reason'='Finance access for audit read test'
   limit 1;
  if v_hit is null or v_hit->>'target_user_id' is not null
     or v_hit->>'target_name' is not null then
    raise exception 'ERASURE AUDIT FAILED: expected anonymized audit row, got %', v_hit;
  end if;
end $$;
reset role;

rollback;
