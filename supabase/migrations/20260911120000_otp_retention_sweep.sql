-- ============================================================================
-- OTP RETENTION SWEEP
--
-- WHY THIS EXISTS. The live Privacy Policy says, under HOW LONG WE KEEP IT:
--
--     "Verification codes: a short period, then deleted."
--
-- Nothing performed that. `otp_challenges` retained every row it had ever
-- written -- the oldest in Production dated from 10 July, two months old at the
-- time of writing -- and the only thing that ever deleted from it was
-- `anonymize_account_data`, which runs when a customer deletes their account.
-- No scheduled job touched it. Found by reading the whole live policy against
-- the code, the same sweep that found three false statements in the loyalty
-- terms.
--
-- The retained columns are the point: `phone_e164` and `ip_hash`. The code
-- itself is stored as `otp_hash` + `otp_salt`, so this was never a credential
-- exposure -- it is a personal-data retention statement the system did not
-- honour, in the document that describes the operator's PDPL obligations.
--
-- THE FIX IS THE SWEEP, NOT THE WORDING. The policy states the correct
-- intention; the code was what disagreed with it. Rewording it to match the
-- behaviour would have made the document honest by lowering the promise, which
-- is the wrong direction for a retention commitment.
--
-- WHAT IS SAFE TO DELETE, and why each bound is where it is.
--
-- `otp_challenges` -- every reader (`otp_get_active_challenge`, `otp_consume`,
-- `otp_increment_attempt`, `otp_begin_send`) works on a challenge that is still
-- live, selected by id or by an `expires_at > now()` predicate. A row past its
-- own expiry can never be resurrected into a successful verification, so it has
-- no functional purpose. It is kept for a further 24 hours anyway, purely so a
-- support question asked the same day can still be answered.
--
-- `otp_send_reservations` -- this is the rate-limit ledger, and its windows are
-- 60 s / 1 hour / 1 day. `otp_reserve_send` ALREADY deletes rows older than two
-- days, so the retention rule for this table is not new here. What is new is
-- that the existing purge only ever runs FOR THE PHONE CURRENTLY ASKING: a
-- number that requested a code once and never came back kept its row forever.
-- This sweep applies the identical two-day rule to every phone, so it cannot
-- change the behaviour of the limiter -- it only reaches the rows the existing
-- rule never got to.
--
-- DELIBERATELY NOT CONFIGURABLE. A retention window exposed as a setting is a
-- retention window somebody eventually sets to a year. The bounds are in the
-- function, and changing them is a migration and a policy review together.
-- ============================================================================

create extension if not exists pg_cron;

-- ---- 0. Foreign-job guard (idempotent) --------------------------------------
-- Raise only if a job with this name exists that is NOT ours. Re-applying is
-- safe: cron.schedule(name, ...) upserts by name.
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'otp-retention-sweep' limit 1;
  if v_cmd is not null and v_cmd not ilike '%purge_expired_otp_records%' then
    raise exception 'a cron job named "otp-retention-sweep" already exists and is not this sweep: %', v_cmd;
  end if;
end $$;

-- ---- 1. The sweep -----------------------------------------------------------
create or replace function public.purge_expired_otp_records()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_challenges   integer := 0;
  v_reservations integer := 0;
begin
  -- Past expiry, plus a 24-hour tail. NOT `consumed_at is not null` -- an
  -- abandoned challenge that was never consumed is exactly the row most worth
  -- clearing, since it belongs to somebody who never completed a login.
  delete from public.otp_challenges
   where expires_at < now() - interval '24 hours';
  get diagnostics v_challenges = row_count;

  -- The same two days `otp_reserve_send` already applies per phone. Anything
  -- newer is still inside the daily budget and must survive, or the limiter
  -- would silently forget a customer's recent sends and hand out a fresh
  -- allowance.
  delete from public.otp_send_reservations
   where created_at < now() - interval '2 days';
  get diagnostics v_reservations = row_count;

  return jsonb_build_object(
    'ran', true,
    'challenges_deleted', v_challenges,
    'reservations_deleted', v_reservations
  );
end $$;

-- No client ever calls this. The cron job runs as the table owner.
revoke all on function public.purge_expired_otp_records() from public, anon, authenticated;
grant execute on function public.purge_expired_otp_records() to service_role;

-- ---- 2. Schedule -------------------------------------------------------------
-- Daily at 00:40 UTC (03:40 in Riyadh), after the loyalty expiry job at 00:20
-- and well away from any ordering traffic. cron.job stores only this bare
-- internal call -- no credentials, no HTTP, no external target.
select cron.schedule(
  'otp-retention-sweep',
  '40 0 * * *',
  'select public.purge_expired_otp_records();'
);

-- ---- 3. Post-schedule self-verification --------------------------------------
-- One transaction: if the end state is not exactly one canonical job, or the
-- function does not have the bounds this migration documents, raise and roll
-- everything back.
do $$
declare v_src text;
begin
  if (select count(*) from cron.job where jobname = 'otp-retention-sweep') <> 1
     or (select count(*) from cron.job
          where jobname = 'otp-retention-sweep'
            and schedule = '40 0 * * *'
            and btrim(command) = 'select public.purge_expired_otp_records();') <> 1 then
    raise exception 'otp retention verification failed: otp-retention-sweep is not in the canonical single-job state';
  end if;

  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_expired_otp_records';

  -- The two-day reservation bound is the one that could break the rate limiter
  -- if it were ever shortened, so it is asserted rather than trusted.
  if v_src not like '%interval ''2 days''%' then
    raise exception 'otp retention verification failed: the reservation bound is not 2 days, which the login rate limiter depends on';
  end if;
  if v_src not like '%interval ''24 hours''%' then
    raise exception 'otp retention verification failed: the challenge grace is not 24 hours';
  end if;
end $$;
