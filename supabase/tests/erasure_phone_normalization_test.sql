-- Erasure must purge phone-keyed rows regardless of the stored phone format,
-- and must never report a purge it did not perform.
--
-- THE DEFECT THIS PINS
-- `anonymize_account_data` read the phone from `profiles.phone_number` and
-- compared it raw against `phone_e164`:
--
--     select phone_number into v_phone from public.profiles where id = p_user_id;
--     delete from public.otp_challenges where phone_e164 = v_phone;
--
-- `profiles.phone_number` is copied verbatim from `auth.users.phone`, which
-- GoTrue stores WITHOUT a leading '+'. `phone_e164` always carries one. So the
-- delete matched nothing for any customer whose profile came from the auth
-- trigger — while `phone_purged` still reported true, because it only checked
-- that a phone string existed.
--
-- Measured on production 2026-08-06: of 2 profiles holding a phone, 1 matched an
-- OTP row and 2 would match after normalization.
--
-- CASE 1 is the regression. It fails against the old function and passes against
-- the new one. The pre-existing account_deletion_test.sql seeds '+966555000002'
-- — the one format the trigger never writes — which is why this went unnoticed.

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_uid        uuid := gen_random_uuid();
  v_uid_plus   uuid := gen_random_uuid();
  v_summary    jsonb;
  v_otp_left   integer;
  v_logs_left  integer;
  v_norm       text;
begin
  -- ---- 0) normalize_ksa_e164 accepts every shape the system actually stores --
  if public.normalize_ksa_e164('966555000001')   is distinct from '+966555000001' then
    raise exception 'FAIL(0): bare country code not normalized';
  end if;
  if public.normalize_ksa_e164('+966555000001')  is distinct from '+966555000001' then
    raise exception 'FAIL(0): already-E.164 value not preserved';
  end if;
  if public.normalize_ksa_e164('0555000001')     is distinct from '+966555000001' then
    raise exception 'FAIL(0): national trunk form not normalized';
  end if;
  if public.normalize_ksa_e164('555000001')      is distinct from '+966555000001' then
    raise exception 'FAIL(0): bare national form not normalized';
  end if;
  if public.normalize_ksa_e164('+966 55 500 0001') is distinct from '+966555000001' then
    raise exception 'FAIL(0): spaced input not normalized';
  end if;
  if public.normalize_ksa_e164('00966555000001') is distinct from '+966555000001' then
    raise exception 'FAIL(0): IDD 00 prefix not normalized';
  end if;

  -- Must fail CLOSED: a caller comparing on the result must never match on a
  -- partial or non-Saudi value.
  if public.normalize_ksa_e164('')            is not null then raise exception 'FAIL(0): empty accepted'; end if;
  if public.normalize_ksa_e164(null)          is not null then raise exception 'FAIL(0): null accepted'; end if;
  if public.normalize_ksa_e164('12345')       is not null then raise exception 'FAIL(0): short number accepted'; end if;
  if public.normalize_ksa_e164('+14155550100') is not null then raise exception 'FAIL(0): non-Saudi number accepted'; end if;
  if public.normalize_ksa_e164('96655500000')  is not null then raise exception 'FAIL(0): 7-digit national accepted'; end if;
  if public.normalize_ksa_e164('+966455000001') is not null then raise exception 'FAIL(0): non-mobile 4X prefix accepted'; end if;

  -- ---- 1) THE REGRESSION: profile phone has no '+', OTP rows do --------------
  -- This is exactly what the auth trigger produces. Under the old function the
  -- two deletes matched zero rows and the summary still claimed a purge.
  insert into auth.users (id, phone) values (v_uid, '966555000001');
  update public.profiles set phone_number = '966555000001' where id = v_uid;

  insert into public.otp_challenges (phone_e164, channel, purpose, otp_hash, expires_at)
  values ('+966555000001', 'whatsapp', 'login', 'h', now() + interval '5 minutes');
  insert into public.whatsapp_message_logs (phone_e164, message_type)
  values ('+966555000001', 'otp');

  v_summary := public.anonymize_account_data(v_uid);

  select count(*) into v_otp_left  from public.otp_challenges       where phone_e164 = '+966555000001';
  select count(*) into v_logs_left from public.whatsapp_message_logs where phone_e164 = '+966555000001';

  if v_otp_left <> 0 then
    raise exception 'FAIL(1): otp_challenges survived erasure for a plus-less profile phone (% left)', v_otp_left;
  end if;
  if v_logs_left <> 0 then
    raise exception 'FAIL(1): whatsapp_message_logs survived erasure for a plus-less profile phone (% left)', v_logs_left;
  end if;

  -- ---- 2) The summary reports what actually happened -------------------------
  if (v_summary ->> 'otp_challenges_purged')::int <> 1 then
    raise exception 'FAIL(2): otp_challenges_purged reported %, expected 1', v_summary ->> 'otp_challenges_purged';
  end if;
  if (v_summary ->> 'whatsapp_logs_purged')::int <> 1 then
    raise exception 'FAIL(2): whatsapp_logs_purged reported %, expected 1', v_summary ->> 'whatsapp_logs_purged';
  end if;
  -- The dishonest flag is gone; its replacement describes only what it means.
  if v_summary ? 'phone_purged' then
    raise exception 'FAIL(2): phone_purged still present — it reported true whenever a phone string existed';
  end if;
  if (v_summary ->> 'phone_purge_attempted')::boolean is not true then
    raise exception 'FAIL(2): phone_purge_attempted should be true when a usable mobile was resolved';
  end if;

  -- ---- 3) The already-'+' form still works (no regression the other way) -----
  insert into auth.users (id, phone) values (v_uid_plus, '+966555000002');
  update public.profiles set phone_number = '+966555000002' where id = v_uid_plus;

  insert into public.otp_challenges (phone_e164, channel, purpose, otp_hash, expires_at)
  values ('+966555000002', 'whatsapp', 'login', 'h', now() + interval '5 minutes');
  insert into public.whatsapp_message_logs (phone_e164, message_type)
  values ('+966555000002', 'otp');

  v_summary := public.anonymize_account_data(v_uid_plus);

  select count(*) into v_otp_left from public.otp_challenges where phone_e164 = '+966555000002';
  if v_otp_left <> 0 then
    raise exception 'FAIL(3): plus-prefixed phone regressed (% otp rows left)', v_otp_left;
  end if;

  -- ---- 4) Another customer's rows are never touched --------------------------
  insert into public.otp_challenges (phone_e164, channel, purpose, otp_hash, expires_at)
  values ('+966555000009', 'whatsapp', 'login', 'h', now() + interval '5 minutes');
  v_summary := public.anonymize_account_data(v_uid);   -- idempotent re-run
  select count(*) into v_otp_left from public.otp_challenges where phone_e164 = '+966555000009';
  if v_otp_left <> 1 then
    raise exception 'FAIL(4): erasure reached an unrelated phone (% rows left, expected 1)', v_otp_left;
  end if;

  -- ---- 5) Idempotent: a second run purges nothing and claims nothing ---------
  if (v_summary ->> 'otp_challenges_purged')::int <> 0 then
    raise exception 'FAIL(5): re-run claimed % otp purges, expected 0', v_summary ->> 'otp_challenges_purged';
  end if;

  -- ---- 6) The phone column is no longer customer-writable --------------------
  -- Erasure keys on this value, so a customer being able to point it at another
  -- number is a correctness problem, not only a privacy one.
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'phone_number' and privilege_type = 'UPDATE'
       and grantee = 'authenticated'
  ) then
    raise exception 'FAIL(6): authenticated can still UPDATE profiles.phone_number';
  end if;

  raise notice 'erasure_phone_normalization_test: ALL CASES PASSED';
end $$;

rollback;
