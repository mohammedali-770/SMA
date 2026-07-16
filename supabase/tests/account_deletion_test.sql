-- ============================================================================
-- DB-level behaviour test for the account-deletion workflow.
--
-- Runs against a THROWAWAY Postgres with all migrations applied (same harness as
-- the lazywait tests: `supabase db test` / a disposable DB). Each case RAISES
-- EXCEPTION on failure, so the whole script aborts non-zero if any assertion
-- fails; a clean run prints the final NOTICE and commits nothing (rolled back).
--
-- NOTE: this file requires a live Postgres and is NOT part of the Vitest/CI
-- suite (which has no database). It was authored but not executed in the
-- implementation environment. Run it locally before applying the migration.
--
-- Covers:
--   1. create_account_deletion_request is idempotent (repeat → same row).
--   2. The unique partial index forbids a SECOND active request per user.
--   3. anonymize_account_data strips order PII but PRESERVES amounts + number,
--      and deletes addresses + push devices.
--   4. After completion a new active request is allowed again.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- skip triggers/FKs for fixtures

do $$
declare
  v_uid      uuid := gen_random_uuid();
  v_req1     public.account_deletion_requests;
  v_req2     public.account_deletion_requests;
  v_order_id uuid := gen_random_uuid();
  v_name text; v_phone text; v_notes text; v_snap jsonb;
  v_total numeric; v_subtotal numeric; v_ordernum text;
  v_addr int; v_dev int;
  v_dupe boolean := false;
  v_uid2 uuid := gen_random_uuid();
  v_req5 public.account_deletion_requests;
  v_claimed int;
begin
  -- ---- Fixtures -----------------------------------------------------------
  insert into public.profiles (id, full_name, phone_number, email)
    values (v_uid, 'Real Customer', '+966555555555', 'real@example.com');

  insert into public.orders
    (id, order_number, customer_id, customer_name, customer_phone, branch_id,
     order_type, subtotal, total, payment_status, status, notes, address_snapshot)
  values
    (v_order_id, 'SM-TEST-DEL-1', v_uid, 'Real Customer', '+966555555555', gen_random_uuid(),
     'pickup', 100.00, 123.45, 'paid', 'delivered', 'ring the bell twice',
     jsonb_build_object('line1', '123 Secret Street'));

  insert into public.addresses (customer_id, latitude, longitude)
    values (v_uid, 24.7136, 46.6753);

  insert into public.push_devices (customer_id, expo_push_token, platform)
    values (v_uid, 'ExponentPushToken[acct-del-test]', 'android');

  -- ---- 1) Idempotent creation --------------------------------------------
  v_req1 := public.create_account_deletion_request(v_uid, 'reauth');
  v_req2 := public.create_account_deletion_request(v_uid, 'reauth');
  if v_req1.id is null or v_req1.id <> v_req2.id then
    raise exception 'FAIL(1): creation not idempotent (% vs %)', v_req1.id, v_req2.id;
  end if;
  if v_req1.status <> 'queued' or v_req1.identity_verified_at is null then
    raise exception 'FAIL(1): unexpected initial state (status=%, verified_at=%)', v_req1.status, v_req1.identity_verified_at;
  end if;

  -- ---- 2) One active request per user (unique partial index) --------------
  begin
    insert into public.account_deletion_requests (user_id, status) values (v_uid, 'queued');
    v_dupe := true;
  exception when unique_violation then
    v_dupe := false;
  end;
  if v_dupe then
    raise exception 'FAIL(2): a second active deletion request was allowed';
  end if;

  -- ---- 3) Anonymization strips PII, preserves financials ------------------
  perform public.anonymize_account_data(v_uid);

  select customer_name, customer_phone, notes, address_snapshot, total, subtotal, order_number
    into v_name, v_phone, v_notes, v_snap, v_total, v_subtotal, v_ordernum
    from public.orders where id = v_order_id;

  if v_name is not null or v_phone is not null or v_notes is not null or v_snap is not null then
    raise exception 'FAIL(3): order PII not anonymized (name=%, phone=%, notes=%, snap=%)', v_name, v_phone, v_notes, v_snap;
  end if;
  if v_total <> 123.45 or v_subtotal <> 100.00 or v_ordernum <> 'SM-TEST-DEL-1' then
    raise exception 'FAIL(3): order financials/number altered (total=%, subtotal=%, num=%)', v_total, v_subtotal, v_ordernum;
  end if;

  select count(*) into v_addr from public.addresses where customer_id = v_uid;
  select count(*) into v_dev  from public.push_devices where customer_id = v_uid;
  if v_addr <> 0 or v_dev <> 0 then
    raise exception 'FAIL(3): addresses/push_devices not deleted (addr=%, dev=%)', v_addr, v_dev;
  end if;

  -- Idempotent: a second anonymize run is a harmless no-op.
  perform public.anonymize_account_data(v_uid);

  -- ---- 4) Re-request allowed after completion -----------------------------
  update public.account_deletion_requests
     set status = 'completed', completed_at = now()
   where id = v_req1.id;
  -- Must NOT raise now that no active request exists.
  perform public.create_account_deletion_request(v_uid, 'otp');

  -- ---- 5) Partial-failure recovery: a request stuck 'processing' with an
  -- EXPIRED lease (a crashed processor run) is reclaimable; an actively-leased
  -- one is never double-claimed. ----------------------------------------------
  insert into public.profiles (id, full_name, phone_number) values (v_uid2, 'P2', '+966555000002');
  v_req5 := public.create_account_deletion_request(v_uid2, 'reauth');
  update public.account_deletion_requests
     set status = 'processing', locked_until = now() - interval '1 minute', lock_token = gen_random_uuid()
   where id = v_req5.id;
  select count(*) into v_claimed from public.claim_due_account_deletions(10, 300);
  if v_claimed < 1 then raise exception 'FAIL(5): stale processing lease was not reclaimed'; end if;
  -- Everything just claimed now holds a FRESH (future) lease → a second run gets none.
  select count(*) into v_claimed from public.claim_due_account_deletions(10, 300);
  if v_claimed <> 0 then raise exception 'FAIL(5): a freshly-leased request was double-claimed'; end if;

  raise notice 'account_deletion_test: ALL CASES PASSED';
end $$;

rollback;
