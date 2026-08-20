-- ============================================================================
-- Per-branch modifier availability, and a regression net for the ONE migration
-- in this work that re-emits place_order.
--
-- Half of this file is not about modifiers at all: it pins pricing, VAT, the
-- product guard and the delivery checks, because the risk in re-emitting a
-- 300-line function is not the two lines you meant to add.
--
-- Impersonation is through request.jwt.claim.sub — see ops_roles_test.sql for why
-- the test.* GUCs cannot express the operations roles.
-- ============================================================================
begin;

-- Seed fixtures: product 001 "Spicy Double Beef" at 32.00 carries the REQUIRED
-- heat-level group (min_select 1) with Mild/Hot at +0 and Volcano at +2.
\set branch  '''b0000000-0000-0000-0000-000000000001'''
\set beef    '''a0000000-0000-0000-0000-000000000001'''
\set mild    '''80000000-0000-0000-0000-000000000001'''
\set hot     '''80000000-0000-0000-0000-000000000002'''
\set volcano '''80000000-0000-0000-0000-000000000003'''

do $$
declare
  v_cust  uuid := '01000000-0000-0000-0000-000000000001';
  v_opa   uuid := '01000000-0000-0000-0000-000000000002';
  v_opb   uuid := '01000000-0000-0000-0000-000000000003';
  v_cc    uuid := '01000000-0000-0000-0000-000000000004';
begin
  insert into auth.users(id) values (v_cust),(v_opa),(v_opb),(v_cc) on conflict (id) do nothing;
  insert into public.profiles(id, full_name, role) values
    (v_cust,'Mod Customer','customer'),
    (v_opa,'Operator A','branch_staff'),
    (v_opb,'Operator B','branch_staff'),
    (v_cc,'Call Centre','call_center')
  on conflict (id) do update set role = excluded.role;
  insert into public.staff_branch_assignments(user_id, branch_id) values
    (v_opa,'b0000000-0000-0000-0000-000000000001'),
    (v_opb,'b0000000-0000-0000-0000-000000000002')
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

-- Place a cash pickup order for the beef with one chosen modifier. Returns the
-- SQLSTATE, or null on success.
create or replace function pg_temp.order_with(p_modifier uuid) returns text
language plpgsql as $$
declare v_state text; v_prev text;
begin
  v_prev := coalesce(current_setting('request.jwt.claim.sub', true), '');
  perform set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000001',true);
  begin
    perform public.place_order(
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'pickup'::public.order_type,
      jsonb_build_array(jsonb_build_object(
        'product_id','a0000000-0000-0000-0000-000000000001',
        'quantity',1,
        'modifier_ids', jsonb_build_array(p_modifier::text))),
      null, null, null, 0, null, 'cash');
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('request.jwt.claim.sub', v_prev, true);
  return v_state;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Baseline, and the pricing regression that matters most.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000001',true);
do $$
declare o public.orders;
begin
  o := public.place_order(
    'b0000000-0000-0000-0000-000000000001'::uuid,
    'pickup'::public.order_type,
    jsonb_build_array(jsonb_build_object(
      'product_id','a0000000-0000-0000-0000-000000000001','quantity',1,
      'modifier_ids', jsonb_build_array('80000000-0000-0000-0000-000000000003'))),
    null, null, null, 0, null, 'cash');

  -- 32.00 base + 2.00 Volcano = 34.00, VAT-INCLUSIVE, so VAT is extracted:
  -- 34 - 34/1.15 = 4.43. If the re-emission broke the pricing or VAT maths this
  -- is where it shows, not in a modifier test.
  if o.subtotal <> 34.00 then
    raise exception 'PRICING REGRESSION: subtotal was %, expected 34.00', o.subtotal;
  end if;
  if o.vat_amount <> 4.43 then
    raise exception 'VAT REGRESSION: vat was %, expected 4.43', o.vat_amount;
  end if;
  if o.total <> 34.00 then
    raise exception 'TOTAL REGRESSION: total was %, expected 34.00', o.total;
  end if;
  if o.delivery_fee <> 0 then
    raise exception 'PRICING REGRESSION: pickup charged a delivery fee';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Snoozing one modifier blocks only that option.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000002',true);
do $$
declare e public.branch_availability_events;
begin
  perform public.set_modifier_snooze(
    'b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
    30,'out_of_stock','ran out of mild sauce');

  if pg_temp.order_with('80000000-0000-0000-0000-000000000001') is null then
    raise exception 'GUARD FAILED: a snoozed modifier still placed an order';
  end if;
  -- The rest of the group is untouched: closing one option is not closing the item.
  if pg_temp.order_with('80000000-0000-0000-0000-000000000002') is not null then
    raise exception 'GUARD FAILED: snoozing one modifier blocked a sibling option';
  end if;

  select * into e from public.branch_availability_events order by id desc limit 1;
  if e.action <> 'closed' or e.modifier_id <> '80000000-0000-0000-0000-000000000001'
     or e.product_id is not null then
    raise exception 'AUDIT FAILED: modifier close not logged correctly (%)', to_jsonb(e);
  end if;
  if e.actor_role <> 'branch_staff' or e.reason_note <> 'ran out of mild sauce' then
    raise exception 'AUDIT FAILED: actor or note missing (%)', to_jsonb(e);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Lazy expiry: an elapsed timer stops blocking BEFORE the sweeper runs.
--    Without this a customer waits up to a full tick after the option is back.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.branch_modifier_availability
     set snoozed_until = now() - interval '1 second'
   where branch_id='b0000000-0000-0000-0000-000000000001'
     and modifier_id='80000000-0000-0000-0000-000000000001';

  if pg_temp.order_with('80000000-0000-0000-0000-000000000001') is not null then
    raise exception 'LAZY EXPIRY FAILED: an elapsed modifier snooze still blocked an order';
  end if;

  -- Reopen it properly. The row above is still `is_available = false` with an
  -- elapsed timer, i.e. exactly what the sweeper collects — leaving it here
  -- would silently inflate case 4's modifiers_reopened count and make that
  -- assertion stop measuring what it claims to.
  perform public.clear_modifier_snooze(
    'b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001');
  if exists (select 1 from public.branch_modifier_availability
              where branch_id='b0000000-0000-0000-0000-000000000001'
                and modifier_id='80000000-0000-0000-0000-000000000001'
                and (is_available = false or snoozed_until is not null)) then
    raise exception 'CLEAR FAILED: clear_modifier_snooze left the row closed or timed';
  end if;
end $$;

-- The same rule now applies to products.
do $$
begin
  insert into public.branch_product_availability (branch_id, product_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
          false, now() - interval '1 second')
  on conflict (branch_id, product_id) do update
    set is_available = false, snoozed_until = now() - interval '1 second';

  if pg_temp.order_with('80000000-0000-0000-0000-000000000002') is not null then
    raise exception 'LAZY EXPIRY FAILED: an elapsed product snooze still blocked an order';
  end if;

  -- ...but an UNTIMED closure still blocks. That distinction is the whole point.
  update public.branch_product_availability
     set is_available = false, snoozed_until = null
   where branch_id='b0000000-0000-0000-0000-000000000001'
     and product_id='a0000000-0000-0000-0000-000000000001';
  if pg_temp.order_with('80000000-0000-0000-0000-000000000002') is null then
    raise exception 'GUARD FAILED: an untimed product closure stopped blocking';
  end if;

  update public.branch_product_availability set is_available = true
   where branch_id='b0000000-0000-0000-0000-000000000001'
     and product_id='a0000000-0000-0000-0000-000000000001';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The sweeper handles modifiers with its own counter.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000002',true);
select public.set_modifier_snooze(
  'b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002',
  30,'equipment_down',null);
update public.branch_modifier_availability set snoozed_until = now() - interval '1 minute'
 where modifier_id='80000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','',true);

do $$
declare v_run bigint; r public.branch_availability_runs; e public.branch_availability_events;
begin
  v_run := public.branch_availability_sweep();
  select * into r from public.branch_availability_runs where id = v_run;
  if r.status <> 'success' or r.modifiers_reopened <> 1 then
    raise exception 'SWEEP FAILED: run row wrong (%)', to_jsonb(r);
  end if;
  if r.products_reopened <> 0 then
    raise exception 'SWEEP FAILED: a modifier reopen incremented products_reopened';
  end if;

  select * into e from public.branch_availability_events order by id desc limit 1;
  if e.action <> 'opened_auto' or e.source <> 'automatic'
     or e.modifier_id <> '80000000-0000-0000-0000-000000000002' then
    raise exception 'SWEEP FAILED: modifier reopen not logged as automatic (%)', to_jsonb(e);
  end if;
end $$;

-- An untimed modifier closure is never auto-reopened.
do $$
declare v_run bigint;
begin
  insert into public.branch_modifier_availability (branch_id, modifier_id, is_available)
  values ('b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000003', false)
  on conflict (branch_id, modifier_id) do update set is_available = false, snoozed_until = null;

  v_run := public.branch_availability_sweep();
  if (select modifiers_reopened from public.branch_availability_runs where id = v_run) <> 0 then
    raise exception 'SWEEP FAILED: the sweeper reopened an UNTIMED modifier closure';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Authorization mirrors product snoozing exactly.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cases text[][] := array[
    ['01000000-0000-0000-0000-000000000004','call centre'],
    ['01000000-0000-0000-0000-000000000003','an operator from another branch'],
    ['01000000-0000-0000-0000-000000000001','a customer']
  ];
  v_case text[];
begin
  foreach v_case slice 1 in array v_cases loop
    perform set_config('request.jwt.claim.sub', v_case[1], true);
    begin
      perform public.set_modifier_snooze(
        'b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
        30,'out_of_stock',null);
      raise exception 'AUTH FAILED: % snoozed a modifier', v_case[2];
    exception when sqlstate '42501' then null;
    end;
  end loop;
end $$;

-- 6. Validation — timed closures only, closed reason vocabulary.
select set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000002',true);
do $$
declare v_minutes integer;
begin
  begin
    perform public.set_modifier_snooze(
      'b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
      null,'out_of_stock',null);
    raise exception 'VALIDATION FAILED: a null duration was accepted';
  exception when sqlstate '22004' then null;
  end;
  foreach v_minutes in array array[0, -1, 1441] loop
    begin
      perform public.set_modifier_snooze(
        'b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
        v_minutes,'out_of_stock',null);
      raise exception 'VALIDATION FAILED: duration % accepted', v_minutes;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform public.set_modifier_snooze(
      'b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
      30,'no_such_reason',null);
    raise exception 'VALIDATION FAILED: an unknown reason code was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Re-emission hazards.
-- ---------------------------------------------------------------------------
do $$
begin
  -- 20260724200000 revoked place_order from `authenticated` and wrapped it in
  -- place_customer_order. `create or replace function` preserves the ACL, so the
  -- re-emission must NOT have re-granted it.
  if has_function_privilege('authenticated',
      'public.place_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)', 'EXECUTE') then
    raise exception 'REGRESSION: the re-emission handed place_order back to authenticated';
  end if;
  if has_function_privilege('anon',
      'public.place_customer_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)', 'EXECUTE') then
    raise exception 'REGRESSION: anon holds execute on the customer order wrapper';
  end if;

  -- The delivery guards must still be present in the re-emitted body.
  if position('Delivery is currently closed for this branch' in
      pg_get_functiondef('public.place_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)'::regprocedure)) = 0 then
    raise exception 'REGRESSION: the delivery guard vanished from place_order';
  end if;
  if position('point_in_active_delivery_zone' in
      pg_get_functiondef('public.place_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)'::regprocedure)) = 0 then
    raise exception 'REGRESSION: the delivery-zone check vanished from place_order';
  end if;
end $$;

-- 8. Exposure: both clients read this table, so it carries no staff identity.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='branch_modifier_availability'
                and column_name in ('changed_by','reason_note')) then
    raise exception 'EXPOSURE FAILED: staff identity or free text is on the public modifier table';
  end if;
end $$;

rollback;
