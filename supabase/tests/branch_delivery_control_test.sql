-- ============================================================================
-- Branch delivery control (timed pause, advisory areas, working hours) coverage.
--
-- IMPERSONATION NOTE. As in ops_roles_test.sql and branch_availability_snooze_test.sql,
-- this suite impersonates through request.jwt.claim.sub rather than the test.*
-- GUCs: the CI harness overrides current_app_role() so that any test.* setting
-- forces admin|accountant|customer, which cannot express call_center or
-- branch_staff. Do not add test.* GUCs here.
--
-- The sweeper cases CLEAR the claim before sweeping, because source attribution
-- derives from auth.uid() being null under pg_cron. Leaving a claim set would
-- record an automatic resume as a manual one — which is the bug the assertion
-- exists to catch.
-- ============================================================================
begin;

do $$
declare
  v_cust  uuid := 'e1000000-0000-0000-0000-000000000001';
  v_admin uuid := 'e1000000-0000-0000-0000-000000000002';
  v_op    uuid := 'e1000000-0000-0000-0000-000000000003';
  v_cc    uuid := 'e1000000-0000-0000-0000-000000000004';
begin
  insert into auth.users(id) values (v_cust),(v_admin),(v_op),(v_cc)
  on conflict (id) do nothing;

  insert into public.profiles(id, full_name, role) values
    (v_cust,'Delivery Customer','customer'),
    (v_admin,'Delivery Admin','admin'),
    (v_op,'Branch Operator','branch_staff'),
    (v_cc,'Call Centre','call_center')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

  insert into public.staff_branch_assignments(user_id, branch_id)
  values (v_op,'b0000000-0000-0000-0000-000000000001')
  on conflict (user_id) do update set branch_id = excluded.branch_id;

  -- A delivery address inside the zone drawn below. `description` is mandatory
  -- since 20260724170000, and place_order derives the coordinates from this row
  -- rather than trusting a parameter.
  insert into public.addresses (id, customer_id, label, description, latitude, longitude)
  values ('e2000000-0000-0000-0000-000000000001', v_cust, 'Home',
          'Near the big mosque, second building', 24.7136, 46.6753)
  on conflict (id) do update set latitude = excluded.latitude, longitude = excluded.longitude;
end $$;

-- A square delivery zone around the seed Riyadh branch, drawn through the real
-- admin RPC so the geometry is normalized exactly as production would.
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000002',true);
select public.set_branch_delivery_zone(
  'b0000000-0000-0000-0000-000000000001',
  '{"type":"Polygon","coordinates":[[[46.60,24.65],[46.75,24.65],[46.75,24.78],[46.60,24.78],[46.60,24.65]]]}'::jsonb,
  'test zone', true);

-- Place a cash order of the requested type, returning the SQLSTATE (null on
-- success). This is what proves a pause reaches the ORDER PATH, not just the UI.
create or replace function pg_temp.order_state(p_type public.order_type) returns text
language plpgsql as $$
declare v_state text; v_prev text;
begin
  v_prev := coalesce(current_setting('request.jwt.claim.sub', true), '');
  perform set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000001',true);
  begin
    perform public.place_order(
      'b0000000-0000-0000-0000-000000000001'::uuid,
      p_type,
      -- Quantity 4 clears the seed branch's 40 SAR delivery minimum (the item is
      -- 12), so a rejection here is about the pause and not about the basket.
      '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":4,"modifier_ids":[]}]'::jsonb,
      case when p_type = 'delivery'
           then 'e2000000-0000-0000-0000-000000000001'::uuid else null end,
      null, null, 0, null, 'cash');
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('request.jwt.claim.sub', v_prev, true);
  return v_state;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Baseline: both order types work before anything is paused.
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_temp.order_state('pickup') is not null then
    raise exception 'FIXTURE FAILED: pickup did not place (%)', pg_temp.order_state('pickup');
  end if;
  if pg_temp.order_state('delivery') is not null then
    raise exception 'FIXTURE FAILED: delivery did not place (%) — check the zone fixture',
      pg_temp.order_state('delivery');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Call centre pauses delivery: delivery blocked, PICKUP STILL WORKS.
--    Pausing delivery must never take the whole branch offline.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000004',true);
do $$
declare b public.branches; e public.branch_delivery_events;
begin
  perform public.set_branch_delivery_pause(
    'b0000000-0000-0000-0000-000000000001', 45, 'no_driver', 'both riders called in sick');

  select * into b from public.branches where id = 'b0000000-0000-0000-0000-000000000001';
  if not b.delivery_temporarily_closed or b.delivery_closed_until is null then
    raise exception 'PAUSE FAILED: branch state wrong (closed=%, until=%)',
      b.delivery_temporarily_closed, b.delivery_closed_until;
  end if;

  select * into e from public.branch_delivery_events order by id desc limit 1;
  if e.action <> 'delivery_paused' or e.source <> 'manual' then
    raise exception 'AUDIT FAILED: unexpected event (%)', to_jsonb(e);
  end if;
  if e.changed_by <> 'e1000000-0000-0000-0000-000000000004'
     or e.actor_role <> 'call_center' then
    raise exception 'AUDIT FAILED: actor not recorded (%)', to_jsonb(e);
  end if;
  if e.duration_minutes <> 45 or e.reason_code <> 'no_driver'
     or e.reason_note <> 'both riders called in sick' then
    raise exception 'AUDIT FAILED: pause details not captured (%)', to_jsonb(e);
  end if;

  if pg_temp.order_state('delivery') is null then
    raise exception 'GUARD FAILED: a delivery order placed while delivery was paused';
  end if;
  if pg_temp.order_state('pickup') is not null then
    raise exception 'GUARD FAILED: pausing delivery also blocked PICKUP';
  end if;
end $$;

-- 3. Resuming restores delivery and logs a manual resume.
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000004',true);
do $$
declare e public.branch_delivery_events;
begin
  perform public.clear_branch_delivery_pause('b0000000-0000-0000-0000-000000000001');

  select * into e from public.branch_delivery_events order by id desc limit 1;
  if e.action <> 'delivery_resumed_manual' or e.source <> 'manual' then
    raise exception 'AUDIT FAILED: resume not logged as manual (%)', to_jsonb(e);
  end if;
  if (select delivery_closed_until from public.branches
       where id = 'b0000000-0000-0000-0000-000000000001') is not null then
    raise exception 'NORMALIZE FAILED: delivery_closed_until survived a resume';
  end if;
  if pg_temp.order_state('delivery') is not null then
    raise exception 'GUARD FAILED: delivery still blocked after resume';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Authorization — the mirror image of item snoozing.
--    Branch staff own what is sellable; the call centre owns where it can go.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cases text[][] := array[
    ['e1000000-0000-0000-0000-000000000003','a branch operator'],
    ['e1000000-0000-0000-0000-000000000001','a customer']
  ];
  v_case text[];
begin
  foreach v_case slice 1 in array v_cases loop
    perform set_config('request.jwt.claim.sub', v_case[1], true);
    begin
      perform public.set_branch_delivery_pause(
        'b0000000-0000-0000-0000-000000000001', 30, 'no_driver', null);
      raise exception 'AUTH FAILED: % was able to pause delivery', v_case[2];
    exception when sqlstate '42501' then null;
    end;
    begin
      perform public.clear_branch_delivery_pause('b0000000-0000-0000-0000-000000000001');
      raise exception 'AUTH FAILED: % was able to resume delivery', v_case[2];
    exception when sqlstate '42501' then null;
    end;
  end loop;
end $$;

-- An admin may do both.
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000002',true);
do $$
begin
  perform public.set_branch_delivery_pause(
    'b0000000-0000-0000-0000-000000000001', 30, 'weather', null);
  perform public.clear_branch_delivery_pause('b0000000-0000-0000-0000-000000000001');
end $$;

-- 5. Validation: pauses are timed, and the reason vocabulary is closed.
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000004',true);
do $$
declare v_minutes integer;
begin
  begin
    perform public.set_branch_delivery_pause(
      'b0000000-0000-0000-0000-000000000001', null, 'no_driver', null);
    raise exception 'VALIDATION FAILED: a null duration was accepted';
  exception when sqlstate '22004' then null;
  end;
  foreach v_minutes in array array[0, -5, 1441] loop
    begin
      perform public.set_branch_delivery_pause(
        'b0000000-0000-0000-0000-000000000001', v_minutes, 'no_driver', null);
      raise exception 'VALIDATION FAILED: duration % was accepted', v_minutes;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform public.set_branch_delivery_pause(
      'b0000000-0000-0000-0000-000000000001', 30, 'because_reasons', null);
    raise exception 'VALIDATION FAILED: an unknown reason code was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The sweeper resumes an expired pause — and NEVER an untimed one.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000004',true);
select public.set_branch_delivery_pause(
  'b0000000-0000-0000-0000-000000000001', 30, 'kitchen_overload', null);
update public.branches
   set delivery_closed_until = now() - interval '1 minute'
 where id = 'b0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','',true);

do $$
declare v_run bigint; r public.branch_availability_runs; e public.branch_delivery_events;
begin
  v_run := public.branch_availability_sweep();
  select * into r from public.branch_availability_runs where id = v_run;
  if r.status <> 'success' or r.delivery_resumed <> 1 then
    raise exception 'SWEEP FAILED: run row wrong (%)', to_jsonb(r);
  end if;
  -- The item counter must be untouched by a delivery-only sweep.
  if r.products_reopened <> 0 then
    raise exception 'SWEEP FAILED: a delivery resume incremented products_reopened';
  end if;

  select * into e from public.branch_delivery_events order by id desc limit 1;
  if e.action <> 'delivery_resumed_auto' or e.source <> 'automatic' then
    raise exception 'SWEEP FAILED: not logged as automatic (%)', to_jsonb(e);
  end if;
  if e.changed_by is not null or e.actor_role is not null then
    raise exception 'SWEEP FAILED: an automatic resume claimed an actor (%)', to_jsonb(e);
  end if;
end $$;

-- THE RULE THAT MATTERS: the admin's untimed toggle is never auto-resumed.
do $$
declare v_run bigint;
begin
  update public.branches
     set delivery_temporarily_closed = true
   where id = 'b0000000-0000-0000-0000-000000000002';
  if (select delivery_closed_until from public.branches
       where id = 'b0000000-0000-0000-0000-000000000002') is not null then
    raise exception 'FIXTURE FAILED: the untimed pause has a timer';
  end if;

  v_run := public.branch_availability_sweep();
  if (select delivery_resumed from public.branch_availability_runs where id = v_run) <> 0 then
    raise exception 'SWEEP FAILED: the sweeper resumed an UNTIMED delivery pause';
  end if;
  if not (select delivery_temporarily_closed from public.branches
           where id = 'b0000000-0000-0000-0000-000000000002') then
    raise exception 'SWEEP FAILED: an untimed delivery pause was resumed';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Named areas are ADVISORY: disabling one must not affect order acceptance.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000002',true);
do $$
declare v jsonb; v_area uuid; v_run bigint; e public.branch_delivery_events;
begin
  v := public.admin_add_delivery_area('b0000000-0000-0000-0000-000000000001','الملز','Malaz');
  v_area := (v->>'id')::uuid;

  perform set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000004',true);
  perform public.set_delivery_area_disabled(v_area, 60, 'area_incident', 'road closed');

  select * into e from public.branch_delivery_events order by id desc limit 1;
  if e.action <> 'area_disabled' or e.area_id <> v_area then
    raise exception 'AUDIT FAILED: area disable not logged (%)', to_jsonb(e);
  end if;

  -- The whole point of "advisory": the customer app decides delivery from the
  -- polygon alone, so a disabled area changes nothing about order acceptance.
  if pg_temp.order_state('delivery') is not null then
    raise exception 'ADVISORY FAILED: disabling a named area blocked a delivery order';
  end if;

  -- It expires like everything else.
  update public.branch_delivery_areas set disabled_until = now() - interval '1 minute'
   where id = v_area;
  perform set_config('request.jwt.claim.sub','',true);
  v_run := public.branch_availability_sweep();
  if (select areas_reenabled from public.branch_availability_runs where id = v_run) <> 1 then
    raise exception 'SWEEP FAILED: expired area not re-enabled';
  end if;

  -- A branch operator may SEE their branch's areas but may not change them.
  perform set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000003',true);
  begin
    perform public.set_delivery_area_disabled(v_area, 30, 'weather', null);
    raise exception 'AUTH FAILED: a branch operator disabled a delivery area';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Working hours, including a window that crosses midnight.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000002',true);
do $$
declare h public.branch_working_hours;
begin
  perform public.admin_upsert_branch_working_hours(
    'b0000000-0000-0000-0000-000000000001',
    '[{"day_of_week":0,"is_closed":false,"opens_at":"12:00","closes_at":"02:00"},
      {"day_of_week":5,"is_closed":true}]'::jsonb);

  select * into h from public.branch_working_hours
   where branch_id = 'b0000000-0000-0000-0000-000000000001' and day_of_week = 0;
  -- closes_at <= opens_at is VALID and means the window crosses midnight.
  if h.opens_at <> '12:00'::time or h.closes_at <> '02:00'::time then
    raise exception 'HOURS FAILED: a midnight-crossing window was not stored (%)', to_jsonb(h);
  end if;

  select * into h from public.branch_working_hours
   where branch_id = 'b0000000-0000-0000-0000-000000000001' and day_of_week = 5;
  if not h.is_closed or h.opens_at is not null then
    raise exception 'HOURS FAILED: a closed day kept a window (%)', to_jsonb(h);
  end if;

  -- An open day needs both bounds.
  begin
    perform public.admin_upsert_branch_working_hours(
      'b0000000-0000-0000-0000-000000000001',
      '[{"day_of_week":1,"is_closed":false,"opens_at":"12:00"}]'::jsonb);
    raise exception 'HOURS FAILED: an open day with no closing time was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- Hours are configuration, not operations: the call centre may not set them.
  perform set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000004',true);
  begin
    perform public.admin_upsert_branch_working_hours(
      'b0000000-0000-0000-0000-000000000001',
      '[{"day_of_week":2,"is_closed":true}]'::jsonb);
    raise exception 'AUTH FAILED: call centre set working hours';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Working hours do not gate ordering. Closing every day changes nothing.
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000002',true);
do $$
begin
  perform public.admin_upsert_branch_working_hours(
    'b0000000-0000-0000-0000-000000000001',
    '[{"day_of_week":0,"is_closed":true},{"day_of_week":1,"is_closed":true},
      {"day_of_week":2,"is_closed":true},{"day_of_week":3,"is_closed":true},
      {"day_of_week":4,"is_closed":true},{"day_of_week":5,"is_closed":true},
      {"day_of_week":6,"is_closed":true}]'::jsonb);
  if pg_temp.order_state('pickup') is not null then
    raise exception 'ADVISORY FAILED: working hours blocked an order — they must not';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Exposure: the world-readable branches table must not carry staff identity
--    or free text. Both clients request select('*') and anon can read active
--    branches, so a column here is a column shipped to every customer.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='branches'
                and column_name in ('delivery_closed_by','delivery_closed_reason','delivery_closed_note')) then
    raise exception 'EXPOSURE FAILED: staff identity or free text is on the public branches table';
  end if;
  if has_table_privilege('anon','public.branch_delivery_events','SELECT') then
    raise exception 'EXPOSURE FAILED: anon can read the delivery audit';
  end if;
  -- Area names exist for call-centre phone orders; the app uses the polygon.
  if has_table_privilege('anon','public.branch_delivery_areas','SELECT') then
    raise exception 'EXPOSURE FAILED: anon can read advisory delivery areas';
  end if;
  if has_table_privilege('authenticated','public.branch_delivery_events','INSERT')
     or has_table_privilege('authenticated','public.branch_delivery_areas','UPDATE') then
    raise exception 'EXPOSURE FAILED: delivery tables are client-writable';
  end if;
  -- Working hours ARE public business information.
  if not has_table_privilege('anon','public.branch_working_hours','SELECT') then
    raise exception 'EXPOSURE FAILED: working hours should be publicly readable';
  end if;
end $$;

-- 10. The sweeper still carries both properties the item suite pins, and now
--     excludes untimed delivery pauses by the same means.
do $$
declare v_def text := pg_get_functiondef('public.branch_availability_sweep()'::regprocedure);
begin
  if position('pg_try_advisory_xact_lock' in v_def) = 0 then
    raise exception 'WIRING FAILED: the sweeper lost its overlap guard';
  end if;
  if position('snoozed_until is not null' in v_def) = 0 then
    raise exception 'WIRING FAILED: the sweeper no longer excludes untimed item closures';
  end if;
  if position('delivery_closed_until is not null' in v_def) = 0 then
    raise exception 'WIRING FAILED: the sweeper does not exclude untimed delivery pauses';
  end if;
end $$;

rollback;
