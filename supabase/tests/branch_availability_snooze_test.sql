-- ============================================================================
-- Timed branch item availability ("snooze") regression coverage.
--
-- IMPERSONATION NOTE. The CI harness overrides current_app_role() so that
-- setting ANY of test.auth_uid / test.is_admin / test.is_staff forces the role
-- to admin | accountant | customer, which cannot express branch_staff or
-- call_center. This suite therefore impersonates through request.jwt.claim.sub,
-- letting current_app_role() fall through to the real profiles lookup. Do not
-- add test.* GUCs here — they would silently mask the authorization cases.
--
-- The same mechanism is load-bearing for the sweeper cases: source attribution
-- is derived from auth.uid() being null under pg_cron, so those cases CLEAR the
-- claim before sweeping. If they did not, the sweep would be recorded as a
-- manual reopen — which is exactly the bug the assertion protects against.
-- ============================================================================
begin;

-- Seed fixtures (supabase/seed.sql): branch 1 = Riyadh, product 3 = Spicy Fries,
-- which has no required modifier group and so places cleanly as a cash pickup.
\set branch1 '''b0000000-0000-0000-0000-000000000001'''
\set branch2 '''b0000000-0000-0000-0000-000000000002'''
\set prod    '''a0000000-0000-0000-0000-000000000003'''

do $$
declare
  v_cust  uuid := 'd1000000-0000-0000-0000-000000000001';
  v_admin uuid := 'd1000000-0000-0000-0000-000000000002';
  v_opa   uuid := 'd1000000-0000-0000-0000-000000000003';
  v_opb   uuid := 'd1000000-0000-0000-0000-000000000004';
  v_cc    uuid := 'd1000000-0000-0000-0000-000000000005';
begin
  insert into auth.users(id) values (v_cust),(v_admin),(v_opa),(v_opb),(v_cc)
  on conflict (id) do nothing;

  insert into public.profiles(id, full_name, role) values
    (v_cust,'Snooze Customer','customer'),
    (v_admin,'Snooze Admin','admin'),
    (v_opa,'Operator A','branch_staff'),
    (v_opb,'Operator B','branch_staff'),
    (v_cc,'Call Centre','call_center')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

  insert into public.staff_branch_assignments(user_id, branch_id) values
    (v_opa,'b0000000-0000-0000-0000-000000000001'),
    (v_opb,'b0000000-0000-0000-0000-000000000002')
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

-- Places a cash pickup order for the fixture product as the fixture customer,
-- returning the SQLSTATE (null on success). This is what proves the snooze
-- reaches the ORDER PATH and not merely the UI.
create or replace function pg_temp.order_state() returns text
language plpgsql as $$
declare v_state text; v_prev text;
begin
  -- Save and restore the caller's identity: several cases place an order in the
  -- middle of acting as an operator, and silently leaving the customer claim in
  -- place would make the next RPC fail for the wrong reason.
  v_prev := coalesce(current_setting('request.jwt.claim.sub', true), '');
  perform set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
  begin
    perform public.place_order(
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'pickup'::public.order_type,
      '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":1,"modifier_ids":[]}]'::jsonb,
      null, null, null, 0, null, 'cash');
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('request.jwt.claim.sub', v_prev, true);
  return v_state;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Baseline: the order path works before anything is snoozed.
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_temp.order_state() is not null then
    raise exception 'FIXTURE FAILED: a clean pickup order did not place (%)', pg_temp.order_state();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A branch operator snoozes their own branch's product.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000003',true);
do $$
declare v jsonb; e public.branch_availability_events; r public.branch_product_availability;
begin
  v := public.set_product_snooze(
    'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',
    30, 'out_of_stock', 'last tray sold');

  select * into r from public.branch_product_availability
   where branch_id='b0000000-0000-0000-0000-000000000001'
     and product_id='a0000000-0000-0000-0000-000000000003';
  if r.is_available then
    raise exception 'SNOOZE FAILED: row still available';
  end if;
  if r.snoozed_until is null or r.reason_code <> 'out_of_stock' or r.source <> 'manual' then
    raise exception 'SNOOZE FAILED: row state wrong (%)', to_jsonb(r);
  end if;
  if r.changed_at is null then
    raise exception 'SNOOZE FAILED: changed_at not stamped';
  end if;

  select * into e from public.branch_availability_events
   order by id desc limit 1;
  if e.action <> 'closed' or e.source <> 'manual' then
    raise exception 'AUDIT FAILED: unexpected event (%)', to_jsonb(e);
  end if;
  if e.changed_by <> 'd1000000-0000-0000-0000-000000000003'
     or e.actor_role <> 'branch_staff' then
    raise exception 'AUDIT FAILED: actor not recorded (%)', to_jsonb(e);
  end if;
  if e.duration_minutes <> 30 then
    raise exception 'AUDIT FAILED: duration was %, expected 30', e.duration_minutes;
  end if;
  if e.reason_code <> 'out_of_stock' or e.reason_note <> 'last tray sold' then
    raise exception 'AUDIT FAILED: reason not captured (%)', to_jsonb(e);
  end if;
  if e.end_time is null or e.start_time is null then
    raise exception 'AUDIT FAILED: window not recorded';
  end if;
end $$;

-- 3. That snooze BLOCKS the order path.
do $$
begin
  if pg_temp.order_state() is null then
    raise exception 'GUARD FAILED: a snoozed product still placed an order';
  end if;
end $$;

-- 4. Reopening unblocks it and logs a manual open.
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000003',true);
do $$
declare e public.branch_availability_events;
begin
  perform public.clear_product_snooze(
    'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003');

  select * into e from public.branch_availability_events order by id desc limit 1;
  if e.action <> 'opened_manual' or e.source <> 'manual' then
    raise exception 'AUDIT FAILED: reopen not logged as manual (%)', to_jsonb(e);
  end if;
  if e.actual_open_time is null then
    raise exception 'AUDIT FAILED: actual_open_time missing';
  end if;

  if (select snoozed_until from public.branch_product_availability
       where branch_id='b0000000-0000-0000-0000-000000000001'
         and product_id='a0000000-0000-0000-0000-000000000003') is not null then
    raise exception 'NORMALIZE FAILED: snoozed_until survived a reopen';
  end if;

  if pg_temp.order_state() is not null then
    raise exception 'GUARD FAILED: order still blocked after reopen';
  end if;

  -- Idempotent: reopening an already-open item is not an error and logs nothing.
  perform public.clear_product_snooze(
    'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003');
  if (select count(*) from public.branch_availability_events where action = 'opened_manual') <> 1 then
    raise exception 'AUDIT FAILED: a no-op reopen wrote an event';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Authorization.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cases text[][] := array[
    ['d1000000-0000-0000-0000-000000000005','call centre'],
    ['d1000000-0000-0000-0000-000000000004','an operator from another branch'],
    ['d1000000-0000-0000-0000-000000000001','a customer']
  ];
  v_case text[];
begin
  foreach v_case slice 1 in array v_cases loop
    perform set_config('request.jwt.claim.sub', v_case[1], true);
    begin
      perform public.set_product_snooze(
        'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',
        30,'out_of_stock',null);
      raise exception 'AUTH FAILED: % was able to snooze', v_case[2];
    exception when sqlstate '42501' then null;
    end;
    begin
      perform public.clear_product_snooze(
        'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003');
      raise exception 'AUTH FAILED: % was able to reopen', v_case[2];
    exception when sqlstate '42501' then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Input validation — cashiers get TIMED closes only.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000003',true);
do $$
declare v_minutes integer;
begin
  -- An untimed close is not available through this RPC at all.
  begin
    perform public.set_product_snooze(
      'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',
      null,'out_of_stock',null);
    raise exception 'VALIDATION FAILED: a null duration was accepted';
  exception when sqlstate '22004' then null;
  end;

  foreach v_minutes in array array[0, -5, 1441] loop
    begin
      perform public.set_product_snooze(
        'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',
        v_minutes,'out_of_stock',null);
      raise exception 'VALIDATION FAILED: duration % was accepted', v_minutes;
    exception when sqlstate '22023' then null;
    end;
  end loop;

  begin
    perform public.set_product_snooze(
      'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',
      30,'because_i_said_so',null);
    raise exception 'VALIDATION FAILED: an unknown reason code was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.set_product_snooze(
      'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',
      30,null,null);
    raise exception 'VALIDATION FAILED: a null reason code was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The sweeper.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000003',true);
select public.set_product_snooze(
  'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',
  30,'equipment_down','fryer down');

-- Backdate the timer, then sweep with NO identity — the pg_cron condition.
update public.branch_product_availability
   set snoozed_until = now() - interval '1 minute'
 where branch_id='b0000000-0000-0000-0000-000000000001'
   and product_id='a0000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','',true);

do $$
declare v_run bigint; r public.branch_availability_runs; e public.branch_availability_events;
begin
  v_run := public.branch_availability_sweep();
  select * into r from public.branch_availability_runs where id = v_run;
  if r.status <> 'success' or r.products_reopened <> 1 then
    raise exception 'SWEEP FAILED: run row wrong (%)', to_jsonb(r);
  end if;

  if not (select is_available from public.branch_product_availability
           where branch_id='b0000000-0000-0000-0000-000000000001'
             and product_id='a0000000-0000-0000-0000-000000000003') then
    raise exception 'SWEEP FAILED: expired snooze not reopened';
  end if;

  select * into e from public.branch_availability_events order by id desc limit 1;
  if e.action <> 'opened_auto' or e.source <> 'automatic' then
    raise exception 'SWEEP FAILED: not logged as automatic (%)', to_jsonb(e);
  end if;
  if e.changed_by is not null or e.actor_role is not null then
    raise exception 'SWEEP FAILED: an automatic reopen claimed an actor (%)', to_jsonb(e);
  end if;

  -- Idempotent: a second sweep finds nothing and writes no further event.
  v_run := public.branch_availability_sweep();
  if (select products_reopened from public.branch_availability_runs where id = v_run) <> 0 then
    raise exception 'SWEEP FAILED: second pass reopened rows again';
  end if;
  if (select count(*) from public.branch_availability_events where action='opened_auto') <> 1 then
    raise exception 'SWEEP FAILED: second pass wrote another event';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. THE RULE THAT MATTERS: an untimed closure is never auto-reopened.
--    This is the existing admin Branch Management toggle — a deliberate
--    delisting. Auto-reopening one would put a withdrawn item back on the menu.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','',true);
do $$
declare v_run bigint;
begin
  insert into public.branch_product_availability (branch_id, product_id, is_available)
  values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002', false)
  on conflict (branch_id, product_id) do update set is_available = false;

  if (select snoozed_until from public.branch_product_availability
       where branch_id='b0000000-0000-0000-0000-000000000001'
         and product_id='a0000000-0000-0000-0000-000000000002') is not null then
    raise exception 'FIXTURE FAILED: the untimed closure has a timer';
  end if;

  v_run := public.branch_availability_sweep();
  if (select products_reopened from public.branch_availability_runs where id = v_run) <> 0 then
    raise exception 'SWEEP FAILED: the sweeper reopened an UNTIMED closure';
  end if;
  if (select is_available from public.branch_product_availability
       where branch_id='b0000000-0000-0000-0000-000000000001'
         and product_id='a0000000-0000-0000-0000-000000000002') then
    raise exception 'SWEEP FAILED: an untimed closure was reopened';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The EXISTING admin path keeps working, and is now audited for free.
--    src/lib/api.ts writes this table with a plain PostgREST upsert that sends
--    only (branch_id, product_id, is_available).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000002',true);
do $$
declare n_before bigint; e public.branch_availability_events;
begin
  select count(*) into n_before from public.branch_availability_events;

  insert into public.branch_product_availability (branch_id, product_id, is_available)
  values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003', false)
  on conflict (branch_id, product_id) do update set is_available = false;

  select * into e from public.branch_availability_events order by id desc limit 1;
  if e.action <> 'closed' or e.changed_by <> 'd1000000-0000-0000-0000-000000000002' then
    raise exception 'AUDIT FAILED: the direct admin write was not audited (%)', to_jsonb(e);
  end if;
  if e.duration_minutes is not null or e.end_time is not null then
    raise exception 'AUDIT FAILED: an untimed close recorded a duration (%)', to_jsonb(e);
  end if;

  -- THE STALE-TIMER BUG: a snoozed row flipped back on by the column-partial
  -- upsert must not keep its old timer, or the next close inherits it.
  perform public.set_product_snooze(
    'b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003',
    30,'other',null);
  insert into public.branch_product_availability (branch_id, product_id, is_available)
  values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003', true)
  on conflict (branch_id, product_id) do update set is_available = true;

  if (select snoozed_until from public.branch_product_availability
       where branch_id='b0000000-0000-0000-0000-000000000002'
         and product_id='a0000000-0000-0000-0000-000000000003') is not null then
    raise exception 'NORMALIZE FAILED: a stale snoozed_until survived the admin toggle';
  end if;

  if (select count(*) from public.branch_availability_events) <= n_before then
    raise exception 'AUDIT FAILED: direct writes produced no events at all';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Exposure: the world-readable table must not carry staff identity or the
--     cashier's free text. bpa_select_public is `using (true)` for anon and
--     both clients request select('*').
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='branch_product_availability'
                and column_name in ('changed_by','reason_note')) then
    raise exception 'EXPOSURE FAILED: staff identity or free text is on the public table';
  end if;
  if has_table_privilege('anon','public.branch_availability_events','SELECT') then
    raise exception 'EXPOSURE FAILED: anon can read the availability audit';
  end if;
  if has_table_privilege('authenticated','public.branch_availability_events','INSERT')
     or has_table_privilege('authenticated','public.branch_availability_events','UPDATE')
     or has_table_privilege('authenticated','public.branch_availability_events','DELETE') then
    raise exception 'EXPOSURE FAILED: the audit is client-writable';
  end if;
  if has_function_privilege('authenticated','public.branch_availability_sweep()','EXECUTE')
     or has_function_privilege('anon','public.branch_availability_sweep()','EXECUTE') then
    raise exception 'PRIVILEGE FAILED: the sweeper is client-executable';
  end if;
end $$;

-- 11. Overlap protection is wired. A transaction-scoped advisory lock is
--     re-entrant within one transaction, so overlap cannot be provoked from a
--     single session; assert the guard structurally instead.
do $$
declare v_def text := pg_get_functiondef('public.branch_availability_sweep()'::regprocedure);
begin
  if position('pg_try_advisory_xact_lock' in v_def) = 0 then
    raise exception 'WIRING FAILED: the sweeper has no overlap guard';
  end if;
  if position('snoozed_until is not null' in v_def) = 0 then
    raise exception 'WIRING FAILED: the sweeper does not exclude untimed closures';
  end if;
end $$;

rollback;
