-- ============================================================================
-- otp_login_rate_limit() — the throttle on the REAL customer login path
-- (migration 20260831130000_otp_login_rate_limit).
--
-- WHY THIS FUNCTION EXISTS AT ALL, restated so the suite is readable alone:
-- `auth-send-sms-whatsapp` (the Supabase Auth Send SMS Hook, i.e. every real
-- customer login) calls `deliverOtpTemplate` DIRECTLY. That is the raw sender —
-- no cooldown, no hourly cap, no daily ceiling. The protected sender,
-- `sendOtpViaWhatsApp`, cannot be reused on that path because it also writes an
-- `otp_challenges` row holding a hashed OTP, and on the login path Supabase Auth
-- is the sole OTP authority; minting a second code there would let verification
-- match a code the customer was never sent.
--
-- PROPERTIES ASSERTED
--   1. a clean number is allowed;
--   2. cooldown refuses a second send inside the window;
--   3. the hourly cap refuses once reached, and counts to the boundary not past;
--   4. the daily cap refuses independently of the hourly one;
--   5. counting spans BOTH message types — an attacker must not be able to
--      alternate between the login and verification senders for double budget;
--   6. limits are PER PHONE — one number's traffic never throttles another;
--   7. rows outside the window do not count;
--   8. the function is service_role-only (it is a membership oracle over
--      customer phone numbers otherwise).
--
-- No provider, payment, Lazywait, email, push or SMS call is made. Fixtures are
-- confined to whatsapp_message_logs and rolled back.
-- ============================================================================

begin;

-- Helper: insert a send-attempt row at a chosen age.
create function pg_temp.wm(p_phone text, p_type text, p_age interval)
returns void language plpgsql as $$
begin
  insert into public.whatsapp_message_logs (phone_e164, message_type, template_name, created_at)
  values (p_phone, p_type, 'test_template', now() - p_age);
end $$;

create function pg_temp.gate(p_phone text, p_cool int default 60, p_hour int default 5, p_day int default 10)
returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.otp_login_rate_limit(p_phone, p_cool, p_hour, p_day);
  return r.reason;
end $$;

do $$
begin
  -- 1. clean number -----------------------------------------------------------
  if pg_temp.gate('+966500000001') <> 'ok' then
    raise exception 'FAILED: a number with no history was not allowed';
  end if;

  -- 2. cooldown ---------------------------------------------------------------
  perform pg_temp.wm('+966500000002','auth_login', interval '10 seconds');
  if pg_temp.gate('+966500000002', 60) <> 'cooldown' then
    raise exception 'FAILED: a send 10s ago did not trip a 60s cooldown';
  end if;
  -- and clears once the window passes
  if pg_temp.gate('+966500000002', 5) <> 'ok' then
    raise exception 'FAILED: a send 10s ago still tripped a 5s cooldown';
  end if;

  -- 3. hourly cap, at the boundary --------------------------------------------
  -- 4 sends, cap 5 → still allowed. Ages avoid the cooldown so this tests the
  -- hourly rule rather than re-testing the cooldown.
  perform pg_temp.wm('+966500000003','auth_login', interval '10 minutes');
  perform pg_temp.wm('+966500000003','auth_login', interval '20 minutes');
  perform pg_temp.wm('+966500000003','auth_login', interval '30 minutes');
  perform pg_temp.wm('+966500000003','auth_login', interval '40 minutes');
  if pg_temp.gate('+966500000003', 60, 5, 100) <> 'ok' then
    raise exception 'FAILED: 4 sends against a cap of 5 were refused (off-by-one)';
  end if;
  perform pg_temp.wm('+966500000003','auth_login', interval '50 minutes');
  if pg_temp.gate('+966500000003', 60, 5, 100) <> 'hourly_limit' then
    raise exception 'FAILED: 5 sends against a cap of 5 were allowed';
  end if;

  -- 7. rows outside the window do not count ------------------------------------
  -- The same five sends, aged past an hour, must stop counting.
  update public.whatsapp_message_logs
     set created_at = now() - interval '90 minutes'
   where phone_e164 = '+966500000003';
  if pg_temp.gate('+966500000003', 60, 5, 100) <> 'ok' then
    raise exception 'FAILED: sends older than an hour still counted against the hourly cap';
  end if;

  -- 4. daily cap, independent of the hourly one --------------------------------
  -- Six sends spread across the day: under any hourly cap, over a daily cap of 5.
  perform pg_temp.wm('+966500000004','auth_login', interval '2 hours');
  perform pg_temp.wm('+966500000004','auth_login', interval '4 hours');
  perform pg_temp.wm('+966500000004','auth_login', interval '6 hours');
  perform pg_temp.wm('+966500000004','auth_login', interval '8 hours');
  perform pg_temp.wm('+966500000004','auth_login', interval '10 hours');
  if pg_temp.gate('+966500000004', 60, 100, 5) <> 'daily_limit' then
    raise exception 'FAILED: 5 sends in a day against a daily cap of 5 were allowed';
  end if;
  -- ...and a generous daily cap lets the same history through, proving it was the
  -- DAILY rule refusing and not something else.
  if pg_temp.gate('+966500000004', 60, 100, 100) <> 'ok' then
    raise exception 'FAILED: the daily refusal was not actually the daily rule';
  end if;

  -- 5. both message types count ------------------------------------------------
  -- THE ANTI-ALTERNATION PROPERTY. If this counted only 'auth_login', an attacker
  -- could alternate between the two senders and get double the budget.
  perform pg_temp.wm('+966500000005','otp_send', interval '10 minutes');
  perform pg_temp.wm('+966500000005','otp_send', interval '20 minutes');
  perform pg_temp.wm('+966500000005','auth_login', interval '30 minutes');
  if pg_temp.gate('+966500000005', 60, 3, 100) <> 'hourly_limit' then
    raise exception 'FAILED: verification-path sends did not count toward the login cap';
  end if;

  -- 6. limits are per phone -----------------------------------------------------
  if pg_temp.gate('+966500000009', 60, 1, 1) <> 'ok' then
    raise exception 'FAILED: one number''s traffic throttled a different number';
  end if;

  raise notice 'OTP LOGIN RATE LIMIT OK';
end $$;

-- 8. exposure -----------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.otp_login_rate_limit(text,int,int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.otp_login_rate_limit(text,int,int,int)', 'execute') then
    raise exception 'FAILED: otp_login_rate_limit is callable by anon/authenticated — it is a membership oracle over customer phone numbers';
  end if;
  if not has_function_privilege('service_role', 'public.otp_login_rate_limit(text,int,int,int)', 'execute') then
    raise exception 'FAILED: service_role cannot execute otp_login_rate_limit — the hook would fail closed';
  end if;
  raise notice 'OTP LOGIN RATE LIMIT EXPOSURE OK';
end $$;

rollback;
