-- Spicy Meal — clear the database security advisor's actionable findings, and
-- finish the client-grant cleanup that 20260919120000 started.
--
-- Read live 2026-11-09 (Supabase security advisor):
--   0011 function_search_path_mutable                      2
--   0028 anon_security_definer_function_executable          3
--   0029 authenticated_security_definer_function_executable 87
-- plus a grant read: anon and authenticated still held TRUNCATE, TRIGGER and
-- REFERENCES on eleven tables. Expected after apply: 0011 2 -> 0, 0028 3 -> 1,
-- 0029 87 -> 85. This file changes exactly what is listed below.
--
-- WHAT CHANGES
--
-- 1. admin_push_duration_ar / admin_push_duration_en pin search_path (0011 x2).
--    Both are `language sql`, IMMUTABLE and NOT security definer, and client
--    EXECUTE was already revoked, so this is hygiene rather than a hole. ALTER,
--    not CREATE OR REPLACE, so neither body is touched — the same form as
--    20260919120000 section 4.
--
-- 2. The two closure-notification TRIGGER functions lose their client EXECUTE
--    grants (the two 0028 findings and two of the 0029 ones). Live, PUBLIC,
--    anon and authenticated EACH held EXECUTE. `revoke ... from public` alone
--    would leave the last two, because this project's pg_default_acl grants
--    them directly (CLAUDE.md §8, ledger row 101), so all three are named.
--    PostgREST cannot invoke a trigger-returning function, so this was not
--    exploitable; it is the 20260714130000 pattern.
--
--    THE ONE RISK, AND WHY IT DOES NOT APPLY. If firing a trigger checked the
--    EXECUTE privilege of the role doing the write, every branch closure would
--    now fail — and it would fail BEFORE the trigger body runs, outside the
--    `exception when others` that keeps a notification from blocking a
--    closure, so that guard would not save it. PostgreSQL checks EXECUTE on a
--    trigger function at CREATE TRIGGER, never when the trigger fires. That is
--    proven rather than assumed: db_advisor_hardening_test.sql fires both
--    triggers from a session role that holds no EXECUTE on them, and asserts
--    the notice is queued.
--
-- 3. anon and authenticated lose TRUNCATE, TRIGGER and REFERENCES on the eleven
--    tables that still carried them — the same eleven whose anon writes
--    20260919120000 removed. TRUNCATE is the one that matters: Postgres does not
--    apply row-level security to it, so the grant was the only barrier. No
--    client path issues TRUNCATE or DDL (PostgREST exposes neither), so nothing
--    loses a capability it uses.
--
--    DELIBERATELY NOT "revoke all, then re-grant SELECT". `authenticated` holds
--    INSERT, UPDATE and DELETE on these tables, and the staff console's menu
--    editor uses them under `is_admin()` RLS; revoke-all would have taken them.
--    Only the three named privileges move, and the block below asserts that
--    both what had to go has gone AND what had to stay has stayed.
--
-- 4. push_devices_select_own applies to `authenticated` instead of PUBLIC. A
--    signed-out caller's auth.uid() is null, so the policy matched no row for
--    anon anyway; this makes it say who it is for. Push targeting and dispatch
--    are untouched — push-dispatch reads with the service role (CLAUDE.md §7).
--
-- WHAT DOES NOT CHANGE, by design
--   * whatsapp_login_enabled() stays executable by anon: the login screen asks
--     it before anybody is signed in. It is the third 0028 finding.
--   * The other 85 entries under 0029 are RPCs gated on is_admin(), on a staff
--     predicate, or on the caller's own rows.
--   * The 17 entries under 0008 (RLS on, no policy) are deliberately closed.
--   * anon keeps SELECT on all eleven tables. The menu needs it; whether to
--     drop it on push_devices and notification_log is a separate decision.
--   * MONEY PATH UNTOUCHED: place_order and compute_order_snapshot are not
--     redefined, and must still hash 12b6816d256c29b76edf947ae1a7ea77 /
--     22e2d42935459e7bf93abb2941b56325 — asserted below.
--
-- NO DEPLOY IMPLIED. Applying it is a §5 action, named by version.

-- ---------------------------------------------------------------------------
-- 1. search_path on the two duration helpers
-- ---------------------------------------------------------------------------
alter function public.admin_push_duration_ar(integer) set search_path = public;
alter function public.admin_push_duration_en(integer) set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. client EXECUTE on the two enqueue trigger functions
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_push_enqueue_availability() from public, anon, authenticated;
revoke execute on function public.admin_push_enqueue_delivery()     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. TRUNCATE / TRIGGER / REFERENCES on the eleven tables
-- ---------------------------------------------------------------------------
revoke truncate, trigger, references on table public.branches                     from anon, authenticated;
revoke truncate, trigger, references on table public.categories                   from anon, authenticated;
revoke truncate, trigger, references on table public.products                     from anon, authenticated;
revoke truncate, trigger, references on table public.product_variants             from anon, authenticated;
revoke truncate, trigger, references on table public.modifiers                    from anon, authenticated;
revoke truncate, trigger, references on table public.modifier_groups              from anon, authenticated;
revoke truncate, trigger, references on table public.product_modifier_groups      from anon, authenticated;
revoke truncate, trigger, references on table public.branch_product_availability  from anon, authenticated;
revoke truncate, trigger, references on table public.branch_modifier_availability from anon, authenticated;
revoke truncate, trigger, references on table public.notification_log             from anon, authenticated;
revoke truncate, trigger, references on table public.push_devices                 from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. push_devices_select_own names its role
-- ---------------------------------------------------------------------------
alter policy push_devices_select_own on public.push_devices to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-verification — outcomes, not statements. Each check names a way
--    this file could have gone wrong and is written to be able to fail.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_n      integer;
  v_txt    text;
  v_roles  name[];
  v_t      text;
  v_p      text;
  -- The eleven tables, as read live. Order is irrelevant.
  v_eleven constant text[] := array[
    'branches', 'categories', 'products', 'product_variants', 'modifiers',
    'modifier_groups', 'product_modifier_groups', 'branch_product_availability',
    'branch_modifier_availability', 'notification_log', 'push_devices'
  ];
begin
  -- (0) Cardinality first: every name below must resolve to exactly one
  --     function, or a later `select ... into` would read an arbitrary overload.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('admin_push_duration_ar', 'admin_push_duration_en',
                       'admin_push_enqueue_availability', 'admin_push_enqueue_delivery');
  if v_n <> 4 then
    raise exception 'expected exactly 4 functions (one overload each), found %', v_n;
  end if;

  -- (1) Both duration helpers pin search_path.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('admin_push_duration_ar', 'admin_push_duration_en')
     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  if v_n <> 2 then
    raise exception 'expected 2 duration helpers with a pinned search_path, found %', v_n;
  end if;

  -- (2) Neither client role can execute either trigger function, and PUBLIC
  --     holds no EXECUTE grant on them either (grantee 0 in the ACL). A NULL
  --     proacl means the DEFAULT acl, which grants PUBLIC execute — so it is
  --     expanded rather than read as "no grants", which would pass vacuously.
  foreach v_t in array array['public.admin_push_enqueue_availability()',
                             'public.admin_push_enqueue_delivery()'] loop
    if has_function_privilege('anon', v_t, 'EXECUTE') then
      raise exception 'anon can still execute %', v_t;
    end if;
    if has_function_privilege('authenticated', v_t, 'EXECUTE') then
      raise exception 'authenticated can still execute %', v_t;
    end if;
    select count(*) into v_n
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_t::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE';
    if v_n <> 0 then
      raise exception 'PUBLIC still holds EXECUTE on %', v_t;
    end if;
  end loop;

  -- (3) Both triggers are still wired to their function and still enabled.
  select count(*) into v_n
    from pg_trigger t
   where not t.tgisinternal
     and t.tgenabled = 'O'
     and (   (t.tgname = 'admin_push_enqueue_availability'
              and t.tgrelid = 'public.branch_availability_events'::regclass
              and t.tgfoid  = 'public.admin_push_enqueue_availability()'::regprocedure)
          or (t.tgname = 'admin_push_enqueue_delivery'
              and t.tgrelid = 'public.branch_delivery_events'::regclass
              and t.tgfoid  = 'public.admin_push_enqueue_delivery()'::regprocedure));
  if v_n <> 2 then
    raise exception 'expected both enqueue triggers wired and enabled, found %', v_n;
  end if;

  -- (4) No table or view in public grants TRUNCATE, TRIGGER or REFERENCES to
  --     a client role — checked across the whole schema, not only the eleven,
  --     so a table this file did not know about is reported rather than missed.
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  if v_n <> 0 then
    raise exception 'client roles still hold % TRUNCATE/TRIGGER/REFERENCES grant(s) in public', v_n;
  end if;

  -- (5) The other half: what had to STAY has stayed. authenticated keeps its
  --     DML (the console's menu editor), anon keeps SELECT (the menu).
  foreach v_t in array v_eleven loop
    foreach v_p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('authenticated', format('public.%I', v_t), v_p) then
        raise exception 'authenticated lost % on public.% — the console would break', v_p, v_t;
      end if;
    end loop;
    if not has_table_privilege('anon', format('public.%I', v_t), 'SELECT') then
      raise exception 'anon lost SELECT on public.% — this file must not change it', v_t;
    end if;
  end loop;

  -- (6) push_devices_select_own applies to authenticated only, and its
  --     predicate is the one it always had.
  select p.roles, p.qual into v_roles, v_txt
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = 'push_devices'
     and p.policyname = 'push_devices_select_own';
  if v_roles is distinct from array['authenticated']::name[] then
    raise exception 'push_devices_select_own applies to %, expected {authenticated}', v_roles;
  end if;
  if v_txt is null or v_txt not like '%auth.uid()%' or v_txt not like '%customer_id%' then
    raise exception 'push_devices_select_own predicate changed: %', coalesce(v_txt, 'NULL');
  end if;

  -- (7) Money path untouched. `is distinct from`, so a NULL fails rather than
  --     passing silently.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'db advisor hardening applied: search_path x2, trigger EXECUTE x2, TRUNCATE/TRIGGER/REFERENCES x11, push_devices policy role';
end
$verify$;
