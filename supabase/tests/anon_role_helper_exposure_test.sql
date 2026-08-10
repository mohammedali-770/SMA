-- ============================================================================
-- Anonymous role-helper exposure regression coverage.
-- ============================================================================
begin;

insert into public.branches (id, name_en, name_ar, is_active)
values
  ('b3000000-0000-0000-0000-000000000001', 'Public Active Branch', 'فرع نشط', true),
  ('b3000000-0000-0000-0000-000000000002', 'Staff Inactive Branch', 'فرع غير نشط', false)
on conflict (id) do update set is_active=excluded.is_active;

-- Direct role-helper RPC exposure is gone for anonymous callers. The raw role
-- lookup is internal even for authenticated callers; authenticated RLS still
-- needs execute on is_admin/is_staff.
do $$
begin
  if has_function_privilege('anon', 'public.current_app_role()', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_staff()', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: anonymous role helper remains executable';
  end if;
  if has_function_privilege('authenticated', 'public.current_app_role()', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: current_app_role remains a client RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_staff()', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: authenticated RLS helper execute missing';
  end if;
end $$;

-- Structural proof: every public catalog table has an anon/authenticated active
-- policy plus a separate authenticated-only staff policy. None of the anon-role
-- policies contains is_staff/is_admin.
do $$
declare
  v_table text;
  v_bad integer;
begin
  foreach v_table in array array['branches','categories','products','modifiers','branch_delivery_zones'] loop
    select count(*) into v_bad
      from pg_policies
     where schemaname='public' and tablename=v_table
       and 'anon'=any(roles)
       and (coalesce(qual,'') ilike '%is_staff%' or coalesce(qual,'') ilike '%is_admin%');
    if v_bad <> 0 then
      raise exception 'POLICY FAILED: % still invokes staff/admin helper for anon', v_table;
    end if;

    select count(*) into v_bad
      from pg_policies
     where schemaname='public' and tablename=v_table
       and policyname like '%inactive_staff%'
       and not ('authenticated'=any(roles) and not ('anon'=any(roles)));
    if v_bad <> 0 then
      raise exception 'POLICY FAILED: % inactive staff policy has wrong roles', v_table;
    end if;
  end loop;
end $$;

-- Runtime proof: anon public catalog read still works for active rows and does
-- not expose inactive rows even though anon can no longer execute is_staff().
set local role anon;
do $$
begin
  if (select count(*) from public.branches where id='b3000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'ANON READ FAILED: active branch not visible';
  end if;
  if (select count(*) from public.branches where id='b3000000-0000-0000-0000-000000000002') <> 0 then
    raise exception 'ANON READ FAILED: inactive branch visible';
  end if;
end $$;
reset role;

-- Authenticated customer gets the same public view.
select set_config('test.auth_uid','b3000000-0000-0000-0000-000000000099',true);
select set_config('test.is_admin','false',true);
select set_config('test.is_staff','false',true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.branches where id in ('b3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000002')) <> 1 then
    raise exception 'CUSTOMER READ FAILED: expected active branch only';
  end if;
end $$;
reset role;

-- Staff impersonation in SQL CI is MFA-complete via the harness and can see the
-- inactive operational row through the authenticated-only staff policy.
select set_config('test.is_staff','true',true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.branches where id in ('b3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000002')) <> 2 then
    raise exception 'STAFF READ FAILED: inactive branch not visible to staff';
  end if;
end $$;
reset role;

rollback;
