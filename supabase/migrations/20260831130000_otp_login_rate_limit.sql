-- Rate-limit the REAL customer login OTP path — atomically, and on a budget
-- shared with the phone-verification path.
--
-- WHAT IS UNPROTECTED TODAY. There are two OTP senders in
-- `supabase/functions/_shared/whatsappSend.ts`:
--
--   sendOtpViaWhatsApp()   — the phone-VERIFICATION path. Calls otp_begin_send,
--                            which enforces cooldown / per-hour / per-day.
--   deliverOtpTemplate()   — the raw sender. No limiting of any kind.
--
-- `auth-send-sms-whatsapp` — the Supabase Auth Send SMS Hook, i.e. the path every
-- real customer login takes — calls deliverOtpTemplate DIRECTLY. So login has no
-- per-phone cooldown, no per-IP cap and no daily ceiling in our code. The only
-- throttle is Supabase Auth's own project-wide SMS limit, which is dashboard
-- state and NOT verifiable from here. Every attempt is a BILLABLE Meta
-- authentication-template message.
--
-- ============================================================================
-- WHY THIS IS A RESERVATION AND NOT A CHECK — the first version of this
-- migration got it wrong, and the correction is the whole point of the redesign.
--
-- That version counted rows in `whatsapp_message_logs`, which is written AFTER
-- the Meta POST returns. Under concurrency every simultaneous request reads the
-- same pre-send history, every one sees room, and every one sends. A burst is
-- therefore limited by nothing at all — which defeats exactly the billing abuse
-- this migration exists to stop. It was documented as "a check, not a
-- reservation" that "bounds the rate"; review pointed out that under a burst it
-- does not bound anything, and that is correct.
--
-- So the budget is now consumed BEFORE the send, under a per-phone lock:
--
--   1. pg_advisory_xact_lock(hashtext(phone)) — serialises callers for the SAME
--      number only. Two different customers never contend.
--   2. count reservations in the window;
--   3. refuse, or INSERT the reservation and return its id.
--
-- Steps 2 and 3 are inside the lock, so count-then-insert cannot interleave.
-- The lock is transaction-scoped: it releases on commit or rollback, so a failed
-- call cannot wedge a phone number.
--
-- `otp_release_send` exists so a FAILED delivery does not burn a real customer's
-- budget — a Meta outage would otherwise consume every customer's daily quota
-- while delivering nothing. Bounded residual risk, stated rather than hidden: a
-- caller who can reliably force delivery failure for one number can retry that
-- number freely. It costs our API calls, not delivered messages, and it cannot
-- reach any other number.
--
-- ============================================================================
-- WHY otp_begin_send CHANGES TOO — the budget was one-directional.
--
-- The first version claimed that counting both message types stopped an attacker
-- alternating between the two senders. It did not: otp_begin_send counts
-- `otp_challenges` and never sees login sends at all, so a caller could spend the
-- login allowance and then a SEPARATE verification allowance in the same hour.
-- The test asserted only the direction that happened to work.
--
-- Both senders now take their limits from the same reservation table, under the
-- same per-phone lock, so the budget is genuinely shared in both directions.
--
-- ONE DELIBERATE ASYMMETRY: otp_begin_send does NOT release. That path has always
-- consumed budget at challenge creation rather than on delivery success, and
-- changing that is a behaviour change to a live, working path — not something to
-- smuggle into a rate-limit fix. Its reservation is created with the challenge
-- and left alone.
--
-- FIRST-APPLY NOTE: the reservation table starts empty, so per-phone limits reset
-- once at apply time. There are no live customers being throttled today.
--
-- APPLYING THIS IS A §5 OWNER ACTION, and it now implies TWO function deploys —
-- `auth-send-sms-whatsapp` and `whatsapp-send-otp`. Apply this FIRST: both
-- functions call RPCs defined here.

create table if not exists public.otp_send_reservations (
  id           uuid primary key default gen_random_uuid(),
  phone_e164   text        not null,
  channel      text        not null default 'whatsapp',
  purpose      text,
  created_at   timestamptz not null default now()
);

-- The only access pattern: "this phone, recent first".
create index if not exists otp_send_reservations_phone_idx
  on public.otp_send_reservations (phone_e164, created_at desc);

alter table public.otp_send_reservations enable row level security;
-- No policy, by design: this is a service-role ledger. It holds customer phone
-- numbers, and any read of it reveals who has recently been sent a code.
revoke all on public.otp_send_reservations from public, anon, authenticated;

comment on table public.otp_send_reservations is
  'Shared per-phone OTP send budget for BOTH senders. A row is a consumed send, '
  'written before delivery under a per-phone advisory lock so concurrent requests '
  'cannot all pass the same check. Deny-by-default: no RLS policy, service-role only.';

-- ---------------------------------------------------------------------------
-- Reserve one send, or refuse. Returns the reservation id so a failed delivery
-- can hand the budget back.
create or replace function public.otp_reserve_send(
  p_phone text,
  p_purpose text,
  p_cooldown_seconds int,
  p_max_per_hour int,
  p_max_per_day int
)
returns table (allowed boolean, reason text, reservation_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_last timestamptz;
  v_hour int;
  v_day  int;
  v_id   uuid;
begin
  -- Per-phone, transaction-scoped. Everything below is serialised for this
  -- number and unaffected for every other.
  perform pg_advisory_xact_lock(hashtext(p_phone)::bigint);

  -- Opportunistic purge while the lock is already held: rows past the widest
  -- window can never affect a decision again. Bounded to this phone, so it is a
  -- few rows and needs no cron.
  delete from public.otp_send_reservations
   where phone_e164 = p_phone and created_at < now() - interval '2 days';

  select max(created_at) into v_last from public.otp_send_reservations
   where phone_e164 = p_phone;
  if v_last is not null
     and v_last > now() - make_interval(secs => greatest(0, coalesce(p_cooldown_seconds, 60))) then
    return query select false, 'cooldown', null::uuid; return;
  end if;

  select count(*) into v_hour from public.otp_send_reservations
   where phone_e164 = p_phone and created_at > now() - interval '1 hour';
  if v_hour >= greatest(1, coalesce(p_max_per_hour, 5)) then
    return query select false, 'hourly_limit', null::uuid; return;
  end if;

  select count(*) into v_day from public.otp_send_reservations
   where phone_e164 = p_phone and created_at > now() - interval '1 day';
  if v_day >= greatest(1, coalesce(p_max_per_day, 10)) then
    return query select false, 'daily_limit', null::uuid; return;
  end if;

  insert into public.otp_send_reservations (phone_e164, channel, purpose)
  values (p_phone, 'whatsapp', p_purpose)
  returning id into v_id;

  return query select true, 'ok', v_id;
end $$;

revoke all on function public.otp_reserve_send(text,text,int,int,int) from public, anon, authenticated;
grant execute on function public.otp_reserve_send(text,text,int,int,int) to service_role;

-- ---------------------------------------------------------------------------
-- Hand a reservation back when delivery failed. Idempotent and id-scoped: it can
-- only remove the row the caller was given, never free somebody else's budget.
create or replace function public.otp_release_send(p_reservation_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_reservation_id is null then return; end if;
  delete from public.otp_send_reservations where id = p_reservation_id;
end $$;

revoke all on function public.otp_release_send(uuid) from public, anon, authenticated;
grant execute on function public.otp_release_send(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- otp_begin_send: same signature, same return shape, same behaviour for its
-- caller — but its limits now come from the SHARED reservation table instead of
-- from otp_challenges, so login sends count against it and vice versa.
--
-- Redefined in full because a function body cannot be patched. The challenge
-- insert, the defaults, the reason strings and the return shape are unchanged.
create or replace function public.otp_begin_send(
  p_phone text, p_channel text, p_purpose text,
  p_otp_hash text, p_salt text, p_expires_at timestamptz,
  p_max_attempts int, p_cooldown_seconds int, p_max_per_hour int, p_max_per_day int,
  p_ip_hash text default null, p_device_hash text default null, p_provider_message_id text default null
)
returns table (allowed boolean, reason text, challenge_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_last timestamptz;
  v_hour int;
  v_day  int;
  v_id   uuid;
begin
  -- Same per-phone lock as otp_reserve_send, so the two senders serialise against
  -- each other rather than each seeing a stale count of the other's traffic.
  perform pg_advisory_xact_lock(hashtext(p_phone)::bigint);

  delete from public.otp_send_reservations
   where phone_e164 = p_phone and created_at < now() - interval '2 days';

  select max(created_at) into v_last from public.otp_send_reservations
   where phone_e164 = p_phone;
  if v_last is not null
     and v_last > now() - make_interval(secs => greatest(0, coalesce(p_cooldown_seconds, 60))) then
    return query select false, 'cooldown', null::uuid; return;
  end if;

  select count(*) into v_hour from public.otp_send_reservations
   where phone_e164 = p_phone and created_at > now() - interval '1 hour';
  if v_hour >= greatest(1, coalesce(p_max_per_hour, 5)) then
    return query select false, 'hourly_limit', null::uuid; return;
  end if;

  select count(*) into v_day from public.otp_send_reservations
   where phone_e164 = p_phone and created_at > now() - interval '1 day';
  if v_day >= greatest(1, coalesce(p_max_per_day, 10)) then
    return query select false, 'daily_limit', null::uuid; return;
  end if;

  -- Consume the shared budget. NOT released on delivery failure: this path has
  -- always counted at challenge creation, and changing that is a separate
  -- behaviour decision rather than part of a rate-limit fix.
  insert into public.otp_send_reservations (phone_e164, channel, purpose)
  values (p_phone, coalesce(p_channel, 'whatsapp'), p_purpose);

  insert into public.otp_challenges
    (phone_e164, channel, purpose, otp_hash, otp_salt, expires_at, max_attempts,
     status, ip_hash, device_hash, provider_message_id)
  values
    (p_phone, p_channel, p_purpose, p_otp_hash, p_salt, p_expires_at, coalesce(p_max_attempts, 5),
     'pending', p_ip_hash, p_device_hash, p_provider_message_id)
  returning id into v_id;

  return query select true, 'ok', v_id;
end $$;

revoke all on function public.otp_begin_send(text,text,text,text,text,timestamptz,int,int,int,int,text,text,text) from public, anon, authenticated;
grant execute on function public.otp_begin_send(text,text,text,text,text,timestamptz,int,int,int,int,text,text,text) to service_role;
