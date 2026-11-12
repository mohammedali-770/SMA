-- ============================================================================
-- ADMIN LOYALTY STATS: the Settings → Loyalty tiles, aggregated server-side
--
-- WHAT WENT WRONG. Every staff sign-in ran `profiles.select('*')` with no
-- bound, so that Settings → Loyalty could count customers and sum their points
-- in the browser. Two faults, one cause:
--
--   * PostgREST caps a response at 1 000 rows. Past that the tiles were
--     silently wrong — measured at 5 000 customers, 196 136 points shown
--     against 1 000 079 actually held. A liability figure that is wrong by a
--     factor of five and looks right is worse than no figure.
--   * every customer's name, phone and email reached every staff browser on
--     every sign-in, whether or not anyone opened the Loyalty section.
--
-- WHAT THIS ADDS. `admin_loyalty_stats()` — two figures over every profile
-- with role 'customer': how many there are, and how many points they hold.
-- The console derives the value and the per-customer average from those two
-- and the configured rate, exactly as it did before, and reads the ledger a
-- page at a time with an ordinary RLS-scoped select.
--
-- ACCESS IS NOT WIDENED. The gate is `is_staff()` — admin or accountant, at
-- AAL2 — the same predicate `profiles_select_own_or_staff` applies, which is
-- what decided who could compute these figures before. It is the precedent
-- `admin_order_stats()` (20260806130000) set for the order tiles.
--
-- DEFINITIONS MATCH THE OLD ONES. Members = rows with role 'customer'. Points =
-- the sum of their `loyalty_points`. Staff balances are excluded, as the
-- client's `p.role === 'customer'` filter excluded them.
--
-- GRANTS. EXECUTE is revoked from `public` AND `anon` explicitly: this
-- project's `pg_default_acl` grants EXECUTE on new functions to `anon`
-- directly, so revoking from `public` alone leaves it callable
-- (CLAUDE.md §8, ledger row 101). Granted to `authenticated`, which the
-- console calls as.
--
-- NOTHING ELSE CHANGES. No table, policy or existing function is altered, no
-- row is written, and no deploy is implied. place_order and
-- compute_order_snapshot are asserted unchanged below.
--
-- ORDERING. The console half deploys on merge (Vercel's Git integration,
-- CLAUDE.md §13). Until this is applied the tiles show "—" and a notice that
-- the migration is missing; the ledger works either way. Apply it before, or
-- right after, the merge.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved workflow (docs/MIGRATIONS.md), named by version.
-- ============================================================================

create or replace function public.admin_loyalty_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_members bigint;
  v_points  bigint;
begin
  if not public.is_staff() then
    raise exception 'Only staff may read loyalty stats' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(p.loyalty_points), 0)
    into v_members, v_points
    from public.profiles p
   where p.role = 'customer';

  return jsonb_build_object('member_count', v_members, 'points_total', v_points);
end $$;

revoke all on function public.admin_loyalty_stats() from public, anon;
grant execute on function public.admin_loyalty_stats() to authenticated;

comment on function public.admin_loyalty_stats() is
  'Loyalty programme totals for the console Settings tiles (is_staff enforced internally): customers and the points they hold. Constant-size; replaces summing an unbounded, 1 000-row-capped profiles read in the browser (20261008120000).';

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
   where n.nspname = 'public' and p.proname = 'admin_loyalty_stats';
  if v_n <> 1 then
    raise exception 'admin_loyalty_stats verification failed: expected 1 overload, found %', v_n;
  end if;

  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_loyalty_stats';

  if (select p.pronargs from pg_proc p where p.oid = v_oid) is distinct from 0::smallint then
    raise exception 'admin_loyalty_stats verification failed: it takes arguments';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true then
    raise exception 'admin_loyalty_stats verification failed: not SECURITY DEFINER';
  end if;
  if not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'admin_loyalty_stats verification failed: search_path is not pinned to public';
  end if;

  -- The grant, both halves: anon may not call it, the console's role may.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'admin_loyalty_stats verification failed: anon can execute it, which must never be true';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'admin_loyalty_stats verification failed: authenticated cannot execute it, so the console cannot';
  end if;

  -- The gate, as an OUTCOME: called as `authenticated` with no identity (not
  -- staff), it must refuse with 42501. Read back as a value, not a notice.
  -- Same shape as 20260930120000's anon read, which was applied this way.
  begin
    set local role authenticated;
    perform public.admin_loyalty_stats();
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    reset role;
  end;
  if v_state is distinct from '42501' then
    raise exception 'admin_loyalty_stats verification failed: a non-staff caller got %, expected 42501', coalesce(v_state, 'NULL');
  end if;

  -- A plpgsql body is not name-resolved when it is created, and the gate above
  -- raises before the aggregate runs. Run the aggregate itself, read-only, with
  -- the identical predicate, so every name it uses resolves here.
  perform count(*), coalesce(sum(p.loyalty_points), 0)
     from public.profiles p
    where p.role = 'customer';

  -- The money path is untouched. One overload each first, then the hash.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'admin_loyalty_stats verification failed: expected 1 place_order, found %', v_n;
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
    raise exception 'admin_loyalty_stats verification failed: expected 1 compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'admin_loyalty_stats: one overload, staff-gated, anon refused, authenticated granted, money path unchanged';
end
$verify$;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- drop function if exists public.admin_loyalty_stats();
-- The console then shows "—" in the four tiles and the missing-migration
-- notice; the ledger is unaffected. Nothing else references the function.
