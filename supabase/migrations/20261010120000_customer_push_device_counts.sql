-- ============================================================================
-- CUSTOMER PUSH DEVICE COUNTS: the Push Tools numbers, without table access
--
-- WHAT WENT WRONG. Push Tools shows two numbers: active devices, and the
-- devices a broadcast would reach (active with offers on). The console counts
-- them with two `head` selects on `push_devices`, which only work because
-- `push_devices_admin_select` lets an administrator read every row of that
-- table. The console never downloads a row, but the policy lets any
-- administrator session read every customer's Expo push token. Until Expo's
-- Enhanced Security is on (docs/OWNER_ACTIONS.md §52), a token is a bearer
-- credential: whoever holds one can send that phone a notification that
-- appears as Spicy Meal.
--
-- WHAT THIS ADDS. `customer_push_device_counts()`, returning
-- `{active_devices, promo_opt_ins}`: the same two counts, with no row and no
-- token. It is the first of two steps. The console switches to it in a later
-- pull request, and a migration in that pull request then drops
-- `push_devices_admin_select`, so no client role can read a token at all.
--
-- THE NAME IS DELIBERATE. It counts the CUSTOMER Expo channel, so it must not
-- be called `admin_push_…`. The staff console's web-push feature owns that
-- prefix, and its own checks (20260928120000 and
-- admin_push_closure_notifications_test.sql case 13) fail if any function
-- named `%admin_push%` references `push_devices`, because the two channels
-- must never share a code path (CLAUDE.md §7). The first draft used that name
-- and the local suite chain caught it.
--
-- DEFINITIONS MATCH THE OLD ONES. active_devices = rows with is_active.
-- promo_opt_ins = rows with is_active and promos_enabled, which is the
-- broadcast audience `push-dispatch` selects. Nothing about who a broadcast
-- reaches changes (CLAUDE.md §7).
--
-- ACCESS IS NOT WIDENED. The gate is `is_admin()` (admin at AAL2), the
-- predicate `push_devices_admin_select` applies, so exactly the callers who can
-- count devices today can call it.
--
-- GRANTS. EXECUTE is revoked from `public` AND `anon` explicitly: this
-- project's `pg_default_acl` grants EXECUTE on new functions to `anon`
-- directly (CLAUDE.md §8, ledger row 101). Granted to `authenticated`.
--
-- NOTHING ELSE CHANGES. No table, policy or existing function is altered, no
-- row is written, and no deploy is implied. place_order and
-- compute_order_snapshot are asserted unchanged below.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved workflow (docs/MIGRATIONS.md), named by version.
-- ============================================================================

create or replace function public.customer_push_device_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active bigint;
  v_promos bigint;
begin
  if not public.is_admin() then
    raise exception 'Only admins may read push device counts' using errcode = '42501';
  end if;

  select count(*) filter (where d.is_active),
         count(*) filter (where d.is_active and d.promos_enabled)
    into v_active, v_promos
    from public.push_devices d;

  return jsonb_build_object('active_devices', v_active, 'promo_opt_ins', v_promos);
end $$;

revoke all on function public.customer_push_device_counts() from public, anon;
grant execute on function public.customer_push_device_counts() to authenticated;

comment on function public.customer_push_device_counts() is
  'Push Tools device counts (is_admin enforced internally): active devices and active devices with offers on. Returns no row and no token, so the console needs no read of push_devices (20261010120000).';

-- ---- Self-verification ---------------------------------------------------------
-- One transaction: if any check fails, the whole file rolls back.
do $verify$
declare
  v_n     integer;
  v_oid   oid;
  v_txt   text;
  v_state text;
begin
  -- Cardinality first: every check below reads one definition.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'customer_push_device_counts';
  if v_n <> 1 then
    raise exception 'customer_push_device_counts verification failed: expected 1 overload, found %', v_n;
  end if;

  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'customer_push_device_counts';

  if (select p.pronargs from pg_proc p where p.oid = v_oid) is distinct from 0::smallint then
    raise exception 'customer_push_device_counts verification failed: it takes arguments';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true then
    raise exception 'customer_push_device_counts verification failed: not SECURITY DEFINER';
  end if;
  if not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'customer_push_device_counts verification failed: search_path is not pinned to public';
  end if;

  -- The grant, both halves.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'customer_push_device_counts verification failed: anon can execute it, which must never be true';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'customer_push_device_counts verification failed: authenticated cannot execute it, so the console cannot';
  end if;

  -- The gate, as an OUTCOME, read back as a value.
  begin
    set local role authenticated;
    perform public.customer_push_device_counts();
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    reset role;
  end;
  if v_state is distinct from '42501' then
    raise exception 'customer_push_device_counts verification failed: a non-admin caller got %, expected 42501', coalesce(v_state, 'NULL');
  end if;

  -- The gate raises before the count runs, and a plpgsql body is not
  -- name-resolved at creation. Run the aggregate itself, read-only.
  perform count(*) filter (where d.is_active),
          count(*) filter (where d.is_active and d.promos_enabled)
     from public.push_devices d;

  -- The body returns counts, never a token.
  select p.prosrc into v_txt from pg_proc p where p.oid = v_oid;
  if v_txt ~ 'token' then
    raise exception 'customer_push_device_counts verification failed: the body names a token column';
  end if;

  -- The money path is untouched. One overload each first, then the hash.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'customer_push_device_counts verification failed: expected 1 place_order, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then
    raise exception 'customer_push_device_counts verification failed: expected 1 compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  -- The admin web-push separation still holds: this function is outside the
  -- `%admin_push%` namespace that may never reference push_devices.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '%admin_push%'
       and (p.prosrc like '%push_devices%' or p.prosrc like '%promos_enabled%' or p.prosrc like '%expo%')
  ) then
    raise exception 'customer_push_device_counts verification failed: an admin_push function references the customer push channel';
  end if;

  raise notice 'customer_push_device_counts: one overload, admin-gated, anon refused, authenticated granted, no token, money path unchanged';
end
$verify$;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- drop function if exists public.customer_push_device_counts();
-- Only safe while push_devices_admin_select still exists and the console still
-- counts through it. After the policy is dropped, dropping this leaves Push
-- Tools without counts.
