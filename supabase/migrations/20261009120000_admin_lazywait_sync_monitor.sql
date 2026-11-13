-- ============================================================================
-- ADMIN LAZYWAIT SYNC MONITOR: the Settings → Integrations sync table, without
-- customer data
--
-- WHAT WENT WRONG. The Lazywait monitor reads `admin_list_orders(200)` and keeps
-- the 50 most recent orders that needed a POS sync. That RPC is the general
-- staff order feed, so each of those 200 rows carries the customer's name,
-- phone, delivery address snapshot, notes and coupon. The table shows none of
-- them, and they still reach the browser on every refresh. It also omits
-- `pos_sync_deadline_at`, which the console's requeue-eligibility mirror reads,
-- so an order past its deadline could still show a Retry button that the
-- server then refuses.
--
-- WHAT THIS ADDS. `admin_lazywait_sync_monitor(p_limit)`: the newest orders
-- whose sync state is set and is not 'skipped', newest first, with exactly the
-- columns the monitor renders or its eligibility mirror reads. No customer
-- field is in the projection. The filter runs in SQL, so the monitor always
-- shows the newest 50 such orders rather than whatever survives a 200-row
-- window. `p_limit` defaults to 50 and is clamped to 1..200.
--
-- ACCESS IS NOT WIDENED. The gate is `is_staff()` (admin or accountant, at
-- AAL2), the gate `admin_list_orders` applies today, and the projection is a
-- strict subset of what that function returns plus `pos_sync_deadline_at`. An
-- accountant sees the panel read-only, as before.
--
-- GRANTS. EXECUTE is revoked from `public` AND `anon` explicitly: this
-- project's `pg_default_acl` grants EXECUTE on new functions to `anon`
-- directly (CLAUDE.md §8, ledger row 101). Granted to `authenticated`.
--
-- NOTHING ELSE CHANGES. No table, policy or existing function is altered, no
-- row is written, and no deploy is implied. `admin_list_orders` stays as it is.
-- place_order and compute_order_snapshot are asserted unchanged below.
--
-- ORDERING. The console change that calls this ships in a later pull request,
-- merged only after this file is applied, because a merge deploys the console
-- (CLAUDE.md §13). Merging this file alone changes nothing anyone sees.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved workflow (docs/MIGRATIONS.md), named by version.
-- ============================================================================

create or replace function public.admin_lazywait_sync_monitor(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may read the Lazywait sync monitor' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb)
    into v_rows
    from (
      select
        o.id, o.order_number, o.order_type, o.created_at,
        o.lazywait_sync_state, o.lazywait_ref, o.lazywait_order_number,
        o.sync_attempt_count, o.sync_last_error, o.sync_blocked_reason,
        o.pos_sync_deadline_at, o.pos_create_attempted_at
      from public.orders o
      where o.lazywait_sync_state is not null
        and o.lazywait_sync_state <> 'skipped'
      order by o.created_at desc, o.id desc
      limit least(200, greatest(1, coalesce(p_limit, 50)))
    ) t;

  return v_rows;
end $$;

revoke all on function public.admin_lazywait_sync_monitor(integer) from public, anon;
grant execute on function public.admin_lazywait_sync_monitor(integer) to authenticated;

comment on function public.admin_lazywait_sync_monitor(integer) is
  'Lazywait sync monitor feed for the console (is_staff enforced internally): the newest orders needing a POS sync, sync columns only, no customer fields. Default 50, clamped to 1..200 (20261009120000).';

-- ---- Self-verification ---------------------------------------------------------
-- One transaction: if any check fails, the whole file rolls back.
do $verify$
declare
  v_n     integer;
  v_oid   oid;
  v_txt   text;
  v_state text;
  v_keys  text;
begin
  -- Cardinality first: every check below reads one definition.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_lazywait_sync_monitor';
  if v_n <> 1 then
    raise exception 'admin_lazywait_sync_monitor verification failed: expected 1 overload, found %', v_n;
  end if;

  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_lazywait_sync_monitor';

  if (select p.pronargs from pg_proc p where p.oid = v_oid) is distinct from 1::smallint then
    raise exception 'admin_lazywait_sync_monitor verification failed: expected one argument';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true then
    raise exception 'admin_lazywait_sync_monitor verification failed: not SECURITY DEFINER';
  end if;
  if not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'admin_lazywait_sync_monitor verification failed: search_path is not pinned to public';
  end if;

  -- The grant, both halves.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'admin_lazywait_sync_monitor verification failed: anon can execute it, which must never be true';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'admin_lazywait_sync_monitor verification failed: authenticated cannot execute it, so the console cannot';
  end if;

  -- The gate, as an OUTCOME: called as `authenticated` with no identity (not
  -- staff), it must refuse with 42501. Read back as a value, not a notice.
  begin
    set local role authenticated;
    perform public.admin_lazywait_sync_monitor(50);
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    reset role;
  end;
  if v_state is distinct from '42501' then
    raise exception 'admin_lazywait_sync_monitor verification failed: a non-staff caller got %, expected 42501', coalesce(v_state, 'NULL');
  end if;

  -- A plpgsql body is not name-resolved when it is created, and the gate above
  -- raises before the select runs. Run the projection itself, read-only, with
  -- the identical predicate, and read its keys back so every column name
  -- resolves here and no customer field can be among them.
  select string_agg(k, ',' order by k) into v_keys
    from (
      select jsonb_object_keys(to_jsonb(t)) as k
        from (
          select
            o.id, o.order_number, o.order_type, o.created_at,
            o.lazywait_sync_state, o.lazywait_ref, o.lazywait_order_number,
            o.sync_attempt_count, o.sync_last_error, o.sync_blocked_reason,
            o.pos_sync_deadline_at, o.pos_create_attempted_at
          from public.orders o
          where o.lazywait_sync_state is not null
            and o.lazywait_sync_state <> 'skipped'
          order by o.created_at desc, o.id desc
          limit 1
        ) t
      union
      select unnest(array['id','order_number','order_type','created_at',
        'lazywait_sync_state','lazywait_ref','lazywait_order_number',
        'sync_attempt_count','sync_last_error','sync_blocked_reason',
        'pos_sync_deadline_at','pos_create_attempted_at'])
    ) keys;
  if v_keys is distinct from
     'created_at,id,lazywait_order_number,lazywait_ref,lazywait_sync_state,order_number,order_type,pos_create_attempted_at,pos_sync_deadline_at,sync_attempt_count,sync_blocked_reason,sync_last_error' then
    raise exception 'admin_lazywait_sync_monitor verification failed: projection keys are %', coalesce(v_keys, 'NULL');
  end if;

  -- And the stored body names no customer column.
  select p.prosrc into v_txt from pg_proc p where p.oid = v_oid;
  if v_txt ~ '(customer_|address_snapshot|\mnotes\M|coupon_code|phone)' then
    raise exception 'admin_lazywait_sync_monitor verification failed: the body names a customer field';
  end if;

  -- The money path is untouched. One overload each first, then the hash.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'admin_lazywait_sync_monitor verification failed: expected 1 place_order, found %', v_n;
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
    raise exception 'admin_lazywait_sync_monitor verification failed: expected 1 compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'admin_lazywait_sync_monitor: one overload, staff-gated, anon refused, authenticated granted, no customer field, money path unchanged';
end
$verify$;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- drop function if exists public.admin_lazywait_sync_monitor(integer);
-- Only safe while the console still reads admin_list_orders. Once the console
-- calls this function, dropping it empties the monitor until the console is
-- reverted.
