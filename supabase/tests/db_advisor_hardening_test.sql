-- ============================================================================
-- Database advisor hardening (migration 20260929120000).
--
-- WHAT THIS PINS, and why each one is worth a test rather than a comment.
--
--   * A CLOSURE STILL NOTIFIES AFTER THE TRIGGER FUNCTIONS LOSE THEIR CLIENT
--     GRANTS. This is the assertion that matters. If firing a trigger checked
--     the writer's EXECUTE privilege, every branch closure would fail — and it
--     would fail before the trigger body runs, outside the `exception when
--     others` that stops a notification from blocking a closure. CASES 3 and 4
--     fire both triggers from a session role that holds NO execute on them,
--     and CASE 5 proves the probe can tell "fired" from "did not fire".
--
--   * NO CLIENT ROLE HOLDS TRUNCATE, TRIGGER OR REFERENCES ON ANY PUBLIC TABLE.
--     Checked across the whole schema on the full chain (CASE 6), because the
--     default ACL grants ALL on every new table: a future table created
--     without an explicit revoke fails here rather than shipping. TRUNCATE is
--     not subject to row-level security, so its grant is the only barrier.
--
--   * WHAT HAD TO STAY HAS STAYED. authenticated keeps INSERT/UPDATE/DELETE on
--     the eleven tables (the console's menu editor) and anon keeps SELECT (the
--     menu) — CASE 7. Revoking too much is the failure the narrow revoke exists
--     to avoid.
--
--   * push_devices_select_own NAMES ITS ROLE and still does its job: a
--     customer reads their own device, not another customer's, and a signed-out
--     caller reads nothing without an error (CASE 8).
--
-- The duration helpers' OUTPUT is pinned by admin_push_closure_notifications
-- CASE 6, which runs on this same chain after this migration; CASE 1 here pins
-- only the search_path the migration adds.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

create temporary table t_dah (
  branch_id  uuid,
  product_id uuid,
  user_a     uuid,
  user_b     uuid
) on commit drop;

do $$
declare
  v_branch  uuid := 'b0000000-0000-0000-0000-000000000001';  -- seeded branch
  v_cat     uuid;
  v_product uuid := gen_random_uuid();
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.branches where id = v_branch) then
    raise exception 'FIXTURE FAILED: the seeded branch is missing';
  end if;
  select id into v_cat from public.categories order by sort_order limit 1;
  if v_cat is null then
    raise exception 'FIXTURE FAILED: no seeded category';
  end if;

  insert into public.products (id, category_id, name_en, name_ar, price, is_active)
  values (v_product, v_cat, 'Probe Wrap', 'راب تجربة', 19.00, true);

  -- The auth.users insert seeds each profile through its trigger.
  insert into auth.users (id, email) values (v_a, 'dah-a@example.com'), (v_b, 'dah-b@example.com');
  insert into public.push_devices (customer_id, expo_push_token, platform)
  values (v_a, 'ExponentPushToken[dah-a]', 'android'),
         (v_b, 'ExponentPushToken[dah-b]', 'ios');

  update public.app_settings set admin_push_enabled = true where id;

  insert into t_dah values (v_branch, v_product, v_a, v_b);
end $$;

-- Both event tables are closed to client roles (insert happens only inside
-- SECURITY DEFINER RPCs). To fire a trigger from a role that holds no EXECUTE
-- on it, give authenticated a narrow, temporary way to write a row. All of
-- this is rolled back with the transaction.
grant insert on public.branch_availability_events to authenticated;
grant insert on public.branch_delivery_events     to authenticated;
create policy dah_probe_insert on public.branch_availability_events
  for insert to authenticated with check (true);
create policy dah_probe_insert on public.branch_delivery_events
  for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- CASE 1 — both duration helpers pin search_path
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('admin_push_duration_ar', 'admin_push_duration_en')
     and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public');
  if v_n <> 2 then
    raise exception 'CASE 1 FAILED: expected 2 duration helpers pinned to search_path=public, found %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — no client role, and not PUBLIC, can execute either trigger function
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_n  integer;
begin
  foreach v_fn in array array['public.admin_push_enqueue_availability()',
                              'public.admin_push_enqueue_delivery()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'CASE 2 FAILED: anon can execute %', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'CASE 2 FAILED: authenticated can execute %', v_fn;
    end if;
    select count(*) into v_n
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE';
    if v_n <> 0 then
      raise exception 'CASE 2 FAILED: PUBLIC can execute %', v_fn;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — an item closure written by a role WITHOUT execute still queues
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx t_dah%rowtype;
  v_n  integer;
begin
  select * into v_fx from t_dah;
  if has_function_privilege('authenticated', 'public.admin_push_enqueue_availability()', 'EXECUTE') then
    raise exception 'CASE 3 PRECONDITION FAILED: authenticated still holds EXECUTE, so this would prove nothing';
  end if;

  set local role authenticated;
  -- No RETURNING: that would also need the row to pass a SELECT policy, which
  -- is not what this case is about.
  insert into public.branch_availability_events
    (branch_id, product_id, action, duration_minutes, reason_note, source)
  values (v_fx.branch_id, v_fx.product_id, 'closed', 25, 'dah-probe-availability', 'manual');
  reset role;

  select count(*) into v_n
    from public.admin_push_outbox o
    join public.branch_availability_events e
      on e.id = o.source_id and o.source_table = 'branch_availability_events'
   where e.reason_note = 'dah-probe-availability';
  if v_n <> 1 then
    raise exception 'CASE 3 FAILED: a closure by a role without EXECUTE queued % notice(s), expected 1', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — the same for a branch delivery pause
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx t_dah%rowtype;
  v_n  integer;
begin
  select * into v_fx from t_dah;
  if has_function_privilege('authenticated', 'public.admin_push_enqueue_delivery()', 'EXECUTE') then
    raise exception 'CASE 4 PRECONDITION FAILED: authenticated still holds EXECUTE, so this would prove nothing';
  end if;

  set local role authenticated;
  insert into public.branch_delivery_events
    (branch_id, action, duration_minutes, reason_note, source)
  values (v_fx.branch_id, 'delivery_paused', 40, 'dah-probe-delivery', 'manual');
  reset role;

  select count(*) into v_n
    from public.admin_push_outbox o
    join public.branch_delivery_events e
      on e.id = o.source_id and o.source_table = 'branch_delivery_events'
   where e.reason_note = 'dah-probe-delivery';
  if v_n <> 1 then
    raise exception 'CASE 4 FAILED: a pause by a role without EXECUTE queued % notice(s), expected 1', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — negative control: the probe CAN see a trigger that did not fire
--
-- Without this, CASES 3 and 4 could pass for a reason unrelated to the
-- trigger (say, a matching row queued by something else). With the trigger
-- disabled the same write must queue nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx t_dah%rowtype;
  v_n  integer;
begin
  select * into v_fx from t_dah;
  alter table public.branch_availability_events disable trigger admin_push_enqueue_availability;

  set local role authenticated;
  insert into public.branch_availability_events
    (branch_id, product_id, action, duration_minutes, reason_note, source)
  values (v_fx.branch_id, v_fx.product_id, 'closed', 25, 'dah-probe-control', 'manual');
  reset role;

  alter table public.branch_availability_events enable trigger admin_push_enqueue_availability;

  select count(*) into v_n
    from public.admin_push_outbox o
    join public.branch_availability_events e
      on e.id = o.source_id and o.source_table = 'branch_availability_events'
   where e.reason_note = 'dah-probe-control';
  if v_n <> 0 then
    raise exception 'CASE 5 FAILED: the probe found % notice(s) with the trigger disabled', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — no client role holds TRUNCATE, TRIGGER or REFERENCES anywhere in
-- public. Whole schema, so a future table that forgets its revoke fails here.
-- ---------------------------------------------------------------------------
do $$
declare v_list text;
begin
  select string_agg(distinct table_name || ' ' || grantee || ':' || privilege_type, ', ')
    into v_list
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  if v_list is not null then
    raise exception 'CASE 6 FAILED: client roles hold TRUNCATE/TRIGGER/REFERENCES: %', v_list;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — what had to stay has stayed
-- ---------------------------------------------------------------------------
do $$
declare
  v_t text;
  v_p text;
begin
  foreach v_t in array array[
    'branches', 'categories', 'products', 'product_variants', 'modifiers',
    'modifier_groups', 'product_modifier_groups', 'branch_product_availability',
    'branch_modifier_availability', 'notification_log', 'push_devices'
  ] loop
    foreach v_p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('authenticated', format('public.%I', v_t), v_p) then
        raise exception 'CASE 7 FAILED: authenticated lost % on public.%', v_p, v_t;
      end if;
    end loop;
    if not has_table_privilege('anon', format('public.%I', v_t), 'SELECT') then
      raise exception 'CASE 7 FAILED: anon lost SELECT on public.%', v_t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — push_devices_select_own: authenticated only, and still correct
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx    t_dah%rowtype;
  v_roles name[];
  v_n     integer;
  v_other integer;
begin
  select * into v_fx from t_dah;

  select roles into v_roles from pg_policies
   where schemaname = 'public' and tablename = 'push_devices' and policyname = 'push_devices_select_own';
  if v_roles is distinct from array['authenticated']::name[] then
    raise exception 'CASE 8 FAILED: push_devices_select_own applies to %, expected {authenticated}', v_roles;
  end if;

  -- A customer sees exactly their own device.
  perform set_config('test.auth_uid', v_fx.user_a::text, true);
  set local role authenticated;
  select count(*), count(*) filter (where customer_id <> v_fx.user_a)
    into v_n, v_other
    from public.push_devices;
  reset role;
  perform set_config('test.auth_uid', '', true);
  if v_n <> 1 or v_other <> 0 then
    raise exception 'CASE 8 FAILED: customer A sees % device(s), % of them not theirs', v_n, v_other;
  end if;

  -- A signed-out caller still holds SELECT (unchanged), matches no policy,
  -- and so reads nothing — without an error.
  set local role anon;
  select count(*) into v_n from public.push_devices;
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 8 FAILED: anon reads % push device(s)', v_n;
  end if;
end $$;

rollback;
