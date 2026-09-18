-- ============================================================================
-- Admin web-push subscriptions (migration 20260927120000).
--
-- WHAT THIS PINS, and why each one is worth a test rather than a comment.
--
--   * THE TABLE IS CLOSED. RLS on, zero policies, and no grant to either client
--     role. A subscription's endpoint + p256dh + auth together are a capability
--     to push to that device; a policy added later "for convenience" would hand
--     every signed-in customer a list of the admin's devices.
--
--   * EVERY RPC GATES ON is_admin(). Role alone is not enough anywhere on an
--     admin surface, and a body that silently dropped the check would still
--     apply cleanly — so the refusal is asserted by CALLING each one as a
--     customer and reading the SQLSTATE back as a value.
--
--   * THE UPSERT REASSIGNS THE ENDPOINT. Two admins sharing a device must not
--     leave the first one receiving the second one's notifications. This is the
--     property most likely to be broken by a later "simplification" of the
--     conflict clause.
--
--   * THE TWO PUSH CHANNELS STAY APART. Nothing here may reference push_devices.
--     That separation is the reason a bug in this feature cannot put a branch
--     closure on a real customer's lock screen.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- Run a statement under a role + identity and report the SQLSTATE; null on
-- success. Same shape as the helper in admin_ranged_orders_and_stats_test.sql.
create or replace function pg_temp.err_as(
  p_role text, p_uid uuid, p_admin text, p_sql text
) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('test.auth_uid', coalesce(p_uid::text, ''), true);
  perform set_config('test.is_admin', coalesce(p_admin, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  return v_state;
end $$;

create temporary table t_ctx (admin_a uuid, admin_b uuid, cust uuid) on commit drop;

-- profiles.id references auth.users, and handle_new_user() creates the profile
-- row from the auth insert — so the identities start there and the role is set
-- afterwards, the same way comp_members_test.sql does it.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (v_a, 'push-admin-a@test'), (v_b, 'push-admin-b@test'), (v_c, 'push-cust@test');

  update public.profiles set role = 'admin', full_name = 'Admin A' where id = v_a;
  update public.profiles set role = 'admin', full_name = 'Admin B' where id = v_b;
  update public.profiles set role = 'customer', full_name = 'Customer' where id = v_c;

  if (select count(*) from public.profiles where id in (v_a, v_b, v_c)) <> 3 then
    raise exception 'FIXTURE FAILED: handle_new_user did not create all three profiles';
  end if;

  insert into t_ctx values (v_a, v_b, v_c);
end $$;

-- ---------------------------------------------------------------------------
-- CASE 1 — the table is closed to both client roles
-- ---------------------------------------------------------------------------
do $$
declare v_n integer; v_rls boolean;
begin
  select relrowsecurity into v_rls
    from pg_class where oid = 'public.admin_push_subscriptions'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'CASE 1 FAILED: RLS is not enabled';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'admin_push_subscriptions';
  if v_n <> 0 then
    raise exception 'CASE 1 FAILED: expected zero policies, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'admin_push_subscriptions'
     and grantee in ('anon', 'authenticated');
  if v_n <> 0 then
    raise exception 'CASE 1 FAILED: client roles hold % privilege(s)', v_n;
  end if;
end $$;

-- A direct read as authenticated must fail on privilege, not merely return zero
-- rows — "no rows" would also be the answer if the table were readable and
-- empty, which is not the property being pinned.
do $$
declare v_state text; v_cust uuid;
begin
  select cust into v_cust from t_ctx;
  v_state := pg_temp.err_as('authenticated', v_cust, 'false',
    'select 1 from public.admin_push_subscriptions');
  if v_state is distinct from '42501' then
    raise exception 'CASE 1 FAILED: authenticated select gave %, expected 42501',
      coalesce(v_state, 'SUCCESS');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — anon cannot execute any of the three RPCs
-- ---------------------------------------------------------------------------
do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'save_admin_push_subscription(text,text,text,text,text)',
    'delete_admin_push_subscription(text)',
    'admin_push_state(text)'
  ] loop
    if has_function_privilege('anon', 'public.' || v_sig, 'EXECUTE') then
      raise exception 'CASE 2 FAILED: anon can execute %', v_sig;
    end if;
    if not has_function_privilege('authenticated', 'public.' || v_sig, 'EXECUTE') then
      raise exception 'CASE 2 FAILED: authenticated cannot execute %', v_sig;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — a non-admin is refused by every RPC, with the outcome read as a value
-- ---------------------------------------------------------------------------
do $$
declare v_state text; v_cust uuid;
begin
  select cust into v_cust from t_ctx;

  v_state := pg_temp.err_as('authenticated', v_cust, 'false',
    $q$select public.save_admin_push_subscription('https://push.example/x','P','A','ar',null)$q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 3 FAILED: save as customer gave %, expected 42501',
      coalesce(v_state, 'SUCCESS');
  end if;

  v_state := pg_temp.err_as('authenticated', v_cust, 'false',
    $q$select public.delete_admin_push_subscription('https://push.example/x')$q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 3 FAILED: delete as customer gave %, expected 42501',
      coalesce(v_state, 'SUCCESS');
  end if;

  v_state := pg_temp.err_as('authenticated', v_cust, 'false',
    $q$select public.admin_push_state('https://push.example/x')$q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 3 FAILED: state as customer gave %, expected 42501',
      coalesce(v_state, 'SUCCESS');
  end if;

  -- And nothing was written by any of the refusals.
  if (select count(*) from public.admin_push_subscriptions) <> 0 then
    raise exception 'CASE 3 FAILED: a refused call still wrote a row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — an admin can subscribe, and the row records THEM
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_owner uuid; v_lang text;
begin
  select admin_a into v_a from t_ctx;
  perform set_config('test.auth_uid', v_a::text, true);
  perform set_config('test.is_admin', 'true', true);

  perform public.save_admin_push_subscription('https://push.example/dev1', 'P1', 'A1', 'ar', 'iPhone');

  select admin_id, lang into v_owner, v_lang
    from public.admin_push_subscriptions where endpoint = 'https://push.example/dev1';
  if v_owner is distinct from v_a then
    raise exception 'CASE 4 FAILED: row owner is %, expected %', v_owner, v_a;
  end if;
  if v_lang <> 'ar' then
    raise exception 'CASE 4 FAILED: lang is %, expected ar', v_lang;
  end if;
end $$;

-- An unknown language falls back to Arabic rather than violating the CHECK and
-- taking the whole subscribe call down.
do $$
declare v_a uuid; v_lang text;
begin
  select admin_a into v_a from t_ctx;
  perform set_config('test.auth_uid', v_a::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform public.save_admin_push_subscription('https://push.example/dev-lang', 'P', 'A', 'fr', null);
  select lang into v_lang from public.admin_push_subscriptions
   where endpoint = 'https://push.example/dev-lang';
  if v_lang <> 'ar' then
    raise exception 'FALLBACK FAILED: lang is %, expected ar', v_lang;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — re-subscribing the SAME endpoint reassigns it, and does not duplicate
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid; v_n integer; v_owner uuid;
begin
  select admin_a, admin_b into v_a, v_b from t_ctx;

  perform set_config('test.auth_uid', v_b::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform public.save_admin_push_subscription('https://push.example/dev1', 'P2', 'A2', 'en', 'iPhone');

  select count(*) into v_n from public.admin_push_subscriptions
   where endpoint = 'https://push.example/dev1';
  if v_n <> 1 then
    raise exception 'CASE 5 FAILED: endpoint duplicated into % rows', v_n;
  end if;

  select admin_id into v_owner from public.admin_push_subscriptions
   where endpoint = 'https://push.example/dev1';
  -- The device belongs to whoever most recently proved they hold it. Leaving it
  -- with admin A would keep pushing A's notifications to a phone B is now using.
  if v_owner is distinct from v_b then
    raise exception 'CASE 5 FAILED: endpoint still owned by %, expected %', v_owner, v_b;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — an admin deletes only their OWN device
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid; v_n integer;
begin
  select admin_a, admin_b into v_a, v_b from t_ctx;

  -- A now owns nothing on dev1 (case 5 moved it to B). A's delete must not touch it.
  perform set_config('test.auth_uid', v_a::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform public.delete_admin_push_subscription('https://push.example/dev1');

  select count(*) into v_n from public.admin_push_subscriptions
   where endpoint = 'https://push.example/dev1';
  if v_n <> 1 then
    raise exception 'CASE 6 FAILED: admin A deleted a device owned by admin B';
  end if;

  -- B deleting their own device does work.
  perform set_config('test.auth_uid', v_b::text, true);
  perform public.delete_admin_push_subscription('https://push.example/dev1');
  select count(*) into v_n from public.admin_push_subscriptions
   where endpoint = 'https://push.example/dev1';
  if v_n <> 0 then
    raise exception 'CASE 6 FAILED: admin B could not delete their own device';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — admin_push_state reports this device, not somebody else's
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid; v_state jsonb;
begin
  select admin_a, admin_b into v_a, v_b from t_ctx;

  perform set_config('test.auth_uid', v_a::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform public.save_admin_push_subscription('https://push.example/a-phone', 'P', 'A', 'ar', null);

  v_state := public.admin_push_state('https://push.example/a-phone');
  if (v_state->>'subscribed')::boolean is not true then
    raise exception 'CASE 7 FAILED: A''s own endpoint reported unsubscribed';
  end if;

  -- The same endpoint, read by a DIFFERENT admin, must not report subscribed:
  -- the answer is "is this device mine", not "does this device exist".
  perform set_config('test.auth_uid', v_b::text, true);
  v_state := public.admin_push_state('https://push.example/a-phone');
  if (v_state->>'subscribed')::boolean is not false then
    raise exception 'CASE 7 FAILED: admin B sees admin A''s device as their own';
  end if;

  -- A null endpoint is "I do not have one yet", never a match.
  perform set_config('test.auth_uid', v_a::text, true);
  v_state := public.admin_push_state(null);
  if (v_state->>'subscribed')::boolean is not false then
    raise exception 'CASE 7 FAILED: a null endpoint reported subscribed';
  end if;

  -- Unconfigured out of the box: the migration must not set a VAPID key.
  if (v_state->>'configured')::boolean is not false then
    raise exception 'CASE 7 FAILED: reports configured with no VAPID key set';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — the two push channels never meet
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_admin_push_subscription',
                       'delete_admin_push_subscription',
                       'admin_push_state')
     and p.prosrc like '%push_devices%';
  if v_n <> 0 then
    raise exception 'CASE 8 FAILED: % admin push RPC(s) reference push_devices', v_n;
  end if;

  -- And the customer channel gained nothing that mentions the admin table.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%admin_push_subscriptions%'
     and p.proname not in ('save_admin_push_subscription',
                           'delete_admin_push_subscription',
                           'admin_push_state');
  if v_n <> 0 then
    raise exception 'CASE 8 FAILED: % unrelated function(s) reference admin_push_subscriptions', v_n;
  end if;
end $$;

rollback;
