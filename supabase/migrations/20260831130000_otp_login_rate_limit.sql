-- Rate-limit the REAL customer login OTP path.
--
-- WHAT IS UNPROTECTED TODAY. There are two OTP senders in
-- `supabase/functions/_shared/whatsappSend.ts`:
--
--   sendOtpViaWhatsApp()   — the phone-VERIFICATION path. Calls otp_begin_send,
--                            which enforces cooldown / per-hour / per-day and
--                            returns 'rate_limited'. Protected.
--   deliverOtpTemplate()   — the raw sender. No limiting of any kind.
--
-- `auth-send-sms-whatsapp` — the Supabase Auth Send SMS Hook, i.e. the path every
-- real customer login takes — calls deliverOtpTemplate DIRECTLY. So the login
-- path has no per-phone cooldown, no per-IP cap and no daily ceiling in our code.
-- The only throttle is whatever Supabase Auth's own SMS rate limit is set to,
-- which is dashboard state and is NOT verifiable from here.
--
-- Both failure directions are real: if that project-wide cap sits at a low
-- default, genuine customers are locked out on a busy evening; if it has been
-- raised, every attempted login is a BILLABLE Meta authentication-template
-- message that an attacker can pump.
--
-- WHY NOT JUST REUSE otp_begin_send. Because it does two things, and the login
-- path must only have one of them. It enforces the limits AND inserts an
-- `otp_challenges` row carrying a hashed OTP. On the login path Supabase Auth is
-- the sole OTP authority — the hook delivers a code Supabase already generated
-- and deliberately stores no challenge. Routing login through otp_begin_send
-- would mint a SECOND code, store it, and leave the verification path able to
-- match a code the customer was never sent. This function is therefore the
-- limit checks WITHOUT the challenge write.
--
-- WHY whatsapp_message_logs IS THE COUNTER. It already records one row per send
-- attempt — deliverOtpTemplate writes it on both paths — and it already carries
-- the index this needs, `(phone_e164, created_at desc)`, created alongside the
-- table in 20260710140000. No new table, and it counts ATTEMPTS rather than
-- challenges, which is the thing that actually costs money.
--
-- Both message types are counted, not just 'auth_login'. Counting only the login
-- type would let an attacker alternate between the two senders and get double
-- the budget.
--
-- HONEST LIMIT: this is a CHECK, not a RESERVATION. The counter row is written
-- after the send, so two simultaneous requests can both observe the same state
-- and both pass. It bounds the rate; it does not serialise it. Making it exact
-- would need a reservation row, which reintroduces exactly the challenge write
-- this function exists to avoid. For a login-delivery throttle, bounded is the
-- right trade — an attacker gains at most the concurrency window, not a bypass.
--
-- APPLYING THIS IS A SEPARATE §5 OWNER ACTION, and the paired
-- `auth-send-sms-whatsapp` deploy is another. Order matters: apply this FIRST.
-- The function calls this RPC, so deploying the function against a database
-- without it would make every login fail closed.

create or replace function public.otp_login_rate_limit(
  p_phone text,
  p_cooldown_seconds int,
  p_max_per_hour int,
  p_max_per_day int
)
returns table (allowed boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_last timestamptz;
  v_hour int;
  v_day  int;
begin
  -- Same three checks, same order, and the same defaults as otp_begin_send, so
  -- the two paths cannot drift into behaving differently for the same customer.
  select max(created_at) into v_last from public.whatsapp_message_logs
    where phone_e164 = p_phone and message_type in ('auth_login','otp_send');
  if v_last is not null
     and v_last > now() - make_interval(secs => greatest(0, coalesce(p_cooldown_seconds, 60))) then
    return query select false, 'cooldown'; return;
  end if;

  select count(*) into v_hour from public.whatsapp_message_logs
    where phone_e164 = p_phone and message_type in ('auth_login','otp_send')
      and created_at > now() - interval '1 hour';
  if v_hour >= greatest(1, coalesce(p_max_per_hour, 5)) then
    return query select false, 'hourly_limit'; return;
  end if;

  select count(*) into v_day from public.whatsapp_message_logs
    where phone_e164 = p_phone and message_type in ('auth_login','otp_send')
      and created_at > now() - interval '1 day';
  if v_day >= greatest(1, coalesce(p_max_per_day, 10)) then
    return query select false, 'daily_limit'; return;
  end if;

  return query select true, 'ok';
end $$;

-- Service-role only, matching otp_begin_send. A caller who could invoke this
-- directly would learn whether a given phone number has recently been sent a
-- code, which is a membership oracle over customer phone numbers.
revoke all on function public.otp_login_rate_limit(text,int,int,int) from public, anon, authenticated;
grant execute on function public.otp_login_rate_limit(text,int,int,int) to service_role;

comment on function public.otp_login_rate_limit(text,int,int,int) is
  'Cooldown / hourly / daily gate for the Supabase Auth Send SMS Hook login path, '
  'which cannot use otp_begin_send because that also writes an otp_challenges row '
  'and Supabase Auth is the sole OTP authority on that path. Counts send attempts '
  'in whatsapp_message_logs across both message types. A check, not a reservation.';
