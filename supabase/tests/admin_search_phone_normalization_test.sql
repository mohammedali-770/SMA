-- ============================================================================
-- admin_search_role_candidates — find a customer by the number as typed
--
-- Covers 20260827090000_admin_search_phone_normalization.sql.
--
-- THE DEFECT THIS PINS. The search matched `phone_number ilike '%'||query||'%'`
-- against whatever string happened to be stored, and `profiles.phone_number` is
-- NOT stored in one shape: live Production held four `9665…` and one `+9665…`.
-- An admin typing the number the natural way, with the country code and a plus,
-- matched only the rows that happened to carry a plus. Worse, a customer who
-- EXISTS and a customer who does not both rendered as "No matching customers",
-- so the admin could not tell the two apart.
--
-- The same function backs the staff-role candidate picker, so this covers both.
-- ============================================================================
begin;

\set admin  '''00000000-0000-0000-0000-0000000cb001'''
\set plus   '''00000000-0000-0000-0000-0000000cb002'''
\set bare   '''00000000-0000-0000-0000-0000000cb003'''
\set nophone '''00000000-0000-0000-0000-0000000cb004'''

insert into auth.users (id, email) values
  (:admin,   'searchadmin@x'),
  (:plus,    'plus@x'),
  (:bare,    'bare@x'),
  (:nophone, 'nophone@x');

-- The two storage shapes that actually coexist in Production, side by side.
insert into public.profiles (id, role, full_name, phone_number) values
  (:admin,   'admin',    'Search Admin',  '+966500000101'),
  (:plus,    'customer', 'Plus Shape',    '+966555820667'),
  (:bare,    'customer', 'Bare Shape',    '966555820668'),
  (:nophone, 'customer', 'No Phone At All', null)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number;

select set_config('test.auth_uid', :admin, true);
select set_config('test.is_admin', 'true', true);

-- ============================================================================
-- 1. The gate is unchanged
-- ============================================================================
do $$
declare v_refused boolean := false;
begin
  perform set_config('test.is_admin', 'false', true);
  begin
    perform public.admin_search_role_candidates('anything');
  exception when sqlstate '42501' then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL 1: a non-admin could search';
  end if;
  perform set_config('test.is_admin', 'true', true);

  v_refused := false;
  begin
    perform public.admin_search_role_candidates('a');
  exception when sqlstate '22023' then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL 1: a one-character query was accepted';
  end if;

  raise notice 'case 1 ok — admin-only, and still two characters minimum';
end $$;

-- ============================================================================
-- 2. EVERY shape of a stored-with-plus number finds it
-- ============================================================================
do $$
declare v_shape text; v_hits integer;
begin
  foreach v_shape in array array[
    '+966555820667', '966555820667', '00966555820667', '0555820667', '555820667',
    '+966 55 582 0667', '055-582-0667'
  ] loop
    select count(*) into v_hits
      from jsonb_array_elements(public.admin_search_role_candidates(v_shape)) e
     where e ->> 'id' = '00000000-0000-0000-0000-0000000cb002';
    if v_hits <> 1 then
      raise exception 'FAIL 2: shape % did not find the stored-with-plus customer', v_shape;
    end if;
  end loop;
  raise notice 'case 2 ok — seven typed shapes all find a +9665… row';
end $$;

-- ============================================================================
-- 3. And of a stored-WITHOUT-plus number — the case that actually broke
-- ============================================================================
do $$
declare v_shape text; v_hits integer;
begin
  foreach v_shape in array array[
    '+966555820668', '966555820668', '00966555820668', '0555820668', '555820668'
  ] loop
    select count(*) into v_hits
      from jsonb_array_elements(public.admin_search_role_candidates(v_shape)) e
     where e ->> 'id' = '00000000-0000-0000-0000-0000000cb003';
    if v_hits <> 1 then
      raise exception 'FAIL 3: shape % did not find the stored-without-plus customer', v_shape;
    end if;
  end loop;
  raise notice 'case 3 ok — the +966… query now finds a 9665… row (the reported bug)';
end $$;

-- ============================================================================
-- 4. A complete number is EXACT: it must not drag in the neighbour
-- ============================================================================
-- ...667 and ...668 differ by one digit. A normalization that merely widened the
-- match would return both and hand the admin a coin flip on who eats free.
do $$
declare v_wrong integer;
begin
  select count(*) into v_wrong
    from jsonb_array_elements(public.admin_search_role_candidates('+966555820667')) e
   where e ->> 'id' = '00000000-0000-0000-0000-0000000cb003';
  if v_wrong <> 0 then
    raise exception 'FAIL 4: a complete number also matched a different customer';
  end if;
  raise notice 'case 4 ok — a whole number matches exactly one person';
end $$;

-- ============================================================================
-- 5. Partial numbers still work, and a name query is not a phone query
-- ============================================================================
do $$
declare v_hits integer; v_all integer;
begin
  -- A prefix typed with the trunk zero, which never matched before.
  select count(*) into v_hits
    from jsonb_array_elements(public.admin_search_role_candidates('05558')) e
   where e ->> 'id' in ('00000000-0000-0000-0000-0000000cb002',
                        '00000000-0000-0000-0000-0000000cb003');
  if v_hits <> 2 then
    raise exception 'FAIL 5: a partial prefix found % of 2 customers', v_hits;
  end if;

  -- Name search is untouched.
  select count(*) into v_hits
    from jsonb_array_elements(public.admin_search_role_candidates('Bare Shape')) e
   where e ->> 'id' = '00000000-0000-0000-0000-0000000cb003';
  if v_hits <> 1 then
    raise exception 'FAIL 5: name search stopped working';
  end if;

  -- A text query must NOT fall through to an empty digit fragment and return
  -- the whole table.
  select jsonb_array_length(public.admin_search_role_candidates('zzzznotacustomer')) into v_all;
  if v_all <> 0 then
    raise exception 'FAIL 5: a non-matching text query returned % rows', v_all;
  end if;

  raise notice 'case 5 ok — partials work, names work, and text does not match everyone';
end $$;

-- ============================================================================
-- 6. A customer with no phone at all is still findable by name
-- ============================================================================
do $$
declare v_hits integer;
begin
  select count(*) into v_hits
    from jsonb_array_elements(public.admin_search_role_candidates('No Phone')) e
   where e ->> 'id' = '00000000-0000-0000-0000-0000000cb004';
  if v_hits <> 1 then
    raise exception 'FAIL 6: a phoneless customer dropped out of the search';
  end if;
  raise notice 'case 6 ok — a phoneless customer is still reachable';
end $$;

do $$ begin raise notice 'admin_search_phone_normalization_test: all assertions passed'; end $$;

rollback;
