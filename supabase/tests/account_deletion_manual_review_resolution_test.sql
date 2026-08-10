-- ============================================================================
-- Account-deletion manual_review resolution.
-- ============================================================================
begin;

do $$
declare
  v_customer uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_customer), (v_admin)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, phone_number, role)
  values
    (v_customer, 'Deletion Review Customer', '+966500008801', 'customer'),
    (v_admin, 'Deletion Review Admin', '+966500008802', 'admin')
  on conflict (id) do update set role = excluded.role;

  insert into public.account_deletion_requests (
    id, user_id, status, verification_method, identity_verified_at,
    attempt_count, failure_code, failure_stage, manual_review_reason,
    next_attempt_at, locked_until, lock_token
  ) values (
    v_request, v_customer, 'manual_review', 'reauth', now() - interval '1 day',
    7, 'wait_limit_exceeded', 'blockers', 'active order exceeded wait SLA',
    null, now() + interval '1 hour', gen_random_uuid()
  );

  perform set_config('test.review_customer', v_customer::text, true);
  perform set_config('test.review_admin', v_admin::text, true);
  perform set_config('test.review_request', v_request::text, true);
end $$;

-- Case 1: non-admin cannot resolve a review.
do $$
declare v_state text; v_request uuid := current_setting('test.review_request')::uuid;
begin
  perform set_config('test.is_admin', 'false', true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.auth_uid', current_setting('test.review_customer'), true);
  set local role authenticated;
  begin
    perform public.resolve_account_deletion_request(v_request, 'retry', 'customer should not do this');
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'CASE 1 FAILED: customer SQLSTATE %, expected 42501', coalesce(v_state, 'SUCCESS');
  end if;
  raise notice 'CASE 1 ok: resolver is admin-only';
end $$;

-- Case 2: admin retry safely requeues, clears stale lease/failure budget and audits.
do $$
declare
  v_request uuid := current_setting('test.review_request')::uuid;
  v jsonb; v_row public.account_deletion_requests; v_audit public.account_deletion_resolution_audit;
begin
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform set_config('test.auth_uid', current_setting('test.review_admin'), true);
  set local role authenticated;
  v := public.resolve_account_deletion_request(v_request, 'retry', 'blocking order was investigated');
  reset role;

  select * into v_row from public.account_deletion_requests where id = v_request;
  if v_row.status <> 'queued' or v_row.attempt_count <> 0 or v_row.next_attempt_at is null
     or v_row.locked_until is not null or v_row.lock_token is not null
     or v_row.failure_code is not null or v_row.failure_stage is not null
     or v_row.manual_review_reason is not null then
    raise exception 'CASE 2 FAILED: retry state not reset safely: %', row_to_json(v_row);
  end if;
  if v->>'resolved_action' <> 'retry' then
    raise exception 'CASE 2 FAILED: wrong response %', v;
  end if;

  select * into v_audit from public.account_deletion_resolution_audit
   where request_id = v_request order by id desc limit 1;
  if v_audit.action <> 'retry'
     or v_audit.previous_reason <> 'active order exceeded wait SLA'
     or v_audit.resolution_note <> 'blocking order was investigated' then
    raise exception 'CASE 2 FAILED: audit row incorrect: %', row_to_json(v_audit);
  end if;
  raise notice 'CASE 2 ok: admin retry requeues through normal processor and audits the decision';
end $$;

-- Case 3: only manual_review can be resolved (no arbitrary queue rewrites).
do $$
declare v_state text; v_request uuid := current_setting('test.review_request')::uuid;
begin
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform set_config('test.auth_uid', current_setting('test.review_admin'), true);
  set local role authenticated;
  begin
    perform public.resolve_account_deletion_request(v_request, 'fail', 'should be rejected while queued');
    v_state := null;
  exception when others then v_state := sqlstate;
  end;
  reset role;
  if v_state is distinct from '22023' then
    raise exception 'CASE 3 FAILED: queued resolution SQLSTATE %, expected 22023', coalesce(v_state, 'SUCCESS');
  end if;
  if (select count(*) from public.account_deletion_resolution_audit where request_id=v_request) <> 1 then
    raise exception 'CASE 3 FAILED: rejected call wrote audit';
  end if;
  raise notice 'CASE 3 ok: resolver cannot rewrite a non-manual-review request';
end $$;

-- Recreate the escalation state as the trusted processor would for the terminal
-- failure case. This direct UPDATE is test setup only.
update public.account_deletion_requests
   set status='manual_review', attempt_count=9,
       manual_review_reason='second escalation',
       locked_until=now()+interval '1 hour', lock_token=gen_random_uuid(),
       next_attempt_at=null
 where id=current_setting('test.review_request')::uuid;

-- Case 4: fail makes the request terminal, clears lease, preserves an audit trail,
-- and therefore permits a fresh independently re-verified request later.
do $$
declare
  v_request uuid := current_setting('test.review_request')::uuid;
  v_customer uuid := current_setting('test.review_customer')::uuid;
  v public.account_deletion_requests; v_new public.account_deletion_requests;
  v_audit_count integer;
begin
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform set_config('test.auth_uid', current_setting('test.review_admin'), true);
  set local role authenticated;
  perform public.resolve_account_deletion_request(v_request, 'fail', 'cannot safely complete this request');
  reset role;

  select * into v from public.account_deletion_requests where id=v_request;
  if v.status <> 'failed' or v.failure_code <> 'manual_review_resolved_failed'
     or v.failure_stage <> 'manual_review' or v.next_attempt_at is not null
     or v.locked_until is not null or v.lock_token is not null then
    raise exception 'CASE 4 FAILED: terminal failure state incorrect: %', row_to_json(v);
  end if;

  select count(*) into v_audit_count from public.account_deletion_resolution_audit where request_id=v_request;
  if v_audit_count <> 2 then
    raise exception 'CASE 4 FAILED: expected 2 audit rows, got %', v_audit_count;
  end if;

  -- The partial unique index excludes failed, so a future request may be opened
  -- only through the ordinary creation path after identity re-verification.
  select * into v_new from public.create_account_deletion_request(v_customer, 'reauth');
  if v_new.id = v_request or v_new.status <> 'queued' or v_new.identity_verified_at is null then
    raise exception 'CASE 4 FAILED: fresh request not possible after terminal resolution: %', row_to_json(v_new);
  end if;
  raise notice 'CASE 4 ok: terminal failure releases the active-request dead end';
end $$;

rollback;
