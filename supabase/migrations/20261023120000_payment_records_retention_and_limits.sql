-- Spicy Meal — payment records survive account erasure; order numbers grow past
-- six digits; an over-long item note is refused before a card payment, not after.
--
-- Three audit findings from the 2026-11-19 full audit, fixed together because
-- each is a small, independent change to a record or a limit. Every item names
-- the finding it closes. The owner asked on 2026-11-22: "pause the audit and fix
-- the high findings first".
--
-- MONEY PATH: untouched. place_order, compute_order_snapshot,
-- insert_order_from_snapshot, begin_checkout_session and
-- finalize_checkout_session are neither read for derivation nor redefined.
-- Exactly two existing functions are redefined: anonymize_account_data and
-- set_order_number. Two NEW trigger functions are added.
--
-- NO DEPLOY IMPLIED: both redefinitions keep their signatures, so existing
-- callers (account-delete-process, the orders BEFORE INSERT trigger) bind to the
-- new bodies. No Edge Function reads the new summary key.
--
-- ---------------------------------------------------------------------------
-- 1. F-DBM-04-001 (high) — erasing a customer deleted the paid payment records
--    of their card orders
-- ---------------------------------------------------------------------------
-- finalize_checkout_session attaches the paid payment record to BOTH the new
-- order and its checkout session. payment_records.checkout_session_id was
-- ON DELETE CASCADE (20260712160000:84-85), and checkout_sessions.customer_id
-- cascades from profiles. So both erasure routes deleted the record:
--   A. anonymize_account_data runs `delete from public.checkout_sessions where
--      customer_id = ...`;
--   B. deleting the Auth user cascades auth.users -> profiles ->
--      checkout_sessions -> payment_records, without any explicit delete.
-- The order itself is retained (paid, its amount and VAT intact), so the
-- database kept a paid card order with no record of the payment: no provider
-- reference, so a refund opened later reads a null charge_ref and fails as
-- missing_charge_reference, and reconciliation loses its anchor.
-- docs/RECORD_OF_PROCESSING.md activity 15 already says the intended rule ("kept
-- with its order ... it holds no name or number") and records the defect as
-- gap PG-06.
--
-- WHAT CHANGES:
--   1a. The FK becomes ON DELETE SET NULL. Everything else about it is kept:
--       same name, same column, same referenced key, NO ACTION on update, MATCH
--       SIMPLE, not deferrable.
--   1b. payment_records_owner_ck is `order_id is not null or checkout_session_id
--       is not null`, and it is NOT changed. A record that carries an order_id
--       passes with the session link nulled. A record with neither would fail
--       it, and SET NULL alone would therefore make deleting a session with an
--       attempt record that never became an order RAISE — which would block
--       both erasure routes for any customer with an abandoned card attempt. So
--       a BEFORE DELETE trigger on checkout_sessions,
--       trg_checkout_sessions_drop_attempt_records, deletes the session's
--       order-less records first: exactly the rows the cascade deleted before,
--       and nothing else. The FK action then nulls the link on the rest, which
--       all carry an order_id, so the CHECK holds. Because it is a trigger on the
--       session table it covers route B (a cascaded delete fires row triggers)
--       as well as route A.
--   1c. anonymize_account_data detaches the records of retained orders before
--       it deletes the sessions, and reports how many it kept
--       (`payment_records_detached`). The behaviour would be the same without
--       this step, because of 1a; it is there so the erasure summary records
--       what it retained.
--
-- PERSONAL DATA IN THE SURVIVING ROWS. Erasure clears, on retained orders, the
-- name, phone, order note, address snapshot and item notes. A payment record
-- holds none of those: amount, currency, status, Moyasar's payment and invoice
-- ids, card scheme, last four digits, issuer name and country, and the
-- authorisation and reference codes, which sanitizeMoyasarPayment
-- (supabase/functions/_shared/moyasar.ts) reduces `raw` to. RoPA activity 15
-- lists exactly these as kept with the order and says the record holds no name
-- or number. So the surviving rows are not rewritten.
--
-- WHAT THIS DOES NOT CHANGE:
--   * An attempt record with no order is still deleted with its session,
--     including an `initiated` one whose Moyasar invoice may still be payable.
--     That is F-DBM-04-003 (the deletion processor counts only
--     `pending_payment` sessions as a financial blocker), which needs an Edge
--     Function change and is not fixed here.
--   * payment_records.order_id stays ON DELETE CASCADE. Orders are retained by
--     erasure, so nothing reaches it.
--   * No existing row is changed by applying this file.
--
-- ---------------------------------------------------------------------------
-- 2. F-DBM-02-001 (high) — order numbers wrap at six digits
-- ---------------------------------------------------------------------------
-- set_order_number used lpad(nextval(...)::text, 6, '0'). lpad TRUNCATES a
-- longer string, so 1000000..1000009 all produced SM-YYYY-100000, and
-- orders.order_number is unique. The number now pads to six digits and never
-- truncates: lpad(v, greatest(6, length(v)), '0'). Every value below 1000000
-- produces exactly the string it produced before (asserted by the paired suite
-- at 1, 59 and 999999), and from 1000000 the number simply has seven digits.
-- The mapping from sequence value to string is one-to-one, so the sequence can
-- no longer collide with itself.
--
-- NOT FIXED HERE, deliberately: place_order's `exception when unique_violation`
-- handler still catches any unique violation, not only the idempotency index,
-- and returns an all-NULL row when it finds no existing order. place_order is
-- owned by another change; the handler narrowing is a follow-up. With this file
-- the order-number collision that reached it is gone.
--
-- ---------------------------------------------------------------------------
-- 3. F-DBM-17-001 (medium) — an over-long item note was refused only after the
--    card payment was captured
-- ---------------------------------------------------------------------------
-- The 140-character item-note bound exists only as a trigger on order_items
-- (20260821170000). On the card path nothing is inserted into order_items until
-- finalize_checkout_session, which runs AFTER Moyasar captured the payment, so a
-- session carrying a 141-character note could be paid and then never finalize.
-- 20260819120000 named exactly this failure for the ORDER note and guarded
-- checkout_sessions (trg_checkout_sessions_note_length). This adds the matching
-- guard for item notes: trg_checkout_sessions_item_note_length, BEFORE INSERT OR
-- UPDATE OF snapshot, walks snapshot->'items' and applies the same predicate,
-- public.order_item_note_is_acceptable, raising the same message as
-- enforce_order_item_note ('Item note is too long', P0001). A cash order and a
-- card session now refuse the same note the same way, before any money moves.
-- An UPDATE that does not change the snapshot is let through, so no historical
-- session becomes unupdatable. compute_order_snapshot and
-- begin_checkout_session are not redefined.
--
-- The shipped app caps the note at 140 characters (apps/mobile/src/features/
-- order/orderNote.ts), so this changes nothing a customer using the app sees.
--
-- Paired suite: supabase/tests/payment_records_retention_and_limits_test.sql.

-- ---------------------------------------------------------------------------
-- 0. Pre-images. This file derives anonymize_account_data and set_order_number
--    from their current bodies, so it refuses to apply over a body it was not
--    derived from (a sibling change would otherwise be silently reverted). Each
--    body is accepted by its exact md5(prosrc), by its content hash (comments
--    and whitespace removed, for a live body applied with comments trimmed), or
--    as this file's own post-image (a re-apply).
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_src  text;
  v_norm text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.anonymize_account_data(uuid)'::regprocedure;
  if v_src is null then
    raise exception '20261023120000: anonymize_account_data(uuid) is missing';
  end if;
  v_norm := md5(regexp_replace(regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', '', 'g'));
  if md5(v_src) is distinct from 'c44b5c79be74a548bc756d0d9789ce22'
     and v_norm is distinct from 'dd05bddec4a66a659cd22ccd9bcdeb0e'
     and v_norm is distinct from '629070db1d6585eefd8ea1b84c0e6713' then
    raise exception '20261023120000: anonymize_account_data is not the body this file was derived from (md5 %, content %)', md5(v_src), v_norm;
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.set_order_number()'::regprocedure;
  if v_src is null then
    raise exception '20261023120000: set_order_number() is missing';
  end if;
  v_norm := md5(regexp_replace(regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', '', 'g'));
  if md5(v_src) is distinct from 'ed203eebfde6c1a5026e39c625e1dc80'
     and v_norm is distinct from 'fde9ae12224a86dacb0f601eb8549179'
     and v_norm is distinct from '0df037abaddf7fcace5951b3650d102e' then
    raise exception '20261023120000: set_order_number is not the body this file was derived from (md5 %, content %)', md5(v_src), v_norm;
  end if;

  -- set_order_number's grants are carried over by create or replace; remember
  -- them so the verification below can prove they did not move.
  perform set_config('sma.v20261023_son_acl',
    (select coalesce(proacl::text, '<default>') from pg_proc where oid = 'public.set_order_number()'::regprocedure),
    false);

  -- The predicate the new item-note guard reuses must be the 140-character one.
  if to_regprocedure('public.order_item_note_is_acceptable(text)') is null then
    raise exception '20261023120000: order_item_note_is_acceptable(text) is missing';
  end if;
  if public.order_item_note_is_acceptable(repeat('x', 140)) is distinct from true
     or public.order_item_note_is_acceptable(repeat('x', 141)) is distinct from false then
    raise exception '20261023120000: order_item_note_is_acceptable no longer bounds at 140';
  end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1a. The session link no longer deletes the payment record.
-- ---------------------------------------------------------------------------
alter table public.payment_records
  drop constraint if exists payment_records_checkout_session_id_fkey;
alter table public.payment_records
  add constraint payment_records_checkout_session_id_fkey
  foreign key (checkout_session_id) references public.checkout_sessions(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- 1b. A session's attempt records that never became an order go with it, as
--     they always did; this is what keeps payment_records_owner_ck satisfiable.
-- ---------------------------------------------------------------------------
create or replace function public.checkout_session_drop_attempt_records()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.payment_records
   where checkout_session_id = old.id
     and order_id is null;
  return old;
end $$;

comment on function public.checkout_session_drop_attempt_records() is
  'BEFORE DELETE on checkout_sessions: deletes the session''s payment records that carry no order_id (attempts that never became an order), so the ON DELETE SET NULL link can keep every record of a retained order. 20261023120000, F-DBM-04-001.';

revoke all on function public.checkout_session_drop_attempt_records() from public, anon, authenticated;

drop trigger if exists trg_checkout_sessions_drop_attempt_records on public.checkout_sessions;
create trigger trg_checkout_sessions_drop_attempt_records
  before delete on public.checkout_sessions
  for each row
  execute function public.checkout_session_drop_attempt_records();

-- ---------------------------------------------------------------------------
-- 1c. Erasure keeps the payment records of retained orders, and says so.
--     Derived from 20260919120000_security_audit_db_hardening.sql section 1 by
--     three anchored substitutions: one declaration, one statement before the
--     session delete, one summary key. Nothing else moves.
-- ---------------------------------------------------------------------------
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
  v_payments_kept    integer := 0;
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

  -- THE PER-ITEM NOTE. Added 2026-09-14 (audit finding 2.5). Same class of data
  -- as orders.notes -- customer free text, in practice often an address or a
  -- phone number -- and it was the one copy erasure left behind.
  update public.order_items oi
     set note = null
   where oi.note is not null
     and oi.order_id in (select o.id from public.orders o where o.customer_id = p_user_id);

  delete from public.addresses where customer_id = p_user_id;
  get diagnostics v_addresses = row_count;

  delete from public.push_devices where customer_id = p_user_id;
  get diagnostics v_devices = row_count;

  -- PAYMENT RECORDS OF RETAINED ORDERS. Added 2026-11-22 (audit finding
  -- F-DBM-04-001). finalize_checkout_session links the paid record to BOTH the
  -- order and its session, and the session link used to cascade, so the delete
  -- below took the paid record of every card order with it. The order is kept;
  -- its payment record is a financial record of that order and is kept too. It
  -- carries no name, number or address (RECORD_OF_PROCESSING.md activity 15),
  -- so detaching it from the session is all erasure needs to do to it. The FK
  -- is ON DELETE SET NULL from 20261023120000 as well; this step exists so the
  -- summary says how many were kept. A record with no order is an attempt that
  -- never became one: trg_checkout_sessions_drop_attempt_records removes it
  -- with its session, as the cascade always did.
  update public.payment_records pr
     set checkout_session_id = null
   where pr.order_id is not null
     and pr.checkout_session_id in
         (select s.id from public.checkout_sessions s where s.customer_id = p_user_id);
  get diagnostics v_payments_kept = row_count;

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
    'payment_records_detached', v_payments_kept,
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

revoke all on function public.anonymize_account_data(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account_data(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Order numbers pad to six digits and never truncate.
--    Derived from 20261006120000_rls_initplan_live_board_order_year.sql section
--    3: the year expression is kept exactly; nextval is read once into a
--    variable so its length can set the pad width. Grants are unchanged
--    (create or replace keeps them; asserted below).
-- ---------------------------------------------------------------------------
create or replace function public.set_order_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_seq text;
begin
  if new.order_number is null or new.order_number = '' then
    v_seq := nextval('public.order_number_seq')::text;
    new.order_number :=
      'SM-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' ||
      lpad(v_seq, greatest(6, length(v_seq)), '0');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. An over-long item note is refused when the checkout session is created.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_checkout_session_item_notes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.snapshot is not distinct from old.snapshot then
    return new;
  end if;

  if jsonb_typeof(new.snapshot -> 'items') = 'array'
     and exists (
       select 1
         from jsonb_array_elements(new.snapshot -> 'items') as i(item)
        where not public.order_item_note_is_acceptable(i.item ->> 'note')
     ) then
    raise exception 'Item note is too long' using errcode = 'P0001';
  end if;
  return new;
end $$;

comment on function public.enforce_checkout_session_item_notes() is
  'BEFORE INSERT OR UPDATE OF snapshot on checkout_sessions: refuses a session whose snapshot carries an item note over the order_items bound (order_item_note_is_acceptable), so the refusal happens before payment rather than in finalize. 20261023120000, F-DBM-17-001.';

revoke all on function public.enforce_checkout_session_item_notes() from public, anon, authenticated;

drop trigger if exists trg_checkout_sessions_item_note_length on public.checkout_sessions;
create trigger trg_checkout_sessions_item_note_length
  before insert or update of snapshot on public.checkout_sessions
  for each row
  execute function public.enforce_checkout_session_item_notes();

-- ---------------------------------------------------------------------------
-- 4. Self-verification. Outcomes where they can be had without touching a real
--    row: both new trigger functions are CALLED, bound to temporary tables of
--    the shape they read, and anonymize_account_data's new statement is run
--    read-only with the identical predicate. set_order_number is not called,
--    because calling it draws an order number (nextval is not transactional);
--    its behaviour is proven by the paired suite, and here by its text.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_n      integer;
  v_src    text;
  v_code   text;
  v_def    text;
  v_state  text;
begin
  -- 4.1 The FK: exactly one, SET NULL on delete, everything else as before.
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.payment_records'::regclass and c.contype = 'f'
     and c.confrelid = 'public.checkout_sessions'::regclass;
  if v_n <> 1 then
    raise exception '20261023120000 verify: % FKs from payment_records to checkout_sessions, expected 1', v_n;
  end if;
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.payment_records'::regclass
     and c.conname = 'payment_records_checkout_session_id_fkey'
     and c.contype = 'f' and c.confdeltype = 'n' and c.confupdtype = 'a'
     and c.confmatchtype = 's' and not c.condeferrable and c.convalidated
     and c.conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.payment_records'::regclass
                              and attname = 'checkout_session_id')]::smallint[]
     and c.confkey = array[(select attnum from pg_attribute
                             where attrelid = 'public.checkout_sessions'::regclass
                               and attname = 'id')]::smallint[];
  if v_n <> 1 then
    raise exception '20261023120000 verify: payment_records_checkout_session_id_fkey is not ON DELETE SET NULL with its other properties kept';
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.payment_records'::regclass and conname = 'payment_records_owner_ck';
  if v_def is distinct from 'CHECK (((order_id IS NOT NULL) OR (checkout_session_id IS NOT NULL)))' then
    raise exception '20261023120000 verify: payment_records_owner_ck changed: %', coalesce(v_def, '<missing>');
  end if;
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.payment_records'::regclass and conname = 'payment_records_order_id_fkey'
     and confdeltype = 'c';
  if v_n <> 1 then
    raise exception '20261023120000 verify: payment_records_order_id_fkey changed';
  end if;

  -- 4.2 The attempt-record trigger: bound, BEFORE DELETE, row level, enabled,
  --     SECURITY DEFINER, closed to client roles.
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.checkout_sessions'::regclass
     and tgname = 'trg_checkout_sessions_drop_attempt_records'
     and tgfoid = 'public.checkout_session_drop_attempt_records()'::regprocedure
     and tgenabled = 'O' and not tgisinternal
     and tgtype = (1 | 2 | 8)::smallint;   -- ROW | BEFORE | DELETE
  if v_n <> 1 then
    raise exception '20261023120000 verify: trg_checkout_sessions_drop_attempt_records is not a BEFORE DELETE row trigger on checkout_sessions';
  end if;
  select count(*) into v_n from pg_proc
   where oid = 'public.checkout_session_drop_attempt_records()'::regprocedure
     and prosecdef and proconfig = array['search_path=public, pg_temp'];
  if v_n <> 1 then
    raise exception '20261023120000 verify: checkout_session_drop_attempt_records is not SECURITY DEFINER with a pinned search_path';
  end if;
  if has_function_privilege('anon', 'public.checkout_session_drop_attempt_records()', 'execute')
     or has_function_privilege('authenticated', 'public.checkout_session_drop_attempt_records()', 'execute') then
    raise exception '20261023120000 verify: a client role can execute checkout_session_drop_attempt_records';
  end if;
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_code from pg_proc
   where oid = 'public.checkout_session_drop_attempt_records()'::regprocedure;
  if v_code !~ 'delete\s+from\s+public\.payment_records\s+where\s+checkout_session_id\s*=\s*old\.id\s+and\s+order_id\s+is\s+null\s*;' then
    raise exception '20261023120000 verify: checkout_session_drop_attempt_records does not delete exactly the order-less records of the session';
  end if;

  -- 4.3 Erasure: the detach statement, before the session delete, and every
  --     cleanup it already had. Comment-stripped, so a comment cannot satisfy
  --     a check.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'anonymize_account_data';
  if v_n <> 1 then
    raise exception '20261023120000 verify: % anonymize_account_data overloads', v_n;
  end if;
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_code from pg_proc
   where oid = 'public.anonymize_account_data(uuid)'::regprocedure
     and prosecdef and proconfig = array['search_path=public'];
  if v_code is null then
    raise exception '20261023120000 verify: anonymize_account_data lost SECURITY DEFINER or its search_path';
  end if;
  if v_code !~ 'update\s+public\.payment_records\s+pr\s+set\s+checkout_session_id\s*=\s*null\s+where\s+pr\.order_id\s+is\s+not\s+null' then
    raise exception '20261023120000 verify: erasure does not detach the payment records of retained orders';
  end if;
  if position('update public.payment_records' in v_code) = 0
     or position('delete from public.checkout_sessions' in v_code) = 0
     or position('update public.payment_records' in v_code) > position('delete from public.checkout_sessions' in v_code) then
    raise exception '20261023120000 verify: erasure detaches payment records after deleting the sessions';
  end if;
  if v_code ~ 'delete\s+from\s+public\.payment_records' then
    raise exception '20261023120000 verify: erasure deletes payment records';
  end if;
  if md5(regexp_replace(v_code, '\s+', '', 'g')) is distinct from '629070db1d6585eefd8ea1b84c0e6713' then
    raise exception '20261023120000 verify: anonymize_account_data body differs from this file (content %)', md5(regexp_replace(v_code, '\s+', '', 'g'));
  end if;
  if v_code !~ '''payment_records_detached''\s*,\s*v_payments_kept' then
    raise exception '20261023120000 verify: erasure summary does not report payment_records_detached';
  end if;
  if v_code not like '%update public.order_items%' or v_code not like '%set note = null%'
     or v_code not like '%delete from public.addresses%'
     or v_code not like '%delete from public.push_devices%'
     or v_code not like '%delete from public.loyalty_transactions%'
     or v_code not like '%delete from public.comp_members%'
     or v_code not like '%delete from public.otp_challenges%'
     or v_code not like '%delete from public.whatsapp_message_logs%'
     or v_code not like '%comp_member_audit%'
     or v_code !~ 'set\s+customer_name\s*=\s*null' then
    raise exception '20261023120000 verify: erasure lost one of its existing cleanups';
  end if;
  if has_function_privilege('anon', 'public.anonymize_account_data(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.anonymize_account_data(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.anonymize_account_data(uuid)', 'execute') then
    raise exception '20261023120000 verify: anonymize_account_data grants are not service_role only';
  end if;
  -- Name resolution for the new statement: run it read-only, identical
  -- predicate, against a customer id that cannot exist.
  select count(*) into v_n from public.payment_records pr
   where pr.order_id is not null
     and pr.checkout_session_id in
         (select s.id from public.checkout_sessions s
           where s.customer_id = '00000000-0000-0000-0000-000000000000'::uuid);
  if v_n is distinct from 0 then
    raise exception '20261023120000 verify: the detach predicate matched % rows for a nonexistent customer', v_n;
  end if;

  -- 4.4 set_order_number: one overload, same contract, same trigger, a pad
  --     that cannot truncate, and the year expression unchanged.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_order_number';
  if v_n <> 1 then
    raise exception '20261023120000 verify: % set_order_number overloads', v_n;
  end if;
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_code from pg_proc
   where oid = 'public.set_order_number()'::regprocedure
     and prorettype = 'trigger'::regtype and not prosecdef
     and proconfig = array['search_path=public'];
  if v_code is null then
    raise exception '20261023120000 verify: set_order_number changed its return type, security or search_path';
  end if;
  if v_code ~ 'lpad\s*\(\s*nextval' or v_code ~ ',\s*6\s*,\s*''0''\s*\)' then
    raise exception '20261023120000 verify: set_order_number still pads to a fixed width of 6';
  end if;
  if v_code !~ 'lpad\s*\(\s*v_seq\s*,\s*greatest\s*\(\s*6\s*,\s*length\s*\(\s*v_seq\s*\)\s*\)\s*,\s*''0''\s*\)'
     or v_code !~ 'v_seq\s*:=\s*nextval\(''public\.order_number_seq''\)::text'
     or v_code !~ 'to_char\(now\(\) at time zone ''Asia/Riyadh'', ''YYYY''\)' then
    raise exception '20261023120000 verify: set_order_number is not the growing pad over the Riyadh year';
  end if;
  if md5(regexp_replace(v_code, '\s+', '', 'g')) is distinct from '0df037abaddf7fcace5951b3650d102e' then
    raise exception '20261023120000 verify: set_order_number body differs from this file (content %)', md5(regexp_replace(v_code, '\s+', '', 'g'));
  end if;
  if (select coalesce(proacl::text, '<default>') from pg_proc where oid = 'public.set_order_number()'::regprocedure)
     is distinct from current_setting('sma.v20261023_son_acl', true) then
    raise exception '20261023120000 verify: set_order_number grants changed';
  end if;
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.orders'::regclass and tgname = 'set_orders_number'
     and tgfoid = 'public.set_order_number()'::regprocedure and tgenabled = 'O';
  if v_n <> 1 then
    raise exception '20261023120000 verify: set_orders_number no longer fires set_order_number on orders';
  end if;
  -- The pad itself, on the boundary values, using the same expression.
  if (select string_agg(lpad(v::text, greatest(6, length(v::text)), '0'), ',' order by v)
        from unnest(array[1, 59, 999999, 1000000, 1000009, 12345678]::bigint[]) v)
     is distinct from '000001,000059,999999,1000000,1000009,12345678' then
    raise exception '20261023120000 verify: the growing pad does not produce the expected strings';
  end if;

  -- 4.5 The item-note guard: bound to checkout_sessions, and CALLED on a
  --     temporary table of the shape it reads, at the boundary.
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.checkout_sessions'::regclass
     and tgname = 'trg_checkout_sessions_item_note_length'
     and tgfoid = 'public.enforce_checkout_session_item_notes()'::regprocedure
     and tgenabled = 'O' and not tgisinternal
     and tgtype = (1 | 2 | 4 | 16)::smallint;   -- ROW | BEFORE | INSERT | UPDATE
  if v_n <> 1 then
    raise exception '20261023120000 verify: trg_checkout_sessions_item_note_length is not a BEFORE INSERT OR UPDATE row trigger on checkout_sessions';
  end if;
  select count(*) into v_n from pg_trigger t
   where t.tgname = 'trg_checkout_sessions_item_note_length'
     and t.tgattr::text = (select attnum::text from pg_attribute
                            where attrelid = 'public.checkout_sessions'::regclass
                              and attname = 'snapshot');
  if v_n <> 1 then
    raise exception '20261023120000 verify: trg_checkout_sessions_item_note_length is not limited to UPDATE OF snapshot';
  end if;
  if has_function_privilege('anon', 'public.enforce_checkout_session_item_notes()', 'execute')
     or has_function_privilege('authenticated', 'public.enforce_checkout_session_item_notes()', 'execute') then
    raise exception '20261023120000 verify: a client role can execute enforce_checkout_session_item_notes';
  end if;

  create temporary table v20261023_cs (id uuid primary key, snapshot jsonb) on commit drop;
  create trigger v20261023_note before insert or update of snapshot on v20261023_cs
    for each row execute function public.enforce_checkout_session_item_notes();
  create trigger v20261023_drop before delete on v20261023_cs
    for each row execute function public.checkout_session_drop_attempt_records();

  insert into v20261023_cs values
    (gen_random_uuid(), jsonb_build_object('items', jsonb_build_array(
       jsonb_build_object('note', repeat('x', 140)),
       jsonb_build_object('note', null),
       jsonb_build_object('quantity', 1)))),
    (gen_random_uuid(), '{}'::jsonb);
  begin
    insert into v20261023_cs values (gen_random_uuid(), jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('note', 'ok'), jsonb_build_object('note', repeat('x', 141)))));
    v_state := 'accepted';
  exception when others then
    v_state := sqlstate || ':' || sqlerrm;
  end;
  if v_state is distinct from 'P0001:Item note is too long' then
    raise exception '20261023120000 verify: a 141-character item note gave %, expected P0001 refusal', coalesce(v_state, '<null>');
  end if;
  begin
    update v20261023_cs set snapshot = jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('note', repeat('y', 200))));
    v_state := 'accepted';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception '20261023120000 verify: an UPDATE to an over-long item note gave %, expected P0001', coalesce(v_state, '<null>');
  end if;
  -- Drives the attempt-record trigger through a real DELETE (it deletes the
  -- order-less payment records of a session id that cannot exist: none).
  delete from v20261023_cs;
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception '20261023120000 verify: probe delete removed % rows, expected 2', v_n;
  end if;
  drop table v20261023_cs;

  -- 4.6 The functions this file must not have touched still have one overload.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('place_order', 'compute_order_snapshot', 'insert_order_from_snapshot',
                       'begin_checkout_session', 'finalize_checkout_session');
  if v_n <> 5 then
    raise exception '20261023120000 verify: % overloads across the five checkout functions, expected 5', v_n;
  end if;
end $verify$;
