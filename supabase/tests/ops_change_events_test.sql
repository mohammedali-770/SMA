-- ============================================================================
-- Operations realtime signal coverage.
--
-- The property that matters most here is NEGATIVE: this table is published to
-- supabase_realtime, so whatever a subscriber can select, the platform will push
-- to them. It must therefore carry no item, reason or actor detail, and must not
-- be readable by anon.
--
-- Impersonation is through request.jwt.claim.sub — see ops_roles_test.sql for why
-- the test.* GUCs cannot express the operations roles.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid := 'f1000000-0000-0000-0000-000000000001';
  v_opa   uuid := 'f1000000-0000-0000-0000-000000000002';
  v_cc    uuid := 'f1000000-0000-0000-0000-000000000003';
begin
  insert into auth.users(id) values (v_admin),(v_opa),(v_cc) on conflict (id) do nothing;
  insert into public.profiles(id, full_name, role) values
    (v_admin,'Signal Admin','admin'),
    (v_opa,'Operator A','branch_staff'),
    (v_cc,'Call Centre','call_center')
  on conflict (id) do update set role = excluded.role;
  insert into public.staff_branch_assignments(user_id, branch_id)
  values (v_opa,'b0000000-0000-0000-0000-000000000001')
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Each of the three operational transitions emits exactly one signal.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000001',true);
do $$
declare n_before bigint; e public.ops_change_events;
begin
  select count(*) into n_before from public.ops_change_events;

  -- availability
  insert into public.branch_product_availability (branch_id, product_id, is_available)
  values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003', false)
  on conflict (branch_id, product_id) do update set is_available = false;

  select * into e from public.ops_change_events order by id desc limit 1;
  if e.kind <> 'availability' or e.branch_id <> 'b0000000-0000-0000-0000-000000000001' then
    raise exception 'SIGNAL FAILED: availability change not signalled (%)', to_jsonb(e);
  end if;

  -- delivery
  perform public.set_branch_delivery_pause(
    'b0000000-0000-0000-0000-000000000001', 30, 'no_driver', null);
  select * into e from public.ops_change_events order by id desc limit 1;
  if e.kind <> 'delivery' then
    raise exception 'SIGNAL FAILED: delivery pause not signalled (%)', to_jsonb(e);
  end if;

  -- area
  perform public.admin_add_delivery_area('b0000000-0000-0000-0000-000000000001','الملز','Malaz');
  select * into e from public.ops_change_events order by id desc limit 1;
  if e.kind <> 'area' then
    raise exception 'SIGNAL FAILED: area change not signalled (%)', to_jsonb(e);
  end if;

  if (select count(*) from public.ops_change_events) <= n_before then
    raise exception 'SIGNAL FAILED: nothing was emitted at all';
  end if;
end $$;

-- 2. A no-op write wakes nobody.
do $$
declare n_before bigint;
begin
  select count(*) into n_before from public.ops_change_events;

  -- Same value, no transition.
  update public.branch_product_availability set is_available = false
   where branch_id='b0000000-0000-0000-0000-000000000001'
     and product_id='a0000000-0000-0000-0000-000000000003';
  -- An unrelated branch edit is not a delivery change.
  update public.branches set phone = '+966 11 000 9999'
   where id = 'b0000000-0000-0000-0000-000000000001';

  if (select count(*) from public.ops_change_events) <> n_before then
    raise exception 'SIGNAL FAILED: a no-op write emitted a signal';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The signal carries NOTHING but a branch and a kind.
--    This table is broadcast; every column here reaches a subscriber.
-- ---------------------------------------------------------------------------
do $$
declare v_cols text[];
begin
  select array_agg(column_name::text order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'ops_change_events';

  if v_cols <> array['branch_id','created_at','id','kind'] then
    raise exception 'EXPOSURE FAILED: the published signal carries extra columns: %', v_cols;
  end if;
end $$;

-- 4. Reachability: ops roles yes, anon and customers no.
do $$
begin
  if has_table_privilege('anon','public.ops_change_events','SELECT') then
    raise exception 'EXPOSURE FAILED: anon can subscribe to the ops signal';
  end if;
  if has_table_privilege('authenticated','public.ops_change_events','INSERT')
     or has_table_privilege('authenticated','public.ops_change_events','UPDATE')
     or has_table_privilege('authenticated','public.ops_change_events','DELETE') then
    raise exception 'EXPOSURE FAILED: the ops signal is client-writable';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000003',true);
do $$
begin
  -- Call centre watches every branch; that is the job.
  if (select count(*) from public.ops_change_events) = 0 then
    raise exception 'RLS FAILED: call centre cannot see the ops signal';
  end if;
end $$;

select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
do $$
declare v_other bigint;
begin
  -- A branch operator sees their own branch only.
  select count(*) into v_other from public.ops_change_events
   where branch_id is distinct from 'b0000000-0000-0000-0000-000000000001';
  if v_other <> 0 then
    raise exception 'RLS FAILED: a branch operator saw % signals from other branches', v_other;
  end if;
end $$;
reset role;

-- 5. It is actually published, so the consoles receive anything at all.
--    Guarded: a plain Postgres without the publication is a no-op by design.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'ops_change_events'
    ) then
      raise exception 'PUBLICATION FAILED: ops_change_events is not published';
    end if;
    -- The data tables themselves must stay OUT: postgres_changes re-evaluates
    -- RLS per subscriber and branch_product_availability is anon-readable.
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('branch_product_availability','branches','branch_delivery_areas')
    ) then
      raise exception 'PUBLICATION FAILED: a data table is broadcast to subscribers';
    end if;
  end if;
end $$;

rollback;
