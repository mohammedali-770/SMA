-- ===========================================================================
-- Account deletion must reach the comped-membership tables
-- ===========================================================================
--
-- 20260827100000 made a comp storable as a PHONE NUMBER rather than only as a
-- link to an account. That is a new place a customer's number is written, and
-- two of those places do not carry an FK back to the user, so nothing in the
-- existing deletion path would have removed them:
--
--   * `comp_members` rows that are still UNCLAIMED hold `phone_e164` with
--     `profile_id` NULL. The ON DELETE CASCADE that removes a claimed row when
--     its profile goes never fires for these — there is no profile to cascade
--     from.
--   * `comp_member_audit.target_phone` is on the permanent trail, whose
--     `target_user_id` is deliberately ON DELETE SET NULL so "who was made free,
--     and why" outlives the account. A raw phone number surviving there defeats
--     that intent: it is precisely the field that re-identifies a customer who
--     asked to be forgotten.
--
-- The body below is the live definition carried over verbatim, plus those two
-- statements and their counts. Nothing else changes — the orders/addresses/
-- devices/sessions/loyalty/OTP/WhatsApp work, the auth.users-then-profile phone
-- precedence, and the `phone_purge_attempted` wording are all untouched.
-- ===========================================================================

create or replace function public.anonymize_account_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw_phone        text;
  v_phone            text;
  v_orders_anon      integer := 0;
  v_addresses        integer := 0;
  v_devices          integer := 0;
  v_sessions         integer := 0;
  v_loyalty          integer := 0;
  v_otp              integer := 0;
  v_logs             integer := 0;
  v_comp             integer := 0;
  v_comp_unclaimed   integer := 0;
  v_comp_audit       integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;

  -- auth.users.phone FIRST: it is set by verified OTP and is not writable by the
  -- customer, whereas profiles.phone_number was in the `authenticated` update
  -- grant until this migration. Fall back to the profile so an account whose
  -- Auth row has already lost its phone still purges.
  select u.phone into v_raw_phone from auth.users u where u.id = p_user_id;
  if v_raw_phone is null or btrim(v_raw_phone) = '' then
    select p.phone_number into v_raw_phone from public.profiles p where p.id = p_user_id;
  end if;

  v_phone := public.normalize_ksa_e164(v_raw_phone);

  update public.orders
     set customer_name    = null,
         customer_phone   = null,
         notes            = null,
         address_snapshot = null
   where customer_id = p_user_id
     and (customer_name is not null
       or customer_phone is not null
       or notes is not null
       or address_snapshot is not null);
  get diagnostics v_orders_anon = row_count;

  delete from public.addresses where customer_id = p_user_id;
  get diagnostics v_addresses = row_count;

  delete from public.push_devices where customer_id = p_user_id;
  get diagnostics v_devices = row_count;

  delete from public.checkout_sessions where customer_id = p_user_id;
  get diagnostics v_sessions = row_count;

  delete from public.loyalty_transactions where profile_id = p_user_id;
  get diagnostics v_loyalty = row_count;

  -- The claimed membership, by FK. Deleting it here rather than relying on the
  -- cascade matters for the anonymize-without-delete path: a comp that outlived
  -- its account would silently re-apply if the number were ever re-registered.
  delete from public.comp_members where profile_id = p_user_id;
  get diagnostics v_comp = row_count;

  -- Phone-keyed rows carry no FK to the user, so they are matched by value.
  -- BOTH sides are normalized: the stored column may predate the normalizer, and
  -- the source may or may not carry a '+' depending on which trigger wrote it.
  if v_phone is not null then
    delete from public.otp_challenges
     where public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_otp = row_count;

    delete from public.whatsapp_message_logs
     where public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_logs = row_count;

    -- An unclaimed comp for this number: no FK, so no cascade would reach it.
    delete from public.comp_members
     where profile_id is null
       and public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_comp_unclaimed = row_count;

    -- Keep the audit row, drop the number from it.
    update public.comp_member_audit
       set target_phone = null
     where public.normalize_ksa_e164(target_phone) = v_phone;
    get diagnostics v_comp_audit = row_count;
  end if;

  return jsonb_build_object(
    'orders_anonymized', v_orders_anon,
    'addresses_deleted', v_addresses,
    'push_devices_deleted', v_devices,
    'checkout_sessions_deleted', v_sessions,
    'loyalty_transactions_deleted', v_loyalty,
    'otp_challenges_purged', v_otp,
    'whatsapp_logs_purged', v_logs,
    'comp_memberships_deleted', v_comp + v_comp_unclaimed,
    'comp_audit_phones_cleared', v_comp_audit,
    -- Was `phone_purged`, which reported true whenever a phone STRING existed
    -- rather than when anything was deleted — a purge the summary claimed but
    -- had not performed. The two counts above are the honest record; this flag
    -- now says only whether a usable Saudi mobile was resolved to purge BY.
    'phone_purge_attempted', (v_phone is not null)
  );
end $$;
