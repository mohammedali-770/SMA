-- ============================================================================
-- DROP push_devices_admin_select: no client role can read a push token
--
-- WHAT IT CLOSES. `push_devices_admin_select` lets any administrator session
-- read every row of `push_devices`, Expo push tokens included. Until Expo's
-- Enhanced Security is on (docs/OWNER_ACTIONS.md §52), a token is a bearer
-- credential: whoever holds one can send that phone a notification that
-- appears as Spicy Meal. The console only ever needed two counts, which it now
-- reads through `customer_push_device_counts()` (20261010120000).
--
-- WHAT IT DOES. Drops that one policy. Afterwards a customer still reads their
-- own rows through `push_devices_select_own`, and `push-dispatch` still reads
-- every row with the service role, which bypasses RLS. Nothing about who a
-- push or a broadcast reaches changes (CLAUDE.md §7).
--
-- ORDERING, enforced. The file refuses to apply unless
-- `customer_push_device_counts()` exists, because the console reads its counts
-- there. It must also be applied only AFTER the console change that stops
-- counting through this policy has deployed; applied earlier, Push Tools would
-- show zero devices beside the broadcast button until that deploy. No SQL can
-- see a deploy, so that half is the approver's to hold (docs/OWNER_ACTIONS.md
-- §53).
--
-- NOTHING ELSE CHANGES. No function, table or other policy is altered, no row
-- is written, and no deploy is implied. place_order and compute_order_snapshot
-- are asserted unchanged below.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved workflow (docs/MIGRATIONS.md), named by version.
-- ============================================================================

-- ---- Precondition ----------------------------------------------------------------
do $pre$
begin
  if (select count(*)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'customer_push_device_counts') <> 1 then
    raise exception 'drop_push_devices_admin_select refused: customer_push_device_counts() is missing, so the console would lose its counts. Apply 20261010120000 first.';
  end if;
end
$pre$;

drop policy if exists push_devices_admin_select on public.push_devices;

-- ---- Self-verification ---------------------------------------------------------
-- One transaction: if any check fails, the whole file rolls back.
do $verify$
declare
  v_n   integer;
  v_txt text;
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'push_devices'
       and policyname = 'push_devices_admin_select'
  ) then
    raise exception 'drop_push_devices_admin_select verification failed: the policy is still there';
  end if;

  -- No other policy may let staff read the table instead. Every remaining
  -- SELECT-capable policy must be keyed to the caller's own customer_id.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'push_devices'
     and cmd in ('SELECT', 'ALL')
     and (coalesce(qual, '') ~ '(is_admin|is_staff|is_call_center|is_branch_operator)'
          or coalesce(qual, '') !~ 'customer_id');
  if v_n <> 0 then
    raise exception 'drop_push_devices_admin_select verification failed: % SELECT policy(ies) on push_devices are not owner-scoped', v_n;
  end if;

  -- The customer's own read survives.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'push_devices'
       and policyname = 'push_devices_select_own' and cmd = 'SELECT'
  ) then
    raise exception 'drop_push_devices_admin_select verification failed: push_devices_select_own is missing';
  end if;

  -- RLS is still on, so the dropped policy means fewer rows, not more.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.push_devices'::regclass) then
    raise exception 'drop_push_devices_admin_select verification failed: RLS is off on push_devices';
  end if;

  -- The money path is untouched. One overload each first, then the hash.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'drop_push_devices_admin_select verification failed: expected 1 place_order, found %', v_n;
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
    raise exception 'drop_push_devices_admin_select verification failed: expected 1 compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'drop_push_devices_admin_select: policy gone, only owner-scoped reads remain, RLS on, money path unchanged';
end
$verify$;

-- ---------------------------------------------------------------------------
-- Rollback (restores the policy exactly as 20260810143000 defined it)
-- ---------------------------------------------------------------------------
-- create policy push_devices_admin_select on public.push_devices
--   for select to authenticated using (public.is_admin());
