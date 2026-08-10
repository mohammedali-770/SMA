-- ============================================================================
-- Security/performance hardening smoke tests.
-- ============================================================================
begin;

-- Trigger functions must not remain directly callable through the public API.
do $$
begin
  if has_function_privilege('anon', 'public.emit_order_change_event()', 'EXECUTE') then
    raise exception 'SECURITY FAILED: anon can execute trigger-only emitter';
  end if;
  if has_function_privilege('authenticated', 'public.emit_order_change_event()', 'EXECUTE') then
    raise exception 'SECURITY FAILED: authenticated can execute trigger-only emitter';
  end if;
  if not has_function_privilege('service_role', 'public.emit_order_change_event()', 'EXECUTE') then
    raise exception 'SECURITY FAILED: service_role diagnostic execute missing';
  end if;
end $$;

-- Highest-value FK indexes requested by the readiness audit must exist.
do $$
declare
  v_missing text[];
begin
  select array_agg(required.name order by required.name)
    into v_missing
  from (values
    ('orders_address_id_idx'),
    ('order_items_product_id_idx'),
    ('order_item_modifiers_modifier_id_idx'),
    ('order_change_events_order_id_idx'),
    ('account_deletion_resolution_audit_resolved_by_idx')
  ) as required(name)
  where to_regclass('public.' || required.name) is null;

  if v_missing is not null then
    raise exception 'INDEX FAILED: missing expected indexes %', v_missing;
  end if;
end $$;

-- RLS semantics are unchanged: a customer sees its own profile, another
-- customer's row is hidden, while staff still sees both. The throwaway SQL test
-- bootstrap makes auth.uid()/is_staff() honor test.* GUCs.
do $$
declare
  v_own uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
begin
  insert into auth.users(id) values (v_own), (v_other) on conflict do nothing;
  insert into public.profiles(id, full_name, role)
  values (v_own, 'RLS Own', 'customer'), (v_other, 'RLS Other', 'customer')
  on conflict (id) do update set full_name=excluded.full_name;

  perform set_config('test.auth_uid', v_own::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  perform set_config('test.rls_own', v_own::text, true);
  perform set_config('test.rls_other', v_other::text, true);
end $$;

set local role authenticated;
do $$
declare v_own uuid := current_setting('test.rls_own')::uuid;
begin
  if (select count(*) from public.profiles where id=v_own) <> 1 then
    raise exception 'RLS FAILED: customer cannot see own profile';
  end if;
  if (select count(*) from public.profiles where id=current_setting('test.rls_other')::uuid) <> 0 then
    raise exception 'RLS FAILED: customer can see another customer profile';
  end if;
end $$;
reset role;

select set_config('test.is_staff', 'true', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.profiles
      where id in (current_setting('test.rls_own')::uuid,
                   current_setting('test.rls_other')::uuid)) <> 2 then
    raise exception 'RLS FAILED: staff lost expected profile visibility';
  end if;
end $$;
reset role;

rollback;
