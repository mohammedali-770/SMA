-- ============================================================================
-- otp_reserve_send / otp_release_send / otp_begin_send — the SHARED OTP budget
-- (migration 20260831130000_otp_login_rate_limit).
--
-- WHY THIS EXISTS. `auth-send-sms-whatsapp` (the Supabase Auth Send SMS Hook —
-- every real customer login) called `deliverOtpTemplate` DIRECTLY: the raw sender,
-- with no cooldown, hourly or daily limit. The protected sender could not be
-- reused because it also writes an `otp_challenges` row, and on that path
-- Supabase Auth is the sole OTP authority.
--
-- THE PROPERTY THAT MATTERS MOST IS CONCURRENCY. The first version of this
-- migration counted `whatsapp_message_logs`, which is written AFTER delivery, so
-- a simultaneous burst all read the same empty history and all passed — the limit
-- bound nothing at all. The redesign reserves under
-- `pg_advisory_xact_lock(hashtext(phone))`. Asserting that from a single session
-- would prove nothing, so the concurrency case uses dblink for a GENUINE second
-- session, exactly as `order_refund_claim_liveness_test.sql` does.
--
-- PROPERTIES ASSERTED
--   1. a clean number is allowed and gets a reservation id;
--   2. the budget is consumed BEFORE delivery — a second call is refused
--      immediately, with no message log involved;
--   3. cooldown / hourly / daily each refuse, at the boundary not past it;
--   4. release hands the budget back, and is id-scoped and idempotent;
--   5. THE SHARED BUDGET, IN BOTH DIRECTIONS — login spends against
--      otp_begin_send and vice versa. The old version only held one way;
--   6. otp_begin_send still creates its challenge and returns its id;
--   7. limits are per phone;
--   8. CONCURRENCY: a second session cannot slip a reservation past a full
--      budget while the first holds the lock (dblink; SKIPs loudly if absent);
--   9. exposure: service_role only, and the table is deny-by-default.
--
-- No provider, payment, Lazywait, email, push or SMS call is made.
-- ============================================================================

begin;

create function pg_temp.res(p_phone text, p_age interval)
returns void language plpgsql as $$
begin
  insert into public.otp_send_reservations (phone_e164, channel, purpose, created_at)
  values (p_phone, 'whatsapp', 'test', now() - p_age);
end $$;

create function pg_temp.gate(p_phone text, p_cool int default 60, p_hour int default 5, p_day int default 10)
returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.otp_reserve_send(p_phone, 'auth_login', p_cool, p_hour, p_day);
  return r.reason;
end $$;

do $$
declare
  v_id  uuid;
  v_id2 uuid;
  r     record;
  v_ch  uuid;
begin
  -- 1 + 2. clean number allowed, and the budget is consumed BEFORE any delivery
  select * into r from public.otp_reserve_send('+966500000001','auth_login',60,5,10);
  if not r.allowed or r.reservation_id is null then
    raise exception 'FAILED: a clean number was refused, or no reservation id came back';
  end if;
  v_id := r.reservation_id;
  -- nothing was delivered and nothing was logged; the very next call must still
  -- be refused, which is the difference between a reservation and a check.
  if pg_temp.gate('+966500000001', 60) <> 'cooldown' then
    raise exception 'FAILED: budget was not consumed before delivery (this is a check, not a reservation)';
  end if;

  -- 4. release hands it back
  perform public.otp_release_send(v_id);
  if pg_temp.gate('+966500000001', 60) <> 'ok' then
    raise exception 'FAILED: release did not free the reservation';
  end if;
  -- idempotent, and a null is a no-op rather than an error
  perform public.otp_release_send(v_id);
  perform public.otp_release_send(null);
  -- id-scoped: releasing one number's reservation must not free another's
  select reservation_id into v_id2 from public.otp_reserve_send('+966500000012','auth_login',60,5,10);
  perform public.otp_release_send(v_id2);
  if pg_temp.gate('+966500000001', 60) <> 'cooldown' then
    raise exception 'FAILED: releasing a DIFFERENT reservation freed this number''s budget';
  end if;

  -- 3. hourly boundary: 4 against a cap of 5 allowed, the 5th refused
  perform pg_temp.res('+966500000003', interval '10 minutes');
  perform pg_temp.res('+966500000003', interval '20 minutes');
  perform pg_temp.res('+966500000003', interval '30 minutes');
  perform pg_temp.res('+966500000003', interval '40 minutes');
  if pg_temp.gate('+966500000003', 60, 5, 100) <> 'ok' then
    raise exception 'FAILED: 4 reservations against a cap of 5 were refused (off-by-one)';
  end if;
  -- that call consumed one, so the number now holds 5
  if pg_temp.gate('+966500000003', 60, 5, 100) <> 'cooldown' then
    raise exception 'FAILED: expected the cooldown to bite before the hourly cap';
  end if;
  if pg_temp.gate('+966500000003', 0, 5, 100) <> 'hourly_limit' then
    raise exception 'FAILED: 5 reservations against a cap of 5 were allowed';
  end if;
  -- rows outside the window stop counting
  update public.otp_send_reservations set created_at = now() - interval '90 minutes'
   where phone_e164 = '+966500000003';
  if pg_temp.gate('+966500000003', 0, 5, 100) <> 'ok' then
    raise exception 'FAILED: reservations older than an hour still counted hourly';
  end if;

  -- 3b. daily, independent of hourly
  perform pg_temp.res('+966500000004', interval '2 hours');
  perform pg_temp.res('+966500000004', interval '4 hours');
  perform pg_temp.res('+966500000004', interval '6 hours');
  perform pg_temp.res('+966500000004', interval '8 hours');
  perform pg_temp.res('+966500000004', interval '10 hours');
  if pg_temp.gate('+966500000004', 0, 100, 5) <> 'daily_limit' then
    raise exception 'FAILED: 5 reservations in a day against a daily cap of 5 were allowed';
  end if;
  if pg_temp.gate('+966500000004', 0, 100, 100) <> 'ok' then
    raise exception 'FAILED: the daily refusal was not actually the daily rule';
  end if;

  -- 5. THE SHARED BUDGET, BOTH DIRECTIONS.
  -- (a) login spend is visible to otp_begin_send
  perform pg_temp.res('+966500000005', interval '10 minutes');
  perform pg_temp.res('+966500000005', interval '20 minutes');
  perform pg_temp.res('+966500000005', interval '30 minutes');
  select * into r from public.otp_begin_send('+966500000005','whatsapp','phone_verification',
      'h','s', now()+interval '5 min', 5, 0, 3, 100);
  if r.allowed then
    raise exception 'FAILED: login sends did not count against the verification budget';
  end if;
  -- (b) verification spend is visible to otp_reserve_send. THIS is the direction
  -- the previous version silently failed: otp_begin_send counted only
  -- otp_challenges, so login never saw it.
  select * into r from public.otp_begin_send('+966500000006','whatsapp','phone_verification',
      'h','s', now()+interval '5 min', 5, 0, 5, 100);
  if not r.allowed then raise exception 'FAILED: a clean number was refused by otp_begin_send'; end if;
  v_ch := r.challenge_id;
  if pg_temp.gate('+966500000006', 60) <> 'cooldown' then
    raise exception 'FAILED: verification sends did not count against the login budget';
  end if;

  -- 6. otp_begin_send still does its own job
  if v_ch is null then raise exception 'FAILED: otp_begin_send returned no challenge_id'; end if;
  if not exists (select 1 from public.otp_challenges where id = v_ch and phone_e164='+966500000006') then
    raise exception 'FAILED: otp_begin_send did not create its challenge row';
  end if;

  -- 7. per phone
  if pg_temp.gate('+966500000009', 60, 1, 1) <> 'ok' then
    raise exception 'FAILED: one number''s traffic throttled a different number';
  end if;

  raise notice 'OTP RESERVATION BUDGET OK';
end $$;

-- 9. exposure -----------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon','public.otp_reserve_send(text,text,int,int,int)','execute')
     or has_function_privilege('authenticated','public.otp_reserve_send(text,text,int,int,int)','execute')
     or has_function_privilege('anon','public.otp_release_send(uuid)','execute')
     or has_function_privilege('authenticated','public.otp_release_send(uuid)','execute') then
    raise exception 'FAILED: a reservation function is callable by anon/authenticated — it is a membership oracle over customer phone numbers';
  end if;
  if not has_function_privilege('service_role','public.otp_reserve_send(text,text,int,int,int)','execute') then
    raise exception 'FAILED: service_role cannot reserve — the hook would fail open permanently';
  end if;
  if has_table_privilege('anon','public.otp_send_reservations','select')
     or has_table_privilege('authenticated','public.otp_send_reservations','select') then
    raise exception 'FAILED: otp_send_reservations is readable — it reveals who was recently sent a code';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.otp_send_reservations'::regclass) then
    raise exception 'FAILED: RLS is not enabled on otp_send_reservations';
  end if;
  raise notice 'OTP RESERVATION EXPOSURE OK';
end $$;

rollback;

-- ============================================================================
-- 8. CONCURRENCY — the property the first design got wrong, tested properly.
--
-- A NOTE ON WHAT AN EARLIER DRAFT OF THIS BLOCK DID NOT TEST. It seeded five
-- COMMITTED reservations and had a second session reserve against them. That
-- passes with or without the advisory lock — committed rows are visible to
-- everybody — so it proved the budget arithmetic and nothing about serialisation.
--
-- The real question is whether a second session can COUNT while a first session
-- has counted but not yet committed its insert. That is the window a burst slips
-- through. So: session A opens a transaction and reserves, holding the
-- transaction-scoped advisory lock. Session B then attempts the same phone with a
-- short `lock_timeout`. With the lock, B waits and times out (SQLSTATE 55P03).
-- Without it, B returns immediately having seen A's pre-insert state — which is
-- precisely the bug.
--
-- Committed fixtures and a real second session, so this cannot run inside the
-- rollback above.
-- ============================================================================
do $$
declare
  v_conn  text := coalesce(nullif(current_setting('test.dblink_conninfo', true), ''), '');
  v_phone text := '+966500000099';
  v_state text;
begin
  if v_conn = '' then
    raise notice 'SKIP otp concurrency (no test.dblink_conninfo)'; return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    begin execute 'create extension dblink';
    exception when others then
      raise notice 'SKIP otp concurrency (dblink unavailable)'; return;
    end;
  end if;

  delete from public.otp_send_reservations where phone_e164 = v_phone;

  -- Session A: begin, reserve, DO NOT COMMIT. It now holds the per-phone lock and
  -- has an uncommitted reservation row.
  perform dblink_connect('otp_holder', v_conn);
  perform dblink_exec('otp_holder', 'begin');
  perform * from dblink('otp_holder',
    format('select allowed from public.otp_reserve_send(%L, %L, 0, 5, 100)', v_phone, 'auth_login')
  ) as t(allowed boolean);

  -- Session B (this one): the same phone must NOT be reservable while A holds the
  -- lock. Time out rather than hang the suite.
  begin
    set local lock_timeout = '400ms';
    perform * from public.otp_reserve_send(v_phone, 'auth_login', 0, 5, 100);
    -- Reaching here means B counted straight past A's in-flight reservation.
    v_state := 'NOT_SERIALISED';
  exception
    when lock_not_available then v_state := 'BLOCKED';
    when others then v_state := 'ERROR:' || sqlstate;
  end;

  perform dblink_exec('otp_holder', 'rollback');
  perform dblink_disconnect('otp_holder');
  delete from public.otp_send_reservations where phone_e164 = v_phone;

  if v_state <> 'BLOCKED' then
    raise exception 'FAILED: a second session was not serialised against an in-flight reservation (%). A concurrent burst would bypass the limit.', v_state;
  end if;

  raise notice 'OTP CONCURRENCY OK (second session blocked on the per-phone lock)';
end $$;
