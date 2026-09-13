-- ============================================================================
-- Branch → call-centre delivery closure requests (20260916120000).
--
-- IMPERSONATION NOTE. As in ops_roles_test.sql, branch_availability_snooze_test.sql
-- and branch_delivery_control_test.sql, this suite impersonates through
-- request.jwt.claim.sub rather than the test.* GUCs: the CI harness overrides
-- current_app_role() so any test.* setting forces admin|accountant|customer,
-- which cannot express call_center or branch_staff.
--
-- The suite is weighted toward WHAT MUST NOT HAPPEN. The single largest risk in
-- this feature is that adding a request channel quietly hands a branch the
-- ability to close delivery. Cases 2, 3 and 11 exist for that alone.
--
-- Single transaction, rolled back. Disposable/local database only.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid := 'f1000000-0000-0000-0000-000000000001';
  v_op    uuid := 'f1000000-0000-0000-0000-000000000002';
  v_cc    uuid := 'f1000000-0000-0000-0000-000000000003';
  v_op2   uuid := 'f1000000-0000-0000-0000-000000000004';
  v_cust  uuid := 'f1000000-0000-0000-0000-000000000005';
begin
  insert into auth.users(id) values (v_admin),(v_op),(v_cc),(v_op2),(v_cust)
  on conflict (id) do nothing;

  insert into public.profiles(id, full_name, role) values
    (v_admin,'Req Admin','admin'),
    (v_op,   'Req Branch Operator','branch_staff'),
    (v_cc,   'Req Call Centre','call_center'),
    (v_op2,  'Other Branch Operator','branch_staff'),
    (v_cust, 'Req Customer','customer')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

  insert into public.staff_branch_assignments(user_id, branch_id)
  values (v_op, 'b0000000-0000-0000-0000-000000000001')
  on conflict (user_id) do update set branch_id = excluded.branch_id;

  -- A second branch operator pinned to a DIFFERENT branch, so cross-branch
  -- filing can be tested rather than assumed impossible.
  insert into public.branches (id, name_en, name_ar, is_active, delivery_enabled)
  values ('b0000000-0000-0000-0000-0000000000ff','Req Second Branch','فرع الاختبار الثاني', true, true)
  on conflict (id) do update set is_active = true, delivery_enabled = true;

  insert into public.staff_branch_assignments(user_id, branch_id)
  values (v_op2, 'b0000000-0000-0000-0000-0000000000ff')
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

create or replace function pg_temp.as_user(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, true); $$;

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

-- ---- CASE 1: a branch operator can file a request for its OWN branch --------
do $$
declare v_out jsonb; v_n integer;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
  v_out := public.request_branch_delivery_pause(
    'b0000000-0000-0000-0000-000000000001', 60, 'no_driver', 'Both riders called in sick');

  if v_out ->> 'status' <> 'pending' then
    raise exception 'CASE 1: expected pending, got %', v_out ->> 'status';
  end if;

  select count(*) into v_n from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-000000000001' and status = 'pending';
  if v_n <> 1 then raise exception 'CASE 1: expected 1 pending row, got %', v_n; end if;

  raise notice 'CASE 1 OK — branch can file';
end $$;

-- ---- CASE 2: FILING CHANGED NOTHING. The whole point of "request only". -----
do $$
declare v_closed boolean; v_until timestamptz;
begin
  select delivery_temporarily_closed, delivery_closed_until
    into v_closed, v_until
    from public.branches where id = 'b0000000-0000-0000-0000-000000000001';

  if v_closed then
    raise exception 'CASE 2: filing a request CLOSED DELIVERY — request-only is broken';
  end if;
  if v_until is not null then
    raise exception 'CASE 2: filing a request set a reopen time';
  end if;
  raise notice 'CASE 2 OK — filing changed no delivery state';
end $$;

-- ---- CASE 3: a branch operator STILL cannot close delivery directly ---------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
  v_state := pg_temp.err($q$
    select public.set_branch_delivery_pause(
      'b0000000-0000-0000-0000-000000000001', 30, 'no_driver', null) $q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 3: branch operator could pause delivery (sqlstate %) — the 2026-08-20 boundary moved', v_state;
  end if;
  raise notice 'CASE 3 OK — branch still cannot pause delivery';
end $$;

-- ---- CASE 4: the call centre cannot FILE a request --------------------------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000003');
  v_state := pg_temp.err($q$
    select public.request_branch_delivery_pause(
      'b0000000-0000-0000-0000-0000000000ff', 30, 'weather', null) $q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 4: call centre filed a request to itself (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 4 OK — call centre cannot file';
end $$;

-- ---- CASE 5: a branch cannot file for ANOTHER branch ------------------------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000004');   -- pinned elsewhere
  v_state := pg_temp.err($q$
    select public.request_branch_delivery_pause(
      'b0000000-0000-0000-0000-000000000001', 30, 'no_driver', null) $q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 5: operator filed for a branch it is not pinned to (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 5 OK — filing is branch-scoped';
end $$;

-- ---- CASE 6: an ordinary customer cannot file ------------------------------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000005');
  v_state := pg_temp.err($q$
    select public.request_branch_delivery_pause(
      'b0000000-0000-0000-0000-000000000001', 30, 'other', null) $q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 6: a customer filed a request (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 6 OK — customers cannot file';
end $$;

-- ---- CASE 7: only one open request per branch ------------------------------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
  v_state := pg_temp.err($q$
    select public.request_branch_delivery_pause(
      'b0000000-0000-0000-0000-000000000001', 45, 'weather', null) $q$);
  if v_state is distinct from '23505' then
    raise exception 'CASE 7: a second open request was allowed (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 7 OK — one open request per branch';
end $$;

-- ---- CASE 8: the branch cannot ANSWER its own request -----------------------
do $$
declare v_state text; v_id uuid;
begin
  select id into v_id from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-000000000001' and status = 'pending';

  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
  v_state := pg_temp.err(format(
    'select public.resolve_branch_delivery_request(%L, true, null, null)', v_id));
  if v_state is distinct from '42501' then
    raise exception 'CASE 8: the branch answered its own request (sqlstate %) — self-approval', v_state;
  end if;
  raise notice 'CASE 8 OK — branch cannot self-approve';
end $$;

-- ---- CASE 9: the call centre ACCEPTS, and delivery closes -------------------
do $$
declare v_id uuid; v_out jsonb; v_closed boolean; v_until timestamptz; v_status text;
begin
  select id into v_id from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-000000000001' and status = 'pending';

  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000003');
  v_out := public.resolve_branch_delivery_request(v_id, true, null, 'Sending a driver from Nasserah');

  if v_out ->> 'status' <> 'accepted' then
    raise exception 'CASE 9: expected accepted, got %', v_out ->> 'status';
  end if;
  if (v_out ->> 'applied_minutes')::int <> 60 then
    raise exception 'CASE 9: expected the requested 60 minutes, got %', v_out ->> 'applied_minutes';
  end if;

  select delivery_temporarily_closed, delivery_closed_until
    into v_closed, v_until from public.branches
   where id = 'b0000000-0000-0000-0000-000000000001';
  if not v_closed then
    raise exception 'CASE 9: accepting did not close delivery';
  end if;
  if v_until is null then
    raise exception 'CASE 9: accepting produced an UNTIMED closure — the sweeper would never reopen it';
  end if;

  select status into v_status from public.branch_delivery_requests where id = v_id;
  if v_status <> 'accepted' then
    raise exception 'CASE 9: request row not marked accepted, got %', v_status;
  end if;
  raise notice 'CASE 9 OK — accept closes delivery with a reopen time';
end $$;

-- ---- CASE 10: accepting wrote the branch audit trail, with the branch's reason
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.branch_delivery_events
   where branch_id = 'b0000000-0000-0000-0000-000000000001'
     and reason_code = 'no_driver';
  if v_n < 1 then
    raise exception 'CASE 10: no audit event carrying the branch reason — accept bypassed set_branch_delivery_pause';
  end if;
  raise notice 'CASE 10 OK — accept reused the pause RPC and its audit trail';
end $$;

-- ---- CASE 11: an already-answered request cannot be answered twice ----------
do $$
declare v_id uuid; v_state text;
begin
  select id into v_id from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-000000000001' and status = 'accepted';
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000003');
  v_state := pg_temp.err(format(
    'select public.resolve_branch_delivery_request(%L, false, null, null)', v_id));
  if v_state is distinct from '22023' then
    raise exception 'CASE 11: a resolved request was answered again (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 11 OK — resolution is once-only';
end $$;

-- ---- CASE 12: filing is refused while delivery is already closed ------------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
  v_state := pg_temp.err($q$
    select public.request_branch_delivery_pause(
      'b0000000-0000-0000-0000-000000000001', 30, 'no_driver', null) $q$);
  if v_state is distinct from '22023' then
    raise exception 'CASE 12: filed a request against already-closed delivery (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 12 OK — no request against an already-closed branch';
end $$;

-- ---- CASE 13: DECLINE leaves delivery running ------------------------------
do $$
declare v_id uuid; v_out jsonb; v_closed boolean; v_note text;
begin
  -- Reopen the branch and file afresh at the second branch, which is untouched.
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
  perform public.request_branch_delivery_pause(
    'b0000000-0000-0000-0000-0000000000ff', 90, 'kitchen_overload', 'Fryer down');

  select id into v_id from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-0000000000ff' and status = 'pending';

  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000003');
  v_out := public.resolve_branch_delivery_request(v_id, false, null, 'Driver reassigned instead');

  if v_out ->> 'status' <> 'declined' then
    raise exception 'CASE 13: expected declined, got %', v_out ->> 'status';
  end if;

  select delivery_temporarily_closed into v_closed from public.branches
   where id = 'b0000000-0000-0000-0000-0000000000ff';
  if v_closed then
    raise exception 'CASE 13: declining CLOSED delivery';
  end if;

  select resolution_note into v_note from public.branch_delivery_requests where id = v_id;
  if v_note is distinct from 'Driver reassigned instead' then
    raise exception 'CASE 13: the decline note was not kept, got %', v_note;
  end if;
  raise notice 'CASE 13 OK — decline changes nothing and keeps the reason';
end $$;

-- ---- CASE 14: an EXPIRED request cannot be accepted -------------------------
do $$
declare v_id uuid; v_state text; v_status text; v_closed boolean;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
  perform public.request_branch_delivery_pause(
    'b0000000-0000-0000-0000-0000000000ff', 30, 'weather', null);

  select id into v_id from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-0000000000ff' and status = 'pending';

  -- Age it past its TTL.
  update public.branch_delivery_requests
     set expires_at = now() - interval '1 minute' where id = v_id;

  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000003');
  -- Returns rather than raises, so the retirement survives. A raising version
  -- rolls its own UPDATE back and leaves the request pending forever.
  declare v_out jsonb;
  begin
    v_out := public.resolve_branch_delivery_request(v_id, true, null, null);
    if v_out ->> 'status' <> 'expired' then
      raise exception 'CASE 14: an expired request returned %, expected expired', v_out ->> 'status';
    end if;
    if (v_out ->> 'applied')::boolean then
      raise exception 'CASE 14: an expired request reported applied = true';
    end if;
  end;

  select status into v_status from public.branch_delivery_requests where id = v_id;
  if v_status <> 'expired' then
    raise exception 'CASE 14: the expired request was not retired, status %', v_status;
  end if;

  select delivery_temporarily_closed into v_closed from public.branches
   where id = 'b0000000-0000-0000-0000-0000000000ff';
  if v_closed then
    raise exception 'CASE 14: a REFUSED accept still closed delivery';
  end if;
  raise notice 'CASE 14 OK — expiry is refused and retired, and closes nothing';
end $$;

-- ---- CASE 15: a stale pending row does not block a fresh request ------------
do $$
declare v_out jsonb; v_n integer;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
  perform public.request_branch_delivery_pause(
    'b0000000-0000-0000-0000-0000000000ff', 30, 'other', null);
  update public.branch_delivery_requests
     set expires_at = now() - interval '1 minute'
   where branch_id = 'b0000000-0000-0000-0000-0000000000ff' and status = 'pending';

  v_out := public.request_branch_delivery_pause(
    'b0000000-0000-0000-0000-0000000000ff', 30, 'no_driver', null);
  if v_out ->> 'status' <> 'pending' then
    raise exception 'CASE 15: a stale pending row blocked a fresh request';
  end if;

  select count(*) into v_n from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-0000000000ff' and status = 'pending';
  if v_n <> 1 then
    raise exception 'CASE 15: expected exactly 1 pending row after retiring the stale one, got %', v_n;
  end if;
  raise notice 'CASE 15 OK — stale requests are retired, not queued';
end $$;

-- ---- CASE 16: the branch may WITHDRAW its own waiting request ---------------
do $$
declare v_id uuid; v_out jsonb; v_state text;
begin
  select id into v_id from public.branch_delivery_requests
   where branch_id = 'b0000000-0000-0000-0000-0000000000ff' and status = 'pending';

  -- The OTHER branch's operator must not be able to withdraw it.
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
  v_state := pg_temp.err(format(
    'select public.cancel_branch_delivery_request(%L)', v_id));
  if v_state is distinct from '42501' then
    raise exception 'CASE 16: a foreign branch withdrew the request (sqlstate %)', v_state;
  end if;

  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
  v_out := public.cancel_branch_delivery_request(v_id);
  if v_out ->> 'status' <> 'cancelled' then
    raise exception 'CASE 16: withdraw did not cancel, got %', v_out ->> 'status';
  end if;
  raise notice 'CASE 16 OK — withdraw is branch-scoped and works';
end $$;

-- ---- CASE 17: validation bounds are enforced -------------------------------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
  v_state := pg_temp.err($q$
    select public.request_branch_delivery_pause(
      'b0000000-0000-0000-0000-0000000000ff', 1441, 'no_driver', null) $q$);
  if v_state is distinct from '22023' then
    raise exception 'CASE 17a: over-long request accepted (sqlstate %)', v_state;
  end if;

  v_state := pg_temp.err($q$
    select public.request_branch_delivery_pause(
      'b0000000-0000-0000-0000-0000000000ff', 30, 'not_a_reason', null) $q$);
  if v_state is distinct from '22023' then
    raise exception 'CASE 17b: invalid reason accepted (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 17 OK — duration and reason are validated';
end $$;

-- ---- CASE 18: RLS — a customer cannot READ the request table ---------------
do $$
declare v_n integer;
begin
  set local role authenticated;
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000005');
  select count(*) into v_n from public.branch_delivery_requests;
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 18: a customer read % request rows', v_n;
  end if;
  raise notice 'CASE 18 OK — requests are invisible to customers';
end $$;

-- ---- CASE 19: the gates are pinned at SOURCE level, and the branch is
-- ---- blocked TWICE. Mutation testing found that CASE 8 passes even when
-- ---- resolve's own gate is widened to admit a branch operator -- because the
-- ---- accept path calls set_branch_delivery_pause, which refuses them anyway.
-- ---- That defence-in-depth is real and is a direct consequence of reusing the
-- ---- pause RPC rather than forking it, but it means CASE 8 alone proves less
-- ---- than it appears to. These assertions close that gap.
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_branch_delivery_request';
  if v_src like '%is_branch_operator%' then
    raise exception 'CASE 19a: resolve admits a branch operator -- self-approval is reachable';
  end if;
  if v_src not like '%public.set_branch_delivery_pause(%' then
    raise exception 'CASE 19b: accept no longer reuses set_branch_delivery_pause -- the second gate is gone';
  end if;
  if v_src like '%update public.branches%' then
    raise exception 'CASE 19c: resolve writes branches directly, bypassing the pause RPC and its audit trail';
  end if;

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_branch_delivery_pause';
  if v_src like '%is_call_center%' then
    raise exception 'CASE 19d: filing admits the call centre';
  end if;
  if v_src like '%update public.branches%' then
    raise exception 'CASE 19e: FILING writes branches -- request-only is broken at the source';
  end if;

  -- And the thing this whole feature must never do.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_branch_delivery_pause';
  if v_src like '%is_branch_operator%' then
    raise exception 'CASE 19f: set_branch_delivery_pause now admits branch operators';
  end if;

  raise notice 'CASE 19 OK — gates pinned at source; branch blocked at both layers';
end $$;

rollback;
