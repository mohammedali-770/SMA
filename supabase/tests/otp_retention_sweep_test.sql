-- ============================================================================
-- purge_expired_otp_records — the OTP retention sweep
-- (migration 20260911120000_otp_retention_sweep).
--
-- WHY THIS EXISTS. The live Privacy Policy said "Verification codes: a short
-- period, then deleted" while nothing deleted them on a schedule: the oldest
-- `otp_challenges` row in Production was two months old, and its columns include
-- `phone_e164` and `ip_hash`. The sweep makes the statement true.
--
-- THE PROPERTY THAT MATTERS MOST IS WHAT IT MUST *NOT* DELETE. A sweep that is
-- too eager breaks customer login in two different ways: deleting a live
-- challenge fails a verification the customer is halfway through, and deleting a
-- recent reservation hands a fresh rate-limit allowance to a number that has
-- already spent it. Both bounds are asserted at the boundary, not past it.
--
-- PROPERTIES ASSERTED
--   1. a challenge past expiry + the 24h grace is deleted;
--   2. a LIVE challenge is never deleted, however old the row;
--   3. a challenge just inside the grace survives (boundary, not past it);
--   4. a reservation older than two days is deleted;
--   5. a reservation inside the daily budget window SURVIVES — the limiter
--      depends on it;
--   6. the sweep is idempotent and safe on an empty database;
--   7. it is not callable by a customer.
-- ============================================================================

-- Wrapped in a transaction and rolled back at the end, like the other suites:
-- it keeps the fixture out of the shared template AND it is what makes
-- `set local role` work in case 7 — outside a transaction that is a silent
-- no-op, which is exactly how the first version of this file "passed" the
-- privilege check while still running as superuser.
begin;

-- Clean slate for this suite.
delete from public.otp_challenges;
delete from public.otp_send_reservations;

-- ============================================================================
-- 1-3. CHALLENGES: expiry plus a grace, and nothing live
-- ============================================================================
do $$
declare v_res jsonb; v_n int;
begin
  insert into public.otp_challenges
    (phone_e164, channel, purpose, otp_hash, otp_salt, expires_at, created_at)
  values
    -- (a) long dead: expired two days ago
    ('+966500000001', 'whatsapp', 'login', 'h', 's', now() - interval '2 days',  now() - interval '2 days'),
    -- (b) just inside the grace: expired 23 hours ago
    ('+966500000002', 'whatsapp', 'login', 'h', 's', now() - interval '23 hours', now() - interval '23 hours'),
    -- (c) LIVE, but written long ago — expiry is what decides, not age
    ('+966500000003', 'whatsapp', 'login', 'h', 's', now() + interval '5 minutes', now() - interval '30 days');

  v_res := public.purge_expired_otp_records();

  if (v_res ->> 'challenges_deleted')::int <> 1 then
    raise exception 'FAIL 1: expected exactly 1 challenge deleted, got %', v_res ->> 'challenges_deleted';
  end if;

  select count(*) into v_n from public.otp_challenges where phone_e164 = '+966500000001';
  if v_n <> 0 then raise exception 'FAIL 1: the long-dead challenge survived'; end if;

  select count(*) into v_n from public.otp_challenges where phone_e164 = '+966500000003';
  if v_n <> 1 then
    raise exception 'FAIL 2: a LIVE challenge was deleted — this breaks a login in progress';
  end if;

  select count(*) into v_n from public.otp_challenges where phone_e164 = '+966500000002';
  if v_n <> 1 then
    raise exception 'FAIL 3: a challenge 23h past expiry was deleted; the grace is 24h, and the boundary is the point';
  end if;

  raise notice 'cases 1-3 ok -- dead challenges go, live ones and the grace window stay';
end $$;

-- ============================================================================
-- 4-5. RESERVATIONS: the limiter's window is untouchable
-- ============================================================================
do $$
declare v_res jsonb; v_n int;
begin
  delete from public.otp_challenges;
  delete from public.otp_send_reservations;

  insert into public.otp_send_reservations (phone_e164, channel, purpose, created_at)
  values
    ('+966500000010', 'whatsapp', 'login', now() - interval '3 days'),   -- past the 2-day rule
    ('+966500000011', 'whatsapp', 'login', now() - interval '20 hours'), -- INSIDE the daily budget
    ('+966500000012', 'whatsapp', 'login', now() - interval '30 minutes');

  v_res := public.purge_expired_otp_records();

  if (v_res ->> 'reservations_deleted')::int <> 1 then
    raise exception 'FAIL 4: expected exactly 1 reservation deleted, got %', v_res ->> 'reservations_deleted';
  end if;

  select count(*) into v_n from public.otp_send_reservations where phone_e164 = '+966500000011';
  if v_n <> 1 then
    raise exception 'FAIL 5: a reservation inside the 1-day budget was deleted — the limiter would hand out a fresh allowance';
  end if;
  select count(*) into v_n from public.otp_send_reservations where phone_e164 = '+966500000012';
  if v_n <> 1 then raise exception 'FAIL 5: a 30-minute-old reservation was deleted'; end if;

  raise notice 'cases 4-5 ok -- stale reservations go, the rate-limit window survives';
end $$;

-- ============================================================================
-- 6. Idempotent, and safe on an empty database
-- ============================================================================
do $$
declare v_res jsonb;
begin
  v_res := public.purge_expired_otp_records();
  if (v_res ->> 'challenges_deleted')::int <> 0
     or (v_res ->> 'reservations_deleted')::int <> 0 then
    raise exception 'FAIL 6: a second run deleted more rows: %', v_res;
  end if;

  delete from public.otp_challenges;
  delete from public.otp_send_reservations;
  v_res := public.purge_expired_otp_records();
  if not (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 6: the sweep did not run against an empty database: %', v_res;
  end if;

  raise notice 'case 6 ok -- idempotent, and fine with nothing to do';
end $$;

-- ============================================================================
-- 7. A customer cannot run it
-- ============================================================================
set local role authenticated;
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.purge_expired_otp_records();
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL 7: a customer executed purge_expired_otp_records directly';
  end if;
  raise notice 'case 7 ok -- the sweep is not callable by a customer';
end $$;
reset role;

rollback;
