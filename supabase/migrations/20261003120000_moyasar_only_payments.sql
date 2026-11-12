-- 20261003120000_moyasar_only_payments.sql
--
-- THE DATABASE STILL GRADES, ROUTES AND LABELS PAYMENTS AS TAP, AND THE
-- MOYASAR SESSION RPC LOST A GUARD ITS TAP TWIN HAD.
--
-- On 2026-11-11 the owner confirmed Moyasar as the payment provider and asked
-- for the other gateways' code to go (CLAUDE.md §6). This file changes the
-- database objects that still branch on Tap. NOT APPLIED by this change:
-- applying it is a §5 action, named by version (docs/MIGRATIONS.md).
--
-- WHAT IT CHANGES. Each defect was read live 2026-11-11, read-only, with the
-- payment row at provider 'moyasar', enabled, mode 'test'.
--
--   1. begin_session_attempt gains the LOYALTY MULTI-SPEND GUARD.
--      20260824100000 wrote it as the provider-generic twin of the Tap session
--      RPC, and its header promises "same locking, same reuse-or-expire logic".
--      But it copied the July body from BEFORE 20260712170000 added the guard.
--      Without the guard, two live checkout sessions can each be paid with the
--      same points: begin_checkout_session prices each one against the balance
--      it sees, and insert_order_from_snapshot later clamps the second
--      DEDUCTION to what is left while keeping the second DISCOUNT.
--      The guard refuses to open a payment unless the live balance covers this
--      session's points plus those reserved by the customer's other live
--      sessions, under a lock on the profile row. It is ported VERBATIM from
--      20260712170000 (lines 253-267). The live Tap function was applied with
--      its comments stripped and some lines joined, so it is not byte-identical
--      to that file; with `--` comments removed and whitespace collapsed, the
--      two bodies hash the same (588fc3922874a5d6dc4a07110f56f76d), so the
--      guard being ported is the one running today.
--
--   2. invoke_payment_refund_processor: `<> 'tap'` becomes `<> 'moyasar'`.
--      With the live row at 'moyasar' the driver returns NULL on every tick, so
--      the refund worker could never run, even with its cron job back on.
--
--   3. open_order_refund_record: the fallback provider literal 'tap' becomes
--      'moyasar'. It is used only when an enrolled order has no paid payment
--      row and no recorded provider.
--
--   4. operations_health_snapshot_internal: the payment card's `configured`
--      flag mirrors resolveMoyasarConfig (supabase/functions/_shared/moyasar.ts)
--      instead of Tap's resolver. The Tap predicate requires provider 'tap',
--      so against the live row it can never be true and the card reads
--      not_configured whatever is saved. The new predicate requires provider
--      'moyasar', a secret key carrying the selected mode's prefix (sk_test_
--      or sk_live_), and a webhook token for that mode or the shared one. It
--      no longer requires merchant_id, which Moyasar does not have.
--
--   5. operations_alerts_render_event: 'Payment / Tap' and 'الدفع / Tap' become
--      'Payment / Moyasar' and 'الدفع / Moyasar'. Staff-facing only. Rows
--      already rendered keep their text; that is history.
--
--   6. begin_session_attempt and begin_payment_attempt refuse a total under
--      Moyasar's minimum invoice, 100 minor units (1.00 SAR), with P0001,
--      before any attempt is opened. Moyasar refuses such an invoice, so an
--      attempt opened for it ended with no invoice, and every retry failed the
--      same way. A points redemption can leave such a remainder.
--      payment-initiate refuses it first; this is the second line.
--
--   7. confirm_order_payment refuses, under the order's row lock, a payment
--      for an order that ANOTHER payment has already paid: P0001
--      'order_already_paid_by_another_payment'. Two order-first payments on
--      two invoices of one order, confirmed at the same moment, were both
--      marked paid and both reported paid. The caller records the loser as a
--      duplicate to refund. Section 7.
--
-- It also rewrites three object COMMENTS that named Tap as current:
-- begin_payment_attempt, begin_session_attempt, and the
-- payment_records.provider_checkout_ref column. The first two also name the
-- minimum.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * no row is written, no cron job touched, no grant changed. The revoke and
--     grant pairs below repeat each function's existing ACL so the file reads
--     correctly on its own; the verification block asserts the outcome;
--   * it does not create refund_trigger_secret. That is an owner step, and the
--     driver keeps failing closed without it;
--   * it does not drop the two Tap RPCs. 20261004120000 does that, after the
--     payment-initiate deploy;
--   * it adds no provider allow-list to begin_payment_attempt or
--     begin_session_attempt. Both stay provider-parameterised, as written. The
--     only caller passes 'moyasar', and the service role it requires can write
--     payment_records directly, so a refusal there would guard nothing;
--   * the money path is not mentioned. place_order and compute_order_snapshot
--     must hash exactly as before, and both blocks below assert it.
--
-- ORDERING, AND THE TRAP IT CLOSES. This file REFUSES TO APPLY until
-- 20260824100000_moyasar_payment_provider is applied. Without that check, the
-- `create or replace` below would create begin_session_attempt on its own, and
-- a later apply of 20260824100000 would silently replace the guarded body with
-- the unguarded one. So the order is: 20260824100000, then this file, each on
-- its own approval and named by version. Both must be live before the
-- Moyasar-only payment-initiate is deployed. That deploy is what first calls
-- begin_session_attempt. This file is independent of 20260929120000,
-- 20261001120000 and 20261002120000.
--
-- DERIVED, NOT RETYPED. Every body is the current definition from the one
-- migration that last defined it, changed only by anchored substitutions, each
-- asserted to match EXACTLY ONCE when this file was generated:
--
--   begin_session_attempt                20260824100000:186-268   3 (declare; guard; minimum)
--   begin_payment_attempt                20260824100000:94-177    1 (minimum)
--   invoke_payment_refund_processor      20260729090000:186-262   1 (the gate)
--   open_order_refund_record             20260724120000:519-556   1 (the literal)
--   operations_health_snapshot_internal  20260925120000:113-1206  1 (the predicate)
--   operations_alerts_render_event       20260820160000:1577-1651 2 (the labels)
--   confirm_order_payment                20260827120000:207-259   1 (the refusal, inserted)
--
-- The pre-images were hashed against the LIVE functions, read-only, on
-- 2026-11-11, with md5(prosrc) and md5(pg_get_functiondef):
--   invoke_payment_refund_processor      52a3faabcbce3a63fb3231a65c83d1de  9e31bb04edd75293018ba1ead750a8a7
--   operations_health_snapshot_internal  10265270ab70597cadc5e84134384051  47c7553a3acaf437f6d0dd30d8a760c6
--   operations_alerts_render_event       605c1ada58162eeb3ba705ea7e13c3b7  85d676611fa6378b09868f6e408bbe87
-- All three are byte-identical to their source files. open_order_refund_record
-- is live in a comment-trimmed form (1 021 chars against the file's 1 135).
-- With comments removed and whitespace collapsed, both hash
-- 6925d1a44939d91d0ea9ff773d247eac, so its statements are unchanged and only
-- its comments come back. begin_session_attempt and begin_payment_attempt are
-- not live at all.
--
-- A TRIM-SET TRAP, worth knowing beyond this file. The Tap predicate trimmed
-- with E' \t\n\r\f\v'. PostgreSQL has no \v escape, so that set holds the
-- LETTER v and not a vertical tab. The new predicate spells the characters
-- JavaScript's String.prototype.trim() removes as \u escapes (25 code points,
-- enumerated with Node 22 and Deno 2.9.4).
--
-- NO DEPLOY IMPLIED. Every signature is unchanged, so existing callers bind to
-- the new bodies.
--
-- ROLLBACK, as a new migration (never an edit of an applied file): re-apply
-- each body from the source named above, and begin_session_attempt from
-- 20260824100000. Note that the latter removes the guard again.

-- ---- 0. Ordering guard ------------------------------------------------------
do $guard$
declare
  v_n    integer;
  v_hash text;
begin
  -- 20260824100000's objects. Looked up by EXACT signature on purpose: a
  -- mistyped signature here returns NULL and refuses the apply, which fails
  -- closed.
  if to_regprocedure('public.begin_payment_attempt(uuid,text,text,integer)') is null then
    raise exception 'begin_payment_attempt(uuid,text,text,integer) does not exist: apply 20260824100000_moyasar_payment_provider first';
  end if;
  if to_regprocedure('public.begin_session_attempt(uuid,text,text,integer)') is null then
    raise exception 'begin_session_attempt(uuid,text,text,integer) does not exist: apply 20260824100000_moyasar_payment_provider first';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.payment_records'::regclass
       and attname = 'provider_checkout_ref'
       and not attisdropped
  ) then
    raise exception 'payment_records.provider_checkout_ref does not exist: apply 20260824100000_moyasar_payment_provider first';
  end if;

  -- One definition only, so the replace below replaces THE function and the
  -- verification block grades it, not a sibling.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_session_attempt';
  if v_n <> 1 then
    raise exception 'expected exactly one begin_session_attempt, found %', v_n;
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_payment_attempt';
  if v_n <> 1 then
    raise exception 'expected exactly one begin_payment_attempt, found %', v_n;
  end if;

  -- The money-path baseline this file was written against. Cardinality first,
  -- looked up by name, compared with `is distinct from` so a NULL fails.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'expected exactly one place_order, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order hashes %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_hash, 'NULL');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then
    raise exception 'expected exactly one compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot hashes %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_hash, 'NULL');
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 1. begin_session_attempt: the loyalty multi-spend guard, and the minimum
-- ---------------------------------------------------------------------------
-- Identical signature and RETURNS TABLE, which `create or replace` requires.
-- The guard sits after the total check and before the reuse lookup, exactly
-- where 20260712170000 put it, so a REUSED attempt is re-checked too: a balance
-- spent elsewhere since the session was priced blocks the retry as well.
--
-- A refusal is P0001 'Your loyalty points balance changed. Please rebuild your
-- order.' payment-initiate logs it and answers with its generic "Could not
-- start the payment", as it did on the Tap path.
--
-- The minimum is the statement straight after the zero-total check: a total
-- under 1.00 SAR, Moyasar's smallest invoice, opens no attempt (see 1b).
create or replace function public.begin_session_attempt(
  p_session_id     uuid,
  p_provider       text,
  p_mode           text,
  p_expiry_minutes integer default 30
)
returns table (
  attempt_id            uuid,
  reference_transaction text,
  reference_order       text,
  provider_ref          text,
  provider_checkout_ref text,
  checkout_url          text,
  amount                numeric,
  currency              text,
  mode                  text,
  reused                boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session  public.checkout_sessions;
  v_existing public.payment_records;
  v_new      public.payment_records;
  v_ref      text;
  v_provider text := nullif(btrim(lower(coalesce(p_provider, ''))), '');
  v_expires  timestamptz := now() + make_interval(mins => greatest(5, least(60, coalesce(p_expiry_minutes, 30))));
  v_redeem   integer;
  v_other    integer;
  v_balance  integer;
begin
  if v_provider is null then
    raise exception 'A payment provider is required' using errcode = 'P0001';
  end if;

  select * into v_session from public.checkout_sessions where id = p_session_id for update;
  if not found then raise exception 'Checkout session % not found', p_session_id; end if;
  if v_session.order_id is not null then raise exception 'Checkout session already completed' using errcode = 'P0001'; end if;
  if v_session.status <> 'pending_payment' then raise exception 'Checkout session is not payable' using errcode = 'P0001'; end if;
  if v_session.expires_at <= now() then
    update public.checkout_sessions set status = 'expired' where id = p_session_id;
    raise exception 'Checkout session expired' using errcode = 'P0001';
  end if;
  if coalesce(v_session.total, 0) <= 0 then raise exception 'Order total must be greater than zero' using errcode = 'P0001'; end if;
  if v_session.total < 1.00 then raise exception 'Order total is below the online payment minimum of 1.00 SAR' using errcode = 'P0001'; end if;

  -- Loyalty multi-spend guard: the live balance must still cover the points this
  -- session redeems PLUS points reserved by the customer's other live sessions.
  -- The profile row lock serializes concurrent initiations.
  v_redeem := coalesce((v_session.snapshot->>'loyalty_points_redeemed')::int, 0);
  if v_redeem > 0 then
    select coalesce(loyalty_points, 0) into v_balance
      from public.profiles where id = v_session.customer_id for update;
    select coalesce(sum(coalesce((s.snapshot->>'loyalty_points_redeemed')::int, 0)), 0) into v_other
      from public.checkout_sessions s
      where s.customer_id = v_session.customer_id and s.id <> v_session.id
        and s.status = 'pending_payment' and s.expires_at > now();
    if v_balance < v_redeem + v_other then
      raise exception 'Your loyalty points balance changed. Please rebuild your order.' using errcode = 'P0001';
    end if;
  end if;

  select * into v_existing from public.payment_records
    where checkout_session_id = p_session_id and provider = v_provider and status = 'initiated'
    order by created_at desc limit 1;
  if found then
    if v_existing.expires_at is not null and v_existing.expires_at <= now() then
      update public.payment_records
        set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
        where id = v_existing.id;
    else
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                          v_existing.amount, v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  v_ref := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.payment_records
      (checkout_session_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_session_id, v_provider, 'initiated', v_session.total, coalesce(v_session.currency, 'SAR'),
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, 'CS-' || substr(replace(p_session_id::text, '-', ''), 1, 12), now(), v_expires)
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing from public.payment_records
      where checkout_session_id = p_session_id and provider = v_provider and status = 'initiated'
      order by created_at desc limit 1;
    return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                        v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                        v_existing.amount, v_existing.currency, v_existing.mode, true;
    return;
  end;

  return query select v_new.id, v_new.reference_transaction, v_new.reference_order,
                      v_new.provider_ref, v_new.provider_checkout_ref, v_new.checkout_url,
                      v_new.amount, v_new.currency, v_new.mode, false;
end $$;

revoke all on function public.begin_session_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_session_attempt(uuid, text, text, integer) to service_role;

comment on function public.begin_session_attempt(uuid, text, text, integer) is
  'Opens (or reuses) THE single active payment attempt for a checkout session, for any provider. Refuses with P0001 when the customer''s live loyalty balance no longer covers the points this session redeems plus those reserved by their other live sessions: the concurrent-session multi-spend guard, under a lock on the profile row (since 20261003120000). Refuses with P0001 a total under Moyasar''s 1.00 SAR invoice minimum (since 20261003120000).';

-- ---------------------------------------------------------------------------
-- 1b. begin_payment_attempt: Moyasar's invoice minimum
-- ---------------------------------------------------------------------------
-- The order-first twin, re-emitted for the one statement both now share: a
-- total under Moyasar's minimum invoice, 100 minor units (1.00 SAR), is refused
-- before any attempt is opened. Moyasar refuses such an invoice, so an attempt
-- opened for it could only end with no invoice, and every retry the same way.
-- payment-initiate refuses it first (isBelowMoyasarMinimum,
-- MOYASAR_MIN_INVOICE_MINOR_UNITS); this is the second line. Identical
-- signature and RETURNS TABLE.
create or replace function public.begin_payment_attempt(
  p_order_id       uuid,
  p_provider       text,
  p_mode           text,
  p_expiry_minutes integer default 30
)
returns table (
  attempt_id            uuid,
  reference_transaction text,
  reference_order       text,
  provider_ref          text,
  provider_checkout_ref text,
  checkout_url          text,
  amount                numeric,
  currency              text,
  mode                  text,
  reused                boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_existing public.payment_records;
  v_new      public.payment_records;
  v_ref      text;
  v_ref_ord  text;
  v_provider text := nullif(btrim(lower(coalesce(p_provider, ''))), '');
  v_expires  timestamptz := now() + make_interval(mins => greatest(5, least(60, coalesce(p_expiry_minutes, 30))));
begin
  if v_provider is null then
    raise exception 'A payment provider is required' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.payment_status = 'paid' then raise exception 'Order is already paid' using errcode = 'P0001'; end if;
  if coalesce(v_order.payment_method, '') <> 'online' then raise exception 'Order is not an online-payment order' using errcode = 'P0001'; end if;
  if coalesce(v_order.total, 0) <= 0 then raise exception 'Order total must be greater than zero' using errcode = 'P0001'; end if;
  if v_order.total < 1.00 then raise exception 'Order total is below the online payment minimum of 1.00 SAR' using errcode = 'P0001'; end if;

  -- Reuse a still-live attempt; expire a stale one.
  select * into v_existing from public.payment_records
    where order_id = p_order_id and provider = v_provider and status = 'initiated'
    order by created_at desc limit 1;
  if found then
    if v_existing.expires_at is not null and v_existing.expires_at <= now() then
      update public.payment_records
        set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
        where id = v_existing.id;
    else
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                          v_existing.amount, v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  v_ref     := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  v_ref_ord := 'ORD-' || substr(replace(p_order_id::text, '-', ''), 1, 12);
  begin
    insert into public.payment_records
      (order_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_order_id, v_provider, 'initiated', v_order.total, 'SAR',
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, v_ref_ord, now(), v_expires)
    returning * into v_new;
  exception when unique_violation then
    -- A concurrent attempt won the one-active-attempt race; return it instead of
    -- opening a second checkout.
    select * into v_existing from public.payment_records
      where order_id = p_order_id and provider = v_provider and status = 'initiated'
      order by created_at desc limit 1;
    return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                        v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                        v_existing.amount, v_existing.currency, v_existing.mode, true;
    return;
  end;

  return query select v_new.id, v_new.reference_transaction, v_new.reference_order,
                      v_new.provider_ref, v_new.provider_checkout_ref, v_new.checkout_url,
                      v_new.amount, v_new.currency, v_new.mode, false;
end $$;

revoke all on function public.begin_payment_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_payment_attempt(uuid, text, text, integer) to service_role;

comment on function public.begin_payment_attempt(uuid, text, text, integer) is
  'Opens (or reuses) THE single active payment attempt for an order, for any provider. reference_order is an OPAQUE ORD-… value, never the internal SM-… order number. Refuses with P0001 a total under Moyasar''s 1.00 SAR invoice minimum (since 20261003120000).';

comment on column public.payment_records.provider_checkout_ref is
  'Provider-side checkout object this attempt is being paid through, when it is a different id from the settled payment. Moyasar: the invoice id. provider_ref holds the payment id, which is what is confirmed and refunded.';

-- ---------------------------------------------------------------------------
-- 2. invoke_payment_refund_processor: the provider gate
-- ---------------------------------------------------------------------------
-- One substitution. Everything else is unchanged and still fails closed: the
-- reaper call, the single-row preflight, the secret read from
-- integration_settings.secret_config (NOT Vault), the project URL from the
-- lazywait_sync_project_url Vault secret, and the 100 s timeout. The cron job
-- `payment-refund-worker` is not touched and stays as it is (inactive live).
create or replace function public.invoke_payment_refund_processor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $$
declare
  v_row_count      integer;
  v_enabled        boolean;
  v_provider       text;
  v_secret_config  jsonb;
  v_trigger_secret text;
  v_project_url    text;
  v_request_id     bigint;
begin
  -- Reclaim first, so an abandoned lease is escalated even on ticks that later
  -- fail preflight. Best effort: a reaper hiccup must never abort the tick.
  begin
    perform public.expire_stale_order_refund_claims();
  exception when others then
    null;
  end;

  -- ---- Preflight, fail closed. Every branch returns NULL without sending. ----
  select count(*) into v_row_count
    from public.integration_settings where provider_type = 'payment';
  if v_row_count <> 1 then
    return null;                                    -- missing or duplicate row
  end if;

  select enabled, provider_name, secret_config
    into v_enabled, v_provider, v_secret_config
    from public.integration_settings where provider_type = 'payment';

  if not coalesce(v_enabled, false) then
    return null;                                    -- provider disabled
  end if;
  if lower(coalesce(v_provider, '')) <> 'moyasar' then
    return null;                                    -- not the Moyasar provider
  end if;

  -- RAW value: btrim only decides blankness; the value SENT is unchanged.
  v_trigger_secret := v_secret_config ->> 'refund_trigger_secret';
  if v_secret_config is null
     or v_trigger_secret is null
     or btrim(v_trigger_secret) = '' then
    return null;                                    -- no trigger secret
  end if;

  select decrypted_secret into v_project_url
    from vault.decrypted_secrets where name = 'lazywait_sync_project_url';
  if v_project_url is null then
    return null;                                    -- no project URL
  end if;

  -- ---- Send. Secret passed VERBATIM. Bounded batch. Fire-and-forget. --------
  -- Timeout 100s: worst case is 5 refunds x 15s provider timeout = 75s plus
  -- claim/finalize overhead, and it stays below Supabase's 150s idle timeout.
  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/payment-refund',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-refund-secret', v_trigger_secret),
    body := jsonb_build_object('limit', 5),
    timeout_milliseconds := 100000
  ) into v_request_id;

  return v_request_id;

exception when others then
  -- An unexpected internal error must not raise out of a cron tick (that would
  -- only produce a failed job row with no added information). The per-refund
  -- state is authoritative and untouched: nothing was claimed or finalized by a
  -- driver that failed before sending.
  return null;
end;
$$;

revoke all on function public.invoke_payment_refund_processor()
  from public, anon, authenticated;
grant execute on function public.invoke_payment_refund_processor()
  to service_role;

comment on function public.invoke_payment_refund_processor() is
  'pg_cron driver for the payment-refund worker. Escalates abandoned leases via expire_stale_order_refund_claims(), then runs a fail-closed preflight (a single enabled Moyasar integration row, a non-blank secret_config.refund_trigger_secret on that row, the project URL in Vault) and POSTs {"limit":5} with the secret sent VERBATIM in x-refund-secret. Never decides that a refund is owed — enrollment is order_refund_due() in Postgres. The secret is never stored in cron.job, Vault, logs or any table.';

-- ---------------------------------------------------------------------------
-- 3. open_order_refund_record: the fallback provider
-- ---------------------------------------------------------------------------
-- The AFTER trigger open_orders_refund_record keeps binding to this function;
-- `create or replace` does not detach it. Service-role only, as
-- 20260812114500 left it.
create or replace function public.open_order_refund_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payment_records;
begin
  if new.refund_state <> 'pending' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.refund_state = 'pending' then
    return null;                     -- already enrolled; nothing new to open
  end if;

  -- The captured attempt being refunded. Chosen by (order, paid) so a failed or
  -- abandoned earlier attempt can never be selected as the refund target.
  select * into v_pay from public.payment_records
   where order_id = new.id and status = 'paid'
   order by confirmed_at nulls last, created_at desc
   limit 1;

  insert into public.order_refunds (
    order_id, payment_record_id, provider, charge_ref, idempotency_key,
    amount, currency, status, reason
  ) values (
    new.id, v_pay.id, coalesce(v_pay.provider, new.payment_provider, 'moyasar'),
    v_pay.provider_ref,
    -- Deterministic: one refund identity per order, forever.
    'refund_' || replace(new.id::text, '-', ''),
    coalesce(v_pay.amount, new.total), coalesce(v_pay.currency, 'SAR'),
    'pending', 'pos_delivery_failed_after_customer_retries'
  )
  on conflict do nothing;

  return null;
end $$;

revoke execute on function public.open_order_refund_record() from public, anon, authenticated;
grant execute on function public.open_order_refund_record() to service_role;

-- ---------------------------------------------------------------------------
-- 4. operations_health_snapshot_internal: the payment card
-- ---------------------------------------------------------------------------
-- Re-emitted whole because `create or replace` takes no smaller unit. Only the
-- payment card's configuration read changes; the other nine cards, the cron
-- allowlist and the overall state are byte-identical to 20260925120000.
create or replace function public.operations_health_snapshot_internal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_generated_at timestamptz := now();

  v_lazywait jsonb;
  v_order_integrity jsonb;
  v_lazywait_state text := 'unavailable';
  v_integrity_state text := 'unavailable';

  v_jobs jsonb := '[]'::jsonb;
  v_database_jobs_state text := 'unavailable';
  -- Rollup over the NON-critical automation crons only (evaluator + digest).
  -- Kept separate from v_database_jobs_state so it never affects overall state.
  v_automation_jobs_state text := 'unavailable';
  v_jobs_error_code text;

  v_ad_active boolean := false;
  v_ad_latest_status text;
  v_ad_latest_run_at timestamptz;
  v_ad_latest_success_at timestamptz;
  v_ad_latest_terminal_status text;
  v_ad_latest_terminal_at timestamptz;
  v_ad_due_count integer := 0;
  v_ad_manual_review integer := 0;
  v_ad_oldest_due timestamptz;
  v_ad_counts jsonb := '{}'::jsonb;
  v_ad_state text := 'unavailable';
  v_ad_error_code text;

  v_payment_exists boolean := false;
  v_payment_enabled boolean := false;
  v_payment_configured boolean := false;
  v_payment_provider text;
  v_payment_mode text;
  v_payment_currency text;
  v_payment_updated_at timestamptz;
  v_payment_counts_24h jsonb := '{}'::jsonb;
  v_payment_stale_initiated integer := 0;
  v_payment_oldest_stale timestamptz;
  v_payment_oldest_initiated timestamptz;
  v_payment_latest_paid timestamptz;
  v_payment_integrity_critical integer := 0;
  v_payment_state text := 'unavailable';
  v_payment_error_code text;

  v_push_exists boolean := false;
  v_push_enabled boolean := false;
  v_push_configured boolean := false;
  v_push_provider text;
  v_push_updated_at timestamptz;
  v_push_active_devices integer := 0;
  v_push_promos_opt_in integer := 0;
  v_push_log_counts jsonb := '{}'::jsonb;
  v_push_failed_deliveries_24h integer := 0;
  v_push_failed_events_24h integer := 0;
  v_push_latest_log timestamptz;
  v_push_state text := 'unavailable';
  v_push_error_code text;

  v_email_exists boolean := false;
  v_email_enabled boolean := false;
  v_email_configured boolean := false;
  v_email_provider text;
  v_email_updated_at timestamptz;
  v_email_state text := 'unavailable';
  v_email_error_code text;

  v_otp_exists boolean := false;
  v_otp_enabled boolean := false;
  v_otp_configured boolean := false;
  v_otp_provider text;
  v_otp_updated_at timestamptz;
  v_otp_state text := 'unavailable';
  v_otp_error_code text;

  v_systems jsonb := '[]'::jsonb;
  v_attention jsonb := '[]'::jsonb;
  v_overall_state text := 'healthy';
  v_critical_attention integer := 0;

  -- Order flow (added 20260807). Deliberately declared with the other rollup
  -- state so it is obvious this participates in overall_state.
  v_of_state           text := 'unavailable';
  v_of_window_minutes  integer := 60;
  v_of_recent          integer := 0;
  v_of_open_branches   integer := 0;
  v_of_total_branches  integer := 0;
  v_of_baseline        numeric;
  v_of_samples         integer := 0;
  v_of_min_samples     constant integer := 3;
  v_of_error_code      text;
  v_warning_attention integer := 0;
  v_unavailable integer := 0;
  v_disabled integer := 0;
  v_not_configured integer := 0;
  v_not_monitored integer := 0;
  -- Branch availability (20260820160000). NON-critical: a stalled sweeper
  -- over-blocks and never over-sells, so it must be loud without being able to
  -- turn the platform red. Deliberately absent from `critical_systems` and from
  -- the operations_health_overall_state() call below.
  v_ba_state           text := 'unavailable';
  v_ba_closed_products integer := 0;
  v_ba_closed_options  integer := 0;
  v_ba_closed_sizes    integer := 0;
  v_ba_paused_branches integer := 0;
  v_ba_disabled_areas  integer := 0;
  v_ba_untimed         integer := 0;
  v_ba_overdue         integer := 0;
  v_ba_worst_minutes   integer := 0;
  v_ba_latest_run_at   timestamptz;
  v_ba_latest_status   text;
  v_ba_latest_success  timestamptz;
  v_ba_ledger_failing  boolean := false;
  v_ba_runs_seen       boolean := false;
  v_ba_error_code      text;
  c_ba_overdue_grace   constant interval := interval '5 minutes';
  c_ba_stalled_after   constant interval := interval '30 minutes';
begin
  -- Existing authoritative health functions remain the source of truth. Dynamic
  -- invocation allows a missing/temporarily unavailable source to fail only its
  -- own card rather than the entire Operations Health Center.
  begin
    execute 'select public.lazywait_sync_health_summary()' into v_lazywait;
    v_lazywait_state := coalesce(v_lazywait->>'overall_state', 'unavailable');
  exception when others then
    v_lazywait := jsonb_build_object(
      'overall_state', 'unavailable',
      'safe_error_code', sqlstate
    );
    v_lazywait_state := 'unavailable';
  end;

  begin
    execute 'select public.order_integrity_health_summary()' into v_order_integrity;
    v_integrity_state := coalesce(v_order_integrity->>'overall_state', 'unavailable');
  exception when others then
    v_order_integrity := jsonb_build_object(
      'overall_state', 'unavailable',
      'safe_error_code', sqlstate
    );
    v_integrity_state := 'unavailable';
  end;

  -- Allowlisted pg_cron jobs only. Commands, usernames, databases and return
  -- messages are deliberately excluded from the safe projection. Each expected
  -- job carries its own staleness tolerance (`stale_after`) sized to its cadence:
  -- the every-1–2-minute critical jobs keep the original 6-minute window, while
  -- the sparser automation crons get windows that survive one full missed tick
  -- (evaluator */5 -> 15m; hourly digest -> 130m) so a healthy-but-idle job
  -- between ticks is never mislabelled failing. `is_critical` marks the three
  -- application jobs whose health feeds the overall platform state; the three
  -- automation crons are non-critical (optional) observability.
  --
  -- `branch-availability-sweep` (20260820111000) is deliberately NON-critical.
  -- It reopens expired item/option snoozes and delivery pauses; if it stops,
  -- things stay closed longer than intended, which is fail-safe. That is worth
  -- a warning, not a platform-red.
  begin
    with expected(jobname, subsystem, expected_schedule, is_critical, stale_after) as (
      values
        ('account-deletion-processor'::text, 'account_deletion'::text, '* * * * *'::text, true,  interval '6 minutes'),
        ('lazywait-sync'::text,              'lazywait'::text,         '* * * * *'::text, true,  interval '6 minutes'),
        ('order-integrity-watchdog'::text,   'order_integrity'::text,  '*/2 * * * *'::text, true, interval '6 minutes'),
        ('operations-alerts-evaluator'::text,'operations_alerts'::text,'*/5 * * * *'::text, false, interval '15 minutes'),
        ('operations-digest-generator'::text,'operations_digest'::text,'0 * * * *'::text,   false, interval '130 minutes'),
        ('branch-availability-sweep'::text,  'branch_availability'::text,'* * * * *'::text, false, interval '6 minutes')
    ),
    snap as (
      select
        e.jobname, e.subsystem, e.expected_schedule, e.is_critical,
        j.jobid, j.schedule, coalesce(j.active, false) as active,
        -- latest-any: the newest run of any kind (may be an in-flight `running`
        -- row with a null end_time). Used ONLY for safe display.
        lr.status as latest_status, lr.start_time as latest_run_at,
        lr.end_time as latest_completed_at,
        -- latest-terminal: the most recently COMPLETED run (end_time not null).
        -- Used to decide whether a recent execution actually failed. pg_cron marks
        -- an in-flight run `running` with a null end_time; such a row is never a
        -- failure and never hides an earlier terminal failure.
        lt.status as latest_terminal_status, lt.end_time as latest_terminal_at,
        ls.end_time as latest_success_at,
        case
          when j.jobid is null or not coalesce(j.active, false) then 'failing'
          -- A recent TERMINAL non-success (e.g. `failed`) is a real failure and is
          -- checked BEFORE the no-success fallback, so a first completed run that
          -- fails (before any success ever exists) reads `failing`, not `degraded`.
          -- A newer terminal success clears an older terminal failure because lt is
          -- the most recently completed run; a `running` row has no end_time and is
          -- excluded from lt, so it never fails the job. The recency window is the
          -- job's own per-cadence tolerance, so a sparse job's older-but-cleared
          -- failure is not held against it forever.
          when lt.status is not null and lt.status <> 'succeeded'
               and lt.end_time >= now() - e.stale_after then 'failing'
          -- No completed successful run yet (and no recent terminal failure above):
          -- conservative first-run / retained-history-gap state.
          when ls.end_time is null then 'degraded'
          when now() - ls.end_time > e.stale_after then 'failing'
          when j.schedule is distinct from e.expected_schedule then 'degraded'
          else 'healthy'
        end as state
      from expected e
      left join cron.job j on j.jobname = e.jobname
      left join lateral (
        select r.status, r.start_time, r.end_time
        from cron.job_run_details r
        where r.jobid = j.jobid
        order by r.start_time desc
        limit 1
      ) lr on true
      left join lateral (
        select r.status, r.start_time, r.end_time
        from cron.job_run_details r
        where r.jobid = j.jobid and r.end_time is not null
        order by r.end_time desc
        limit 1
      ) lt on true
      left join lateral (
        select r.end_time
        from cron.job_run_details r
        where r.jobid = j.jobid and r.status = 'succeeded' and r.end_time is not null
        order by r.end_time desc nulls last
        limit 1
      ) ls on true
    )
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'job_name', jobname,
        'subsystem', subsystem,
        'critical', is_critical,
        'job_id', jobid,
        'schedule', schedule,
        'expected_schedule', expected_schedule,
        'active', active,
        'state', state,
        'latest_status', latest_status,
        'latest_run_at', latest_run_at,
        'latest_completed_at', latest_completed_at,
        'latest_terminal_status', latest_terminal_status,
        'latest_terminal_at', latest_terminal_at,
        'latest_success_at', latest_success_at,
        'latest_success_age_seconds', case when latest_success_at is null then null
          else floor(extract(epoch from (now() - latest_success_at)))::bigint end
      ) order by jobname), '[]'::jsonb),
      -- Platform-critical rollup: CRITICAL jobs only. The non-critical automation
      -- crons deliberately do NOT influence this value, so overall Operations
      -- Health state behaves exactly as before this migration.
      case
        when bool_or(state = 'failing') filter (where is_critical) then 'failing'
        when bool_or(state = 'degraded') filter (where is_critical) then 'degraded'
        else 'healthy'
      end,
      -- Separate rollup for the non-critical automation crons (surfaced as a
      -- warning-level attention item; never affects overall state).
      case
        when bool_or(state = 'failing') filter (where not is_critical) then 'failing'
        when bool_or(state = 'degraded') filter (where not is_critical) then 'degraded'
        else 'healthy'
      end
    into v_jobs, v_database_jobs_state, v_automation_jobs_state
    from snap;
  exception when others then
    v_jobs_error_code := sqlstate;
    v_database_jobs_state := 'unavailable';
    v_automation_jobs_state := 'unavailable';
    v_jobs := jsonb_build_array(
      jsonb_build_object('job_name','account-deletion-processor','subsystem','account_deletion',
        'critical',true,'job_id',null,'schedule',null,'expected_schedule','* * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','lazywait-sync','subsystem','lazywait',
        'critical',true,'job_id',null,'schedule',null,'expected_schedule','* * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','order-integrity-watchdog','subsystem','order_integrity',
        'critical',true,'job_id',null,'schedule',null,'expected_schedule','*/2 * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','operations-alerts-evaluator','subsystem','operations_alerts',
        'critical',false,'job_id',null,'schedule',null,'expected_schedule','*/5 * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','operations-digest-generator','subsystem','operations_digest',
        'critical',false,'job_id',null,'schedule',null,'expected_schedule','0 * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','branch-availability-sweep','subsystem','branch_availability',
        'critical',false,'job_id',null,'schedule',null,'expected_schedule','* * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null)
    );
  end;

  -- Account deletion: cron execution evidence + safe queue aggregates only.
  begin
    select
      coalesce((j->>'active')::boolean, false),
      j->>'latest_status',
      (j->>'latest_run_at')::timestamptz,
      (j->>'latest_success_at')::timestamptz,
      j->>'latest_terminal_status',
      (j->>'latest_terminal_at')::timestamptz
    into v_ad_active, v_ad_latest_status, v_ad_latest_run_at, v_ad_latest_success_at,
      v_ad_latest_terminal_status, v_ad_latest_terminal_at
    from jsonb_array_elements(v_jobs) j
    where j->>'job_name' = 'account-deletion-processor'
    limit 1;

    select
      count(*) filter (
        where status in ('queued','retry_scheduled','processing','waiting_for_active_order','waiting_for_financial_process')
        and (next_attempt_at is null or next_attempt_at <= now())
        and (locked_until is null or locked_until <= now())
      )::integer,
      count(*) filter (where status = 'manual_review')::integer,
      min(coalesce(next_attempt_at, requested_at)) filter (
        where status in ('queued','retry_scheduled','processing','waiting_for_active_order','waiting_for_financial_process')
        and (next_attempt_at is null or next_attempt_at <= now())
        and (locked_until is null or locked_until <= now())
      )
    into v_ad_due_count, v_ad_manual_review, v_ad_oldest_due
    from public.account_deletion_requests;

    select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      into v_ad_counts
    from (
      select status, count(*)::integer as cnt
      from public.account_deletion_requests
      group by status
    ) s;

    v_ad_state := case
      when v_database_jobs_state = 'unavailable' then 'unavailable'
      when not v_ad_active then 'failing'
      -- A recent TERMINAL non-success is a real failure and takes precedence. An
      -- in-flight `running` row has no terminal outcome and never fails here.
      when v_ad_latest_terminal_status is not null and v_ad_latest_terminal_status <> 'succeeded'
        and v_ad_latest_terminal_at >= now() - interval '6 minutes' then 'failing'
      -- No completed successful run yet (fresh deploy / retained-history gap).
      -- Kept SEPARATE from the stale-success case and, consistent with the
      -- scheduled-job snapshot's no-success rule, is `degraded` — not `failing` —
      -- so the platform does not report failing before any terminal failure.
      when v_ad_latest_success_at is null then 'degraded'
      -- A successful run exists but is stale beyond the freshness threshold.
      when now() - v_ad_latest_success_at > interval '6 minutes' then 'failing'
      when v_ad_manual_review > 0 then 'degraded'
      when v_ad_due_count > 0
        and v_ad_oldest_due < now() - interval '10 minutes' then 'degraded'
      when v_ad_due_count = 0 then 'idle'
      else 'healthy'
    end;
  exception when others then
    v_ad_error_code := sqlstate;
    v_ad_state := 'unavailable';
  end;

  -- Payment/Moyasar: database evidence only. enabled/configured never implies
  -- provider health; without a provider availability probe the normal state is
  -- not_monitored. Recent stale attempts and Order Integrity incidents are shown.
  begin
    -- "configured" mirrors the runtime resolver (_shared/moyasar.ts
    -- resolveMoyasarConfig), check for check:
    --   * provider_name must be 'moyasar';
    --   * the secret key for the SELECTED mode must be present and carry that
    --     mode's prefix, sk_test_ or sk_live_. A live key filed under test is
    --     refused at runtime (key_mode_mismatch), so it is not ready here;
    --   * a webhook secret token must exist for that mode, or the shared
    --     moyasar_webhook_secret_token. coalesce() is JavaScript's `??`: an
    --     EMPTY mode-specific token does not fall through to the shared one,
    --     at runtime or here;
    --   * no merchant id is required: Moyasar has none.
    -- Both values are trimmed of exactly the characters String.prototype.trim()
    -- removes, so a value the resolver reads as blank is blank here too. They
    -- are written as \u escapes because PostgreSQL has no \v escape: E'\v' is
    -- the letter v. Only booleans leave this statement; no key or token is
    -- selected into a returned column.
    select
      true,
      enabled,
      (lower(coalesce(provider_name, '')) = 'moyasar'
        and starts_with(
              btrim(
                coalesce(secret_config->>(
                  case when lower(coalesce(public_config->>'mode', 'test')) = 'live'
                       then 'moyasar_live_secret_key' else 'moyasar_test_secret_key' end
                ), ''),
                js_ws.chars),
              case when lower(coalesce(public_config->>'mode', 'test')) = 'live'
                   then 'sk_live_' else 'sk_test_' end)
        and btrim(
              coalesce(
                secret_config->>(
                  case when lower(coalesce(public_config->>'mode', 'test')) = 'live'
                       then 'moyasar_live_webhook_secret_token'
                       else 'moyasar_test_webhook_secret_token' end),
                secret_config->>'moyasar_webhook_secret_token',
                ''),
              js_ws.chars) <> ''),
      provider_name,
      nullif(public_config->>'mode',''),
      nullif(public_config->>'currency',''),
      updated_at
    into v_payment_exists, v_payment_enabled, v_payment_configured,
      v_payment_provider, v_payment_mode, v_payment_currency, v_payment_updated_at
    from public.integration_settings
    cross join (
      select E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002'
          || E'\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f'
          || E'\u205f\u3000\ufeff' as chars
    ) js_ws
    where provider_type = 'payment'
    order by updated_at desc
    limit 1;

    v_payment_exists := coalesce(v_payment_exists, false);
    v_payment_enabled := coalesce(v_payment_enabled, false);
    v_payment_configured := coalesce(v_payment_configured, false);

    select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      into v_payment_counts_24h
    from (
      select status, count(*)::integer cnt
      from public.payment_records
      where created_at >= now() - interval '24 hours'
      group by status
    ) s;

    select
      count(*)::integer,
      min(coalesce(initiated_at, created_at))
    into v_payment_stale_initiated, v_payment_oldest_stale
    from public.payment_records
    where status = 'initiated'
      and created_at >= now() - interval '24 hours'
      and coalesce(initiated_at, created_at) < now() - interval '30 minutes';

    select min(coalesce(initiated_at, created_at))
      into v_payment_oldest_initiated
    from public.payment_records
    where status = 'initiated';

    select max(coalesce(confirmed_at, updated_at))
      into v_payment_latest_paid
    from public.payment_records
    where status = 'paid';

    select count(*)::integer
      into v_payment_integrity_critical
    from public.order_integrity_incidents
    where status <> 'resolved'
      and severity = 'critical'
      and rule_code in (
        'PAID_ORDER_AWAITING_PAYMENT',
        'CAPTURED_PAYMENT_WITHOUT_ORDER',
        'PAYMENT_AMOUNT_MISMATCH',
        'DUPLICATE_PROVIDER_REFERENCE',
        'MULTIPLE_SUCCESSFUL_CAPTURES'
      );

    v_payment_state := case
      when not v_payment_exists then 'not_configured'
      when not v_payment_enabled then 'disabled'
      when not v_payment_configured then 'not_configured'
      when v_payment_integrity_critical > 0 then 'failing'
      when v_payment_stale_initiated > 0 then 'degraded'
      else 'not_monitored'
    end;
  exception when others then
    v_payment_error_code := sqlstate;
    v_payment_state := 'unavailable';
  end;

  -- Push: configuration, device counts and safe send-ledger aggregates. No send
  -- or test-message endpoint is invoked.
  begin
    -- "configured" mirrors the runtime push-dispatch gate exactly:
    --   provider = String(public_config.provider ?? provider_name ?? '')
    --   and that provider must equal 'expo' (case-sensitive; an empty-string
    --   provider does NOT fall through to provider_name, matching JS `??`).
    -- Expo push carries no integration_settings.secret_config (EAS credentials
    -- live outside the DB), so a DB secret is deliberately NOT required here.
    select
      true,
      enabled,
      (coalesce(public_config->>'provider', provider_name, '') = 'expo'),
      provider_name,
      updated_at
    into v_push_exists, v_push_enabled, v_push_configured,
      v_push_provider, v_push_updated_at
    from public.integration_settings
    where provider_type = 'push'
    order by updated_at desc
    limit 1;

    v_push_exists := coalesce(v_push_exists, false);
    v_push_enabled := coalesce(v_push_enabled, false);
    v_push_configured := coalesce(v_push_configured, false);

    select
      count(*) filter (where is_active)::integer,
      count(*) filter (where is_active and promos_enabled)::integer
    into v_push_active_devices, v_push_promos_opt_in
    from public.push_devices;

    -- Grouped lifecycle counts (unchanged safe projection).
    select coalesce(jsonb_object_agg(send_status, cnt), '{}'::jsonb)
      into v_push_log_counts
    from (
      select send_status, count(*)::integer cnt
      from public.notification_log
      where created_at >= now() - interval '24 hours'
      group by send_status
    ) s;

    -- Two DISTINCT units, never summed together:
    --   * failed_deliveries = sum of the per-row `failed` device counter. Push
    --     records PARTIAL sends as send_status='sent' with failed>0, and
    --     test/broadcast rows as send_status='processing' with failed>0, so a
    --     lifecycle-status filter alone misses real delivery failures.
    --   * failed_events = rows whose lifecycle status is 'failed' (total send
    --     failure OR a pre-send/device-lookup failure that reached zero devices,
    --     so failed=0). Counting events separately avoids mixing device counts
    --     with event counts. `failed` is NOT NULL default 0; guarded anyway.
    select
      coalesce(sum(greatest(coalesce(failed, 0), 0)), 0)::integer,
      count(*) filter (where send_status = 'failed')::integer
    into v_push_failed_deliveries_24h, v_push_failed_events_24h
    from public.notification_log
    where created_at >= now() - interval '24 hours';

    select max(created_at)
      into v_push_latest_log
    from public.notification_log;

    v_push_state := case
      when not v_push_exists then 'not_configured'
      when not v_push_enabled then 'disabled'
      when not v_push_configured then 'not_configured'
      when v_push_failed_deliveries_24h > 0 or v_push_failed_events_24h > 0 then 'degraded'
      else 'not_monitored'
    end;
  exception when others then
    v_push_error_code := sqlstate;
    v_push_state := 'unavailable';
  end;

  -- Email/SMTP: configuration status only. Host/from-address presence is checked
  -- without returning either value, and no email is sent.
  --
  -- "configured" mirrors the runtime SMTP readiness (email-test-config): it needs
  -- host and from_email (both trimmed there), and SMTP auth is OPTIONAL
  -- (auth = username ? {...} : undefined), so a password/secret is NOT required.
  -- Requiring provider_name or a non-empty secret_config here would over-report
  -- not_configured for a valid no-auth SMTP relay.
  begin
    select
      true,
      enabled,
      (nullif(btrim(public_config->>'host', E' \t\n\r\f\v'),'') is not null
        and nullif(btrim(public_config->>'from_email', E' \t\n\r\f\v'),'') is not null),
      provider_name,
      updated_at
    into v_email_exists, v_email_enabled, v_email_configured,
      v_email_provider, v_email_updated_at
    from public.integration_settings
    where provider_type = 'email'
    order by updated_at desc
    limit 1;

    v_email_exists := coalesce(v_email_exists, false);
    v_email_enabled := coalesce(v_email_enabled, false);
    v_email_configured := coalesce(v_email_configured, false);

    v_email_state := case
      when not v_email_exists then 'not_configured'
      when not v_email_enabled then 'disabled'
      when not v_email_configured then 'not_configured'
      else 'not_monitored'
    end;
  exception when others then
    v_email_error_code := sqlstate;
    v_email_state := 'unavailable';
  end;

  -- OTP: the WhatsApp integration row ONLY. Configuration only; no OTP or
  -- provider test message is sent.
  --
  -- The runtime OTP send path reads exactly the 'whatsapp' row —
  -- resolveWhatsAppConfig / getOtpPepper call getProviderConfig(admin, 'whatsapp')
  -- (_shared/whatsappSend.ts:71,62), a single .eq('provider_type','whatsapp')
  -- .maybeSingle() lookup. The separate 'sms' integration slot is never consulted
  -- for WhatsApp OTP, so it must not influence this card's exists/enabled/provider/
  -- configured state. provider_type is UNIQUE, so this selects one deterministic row.
  --
  -- "configured" mirrors resolveWhatsAppConfig, which fails closed unless
  -- phone_number_id (public), access_token (secret) and an OTP template name are
  -- present. The resolver uses a non-trimming str(), so presence (not
  -- whitespace-trim) is the correct mirror. A template for at least one language
  -- makes the send path succeed for that language; with none, OTP cannot send in
  -- any language -> not_configured.
  begin
    select
      true,
      enabled,
      (nullif(public_config->>'phone_number_id','') is not null
        and nullif(secret_config->>'access_token','') is not null
        and (nullif(public_config->>'otp_template_name_ar','') is not null
             or nullif(public_config->>'otp_template_name_en','') is not null)),
      provider_name,
      updated_at
    into v_otp_exists, v_otp_enabled, v_otp_configured,
      v_otp_provider, v_otp_updated_at
    from public.integration_settings
    where provider_type = 'whatsapp'
    limit 1;

    v_otp_exists := coalesce(v_otp_exists, false);
    v_otp_enabled := coalesce(v_otp_enabled, false);
    v_otp_configured := coalesce(v_otp_configured, false);

    v_otp_state := case
      when not v_otp_exists then 'not_configured'
      when not v_otp_enabled then 'disabled'
      when not v_otp_configured then 'not_configured'
      else 'not_monitored'
    end;
  exception when others then
    v_otp_error_code := sqlstate;
    v_otp_state := 'unavailable';
  end;

  -- --------------------------------------------------------------------
  -- Order flow: are orders still arriving while branches are open?
  -- --------------------------------------------------------------------
  -- Every other card watches a SUBSYSTEM. This one watches the business
  -- outcome those subsystems exist to produce, which is the failure the
  -- console could not previously see: checkout silently broken, orders at
  -- zero, every subsystem reporting healthy because none of them is broken.
  --
  -- Baselined against the SAME ROLLING WINDOW shifted back whole weeks, because
  -- order volume is strongly weekly-periodic — Friday 21:00 and Tuesday 04:00
  -- are not comparable, and a flat threshold would either scream all night or
  -- never fire at all. This is the first statistical baseline in this schema;
  -- everything else here is a fixed interval against now().
  --
  -- It FAILS QUIET. With fewer than v_of_min_samples comparable weeks it
  -- reports 'idle', never 'failing' — mirroring the alert engine's existing
  -- first-run baseline suppression. A monitor that cries wolf during its own
  -- warm-up teaches people to ignore it.
  begin
    select count(*) filter (where is_active),
           count(*)
      into v_of_open_branches, v_of_total_branches
      from public.branches;

    select count(*)
      into v_of_recent
      from public.orders
     where created_at >= v_generated_at - make_interval(mins => v_of_window_minutes);

    -- Trailing baseline: THE SAME ROLLING WINDOW, shifted back whole weeks.
    --
    -- The obvious version of this compares the rolling last-60-minutes against
    -- historical `date_trunc('hour')` buckets. That is wrong, and wrong in a way
    -- that fires: at 21:05 it measures 20:05-21:05 and compares it against full
    -- 21:00-22:00 hours, so at any demand boundary — lunch, dinner, closing —
    -- the two sides cover materially different trade and the card degrades or
    -- goes quiet for no real reason.
    --
    -- Using the CURRENT clock hour instead is worse still: at 21:05 it would
    -- compare 5 minutes of orders against a full hour and read as a ~92%
    -- collapse, every hour, at five past.
    --
    -- So each historical sample is the identical construct: the same
    -- v_of_window_minutes span ending at the same wall-clock instant, k whole
    -- weeks ago. Whole weeks preserve both weekday and time of day for free,
    -- and Saudi Arabia has no daylight saving, so there is no offset to correct
    -- and no timezone conversion is needed here at all.
    --
    -- A week with zero orders in that window is NOT a sample. Counting it would
    -- drag the mean toward zero and quietly disarm the card — the opposite of
    -- what a baseline is for. `v_of_samples` therefore counts weeks that
    -- actually traded at this time.
    select avg(c)::numeric, count(*)::integer
      into v_of_baseline, v_of_samples
    from (
      select (
        select count(*)
          from public.orders o
         where o.created_at >  v_generated_at
                              - make_interval(weeks => w)
                              - make_interval(mins => v_of_window_minutes)
           and o.created_at <= v_generated_at - make_interval(weeks => w)
      ) as c
      from generate_series(1, 8) as w
    ) s
    where c > 0;

    v_of_state := case
      -- Nothing open: zero orders is the CORRECT reading, not an incident.
      when v_of_open_branches = 0                  then 'idle'
      -- Not enough comparable history yet.
      when coalesce(v_of_samples,0) < v_of_min_samples then 'idle'
      -- History says this hour is normally quiet anyway.
      when coalesce(v_of_baseline,0) < 1           then 'idle'
      -- Branches open, history says orders are expected, none arrived.
      when v_of_recent = 0                         then 'failing'
      when v_of_recent::numeric < v_of_baseline * 0.4 then 'degraded'
      else 'healthy'
    end;
  exception when others then
    v_of_error_code := sqlstate;
    v_of_state := 'unavailable';
  end;

  -- Branch availability: does what staff closed actually reopen?
  --
  -- This is NOT the `branch-availability-sweep` cron entry above, and the
  -- difference is the whole reason this card exists. `branch_availability_sweep`
  -- catches its own exceptions, writes status='failed' to its ledger and then
  -- RETURNS NORMALLY, so pg_cron records the run as `succeeded`. The
  -- database_jobs card would read the sweeper healthy while every single sweep
  -- failed. Only the ledger plus the availability state can see that.
  --
  -- Counts only. No branch id or name ever reaches this payload — the
  -- call-centre console answers "which branch?"; Operations Health is read-only
  -- by definition and must not become an operations surface.
  begin
    select
      count(*) filter (where p.snoozed_until is not null),
      count(*) filter (where p.snoozed_until is null)
    into v_ba_closed_products, v_ba_untimed
    from public.branch_product_availability p
    where p.is_available = false;

    select
      v_ba_closed_options + count(*) filter (where m.snoozed_until is not null),
      v_ba_untimed        + count(*) filter (where m.snoozed_until is null)
    into v_ba_closed_options, v_ba_untimed
    from public.branch_modifier_availability m
    where m.is_available = false;

    -- A SIZE IS A THIRD LEVEL, NOT A KIND OF OPTION. Folding closed tiers into
    -- `closed_options` would have needed no new key and no console change, and
    -- would have made the card say "options" for something that is not one --
    -- on a menu where 59 of 61 products carry tiers and exactly ONE carries a
    -- modifier group, so almost every number under that label would have been
    -- a size.
    select
      count(*) filter (where v.snoozed_until is not null),
      v_ba_untimed + count(*) filter (where v.snoozed_until is null)
    into v_ba_closed_sizes, v_ba_untimed
    from public.branch_variant_availability v
    where v.is_available = false;

    select count(*)::int into v_ba_paused_branches
    from public.branches b where b.delivery_temporarily_closed;

    select count(*)::int into v_ba_disabled_areas
    from public.branch_delivery_areas a where a.is_disabled;

    -- Overdue restores: a timer that ran out and was never honoured. The grace
    -- window is five ticks of a one-minute sweep, so a single unlucky run is
    -- never reported as a backlog.
    select
      count(*)::int,
      coalesce(max(floor(extract(epoch from (now() - due)) / 60))::int, 0)
    into v_ba_overdue, v_ba_worst_minutes
    from (
      select snoozed_until as due from public.branch_product_availability
       where is_available = false and snoozed_until is not null
      union all
      select snoozed_until from public.branch_modifier_availability
       where is_available = false and snoozed_until is not null
      union all
      -- THIS ARM IS THE WHOLE POINT OF THE FILE. Without it a variant snooze
      -- whose timer ran out and was never honoured is overdue in the data and
      -- invisible to every state, so the sweeper could die with tiers stuck
      -- closed and the card would keep reporting `healthy`.
      select snoozed_until from public.branch_variant_availability
       where is_available = false and snoozed_until is not null
      union all
      select delivery_closed_until from public.branches
       where delivery_temporarily_closed and delivery_closed_until is not null
      union all
      select disabled_until from public.branch_delivery_areas
       where is_disabled and disabled_until is not null
    ) overdue(due)
    where due <= now() - c_ba_overdue_grace;

    select r.started_at, r.status into v_ba_latest_run_at, v_ba_latest_status
    from public.branch_availability_runs r
    order by r.id desc limit 1;

    select max(r.started_at) into v_ba_latest_success
    from public.branch_availability_runs r where r.status = 'success';

    v_ba_runs_seen := v_ba_latest_run_at is not null;
    -- "The most recent run failed" — and that is the whole test. A failure a
    -- later success has already cleared cannot reach here, because that success
    -- would itself be the most recent row. Ordering is by the ledger's identity
    -- column, never by timestamp: two runs inside one transaction share a
    -- `now()` and a timestamp comparison silently ties.
    v_ba_ledger_failing := v_ba_latest_status = 'failed';

    v_ba_state := case
      when v_ba_worst_minutes > extract(epoch from c_ba_stalled_after) / 60 then 'failing'
      when v_ba_overdue > 0 then 'degraded'
      when v_ba_ledger_failing then 'degraded'
      -- Fail-quiet warm-up, exactly as the order_flow card does it: a freshly
      -- applied database with nothing closed and no tick yet is not a problem.
      when not v_ba_runs_seen
           and v_ba_closed_products = 0 and v_ba_closed_options = 0
           and v_ba_closed_sizes = 0
           and v_ba_paused_branches = 0 and v_ba_disabled_areas = 0 then 'idle'
      else 'healthy'
    end;
  exception when others then
    v_ba_error_code := sqlstate;
    v_ba_state := 'unavailable';
  end;

  v_systems := jsonb_build_array(
    jsonb_build_object(
      'id','lazywait',
      'critical',true,
      'state',v_lazywait_state,
      'source','lazywait_sync_health_summary',
      'details',v_lazywait
    ),
    jsonb_build_object(
      'id','order_integrity',
      'critical',true,
      'state',v_integrity_state,
      'source','order_integrity_health_summary',
      'details',v_order_integrity
    ),
    jsonb_build_object(
      'id','account_deletion',
      'critical',true,
      'state',v_ad_state,
      'source','cron_and_queue',
      'details',jsonb_build_object(
        'cron_active',v_ad_active,
        'latest_run_status',v_ad_latest_status,
        'latest_run_at',v_ad_latest_run_at,
        'latest_success_at',v_ad_latest_success_at,
        'due_count',v_ad_due_count,
        'manual_review_count',v_ad_manual_review,
        'oldest_due_at',v_ad_oldest_due,
        'counts_by_status',v_ad_counts,
        'safe_error_code',v_ad_error_code
      )
    ),
    jsonb_build_object(
      'id','payment',
      'critical',false,
      'state',v_payment_state,
      'source','database_aggregates',
      'details',jsonb_build_object(
        'provider',v_payment_provider,
        'enabled',v_payment_enabled,
        'configured',v_payment_configured,
        'mode',v_payment_mode,
        'currency',v_payment_currency,
        'settings_updated_at',v_payment_updated_at,
        'counts_24h',v_payment_counts_24h,
        'stale_initiated_24h',v_payment_stale_initiated,
        'oldest_stale_initiated_at',v_payment_oldest_stale,
        'oldest_initiated_at',v_payment_oldest_initiated,
        'latest_paid_at',v_payment_latest_paid,
        'integrity_critical_count',v_payment_integrity_critical,
        'provider_probe',false,
        'safe_error_code',v_payment_error_code
      )
    ),
    jsonb_build_object(
      'id','push',
      'critical',false,
      'state',v_push_state,
      'source','configuration_and_send_ledger',
      'details',jsonb_build_object(
        'provider',v_push_provider,
        'enabled',v_push_enabled,
        'configured',v_push_configured,
        'settings_updated_at',v_push_updated_at,
        'active_devices',v_push_active_devices,
        'promotions_opt_in',v_push_promos_opt_in,
        'send_status_counts_24h',v_push_log_counts,
        'failed_deliveries_24h',v_push_failed_deliveries_24h,
        'failed_send_events_24h',v_push_failed_events_24h,
        -- Backward-compatible alias for the existing UI field; now reports actual
        -- failed device deliveries (the more truthful metric).
        'failed_sends_24h',v_push_failed_deliveries_24h,
        'latest_log_at',v_push_latest_log,
        'provider_probe',false,
        'safe_error_code',v_push_error_code
      )
    ),
    jsonb_build_object(
      'id','email',
      'critical',false,
      'state',v_email_state,
      'source','configuration_only',
      'details',jsonb_build_object(
        'provider',v_email_provider,
        'enabled',v_email_enabled,
        'configured',v_email_configured,
        'settings_updated_at',v_email_updated_at,
        'provider_probe',false,
        'safe_error_code',v_email_error_code
      )
    ),
    jsonb_build_object(
      'id','otp',
      'critical',false,
      'state',v_otp_state,
      'source','configuration_only',
      'details',jsonb_build_object(
        'provider',v_otp_provider,
        'enabled',v_otp_enabled,
        'configured',v_otp_configured,
        'settings_updated_at',v_otp_updated_at,
        'provider_probe',false,
        'safe_error_code',v_otp_error_code
      )
    ),
    jsonb_build_object(
      'id','order_flow',
      'critical',true,
      'state',v_of_state,
      'source','orders_vs_trailing_weekly_window_baseline',
      'details',jsonb_build_object(
        'window_minutes',v_of_window_minutes,
        'orders_in_window',v_of_recent,
        'open_branches',v_of_open_branches,
        'total_branches',v_of_total_branches,
        'baseline_orders',round(coalesce(v_of_baseline,0),2),
        'baseline_samples',coalesce(v_of_samples,0),
        'baseline_min_samples',v_of_min_samples,
        'baseline_ready',(coalesce(v_of_samples,0) >= v_of_min_samples),
        'safe_error_code',v_of_error_code
      )
    ),
    jsonb_build_object(
      'id','branch_availability',
      'critical',false,
      'state',v_ba_state,
      'source','branch_availability_runs',
      'details',jsonb_build_object(
        'closed_products',v_ba_closed_products,
        'closed_options',v_ba_closed_options,
        'closed_sizes',v_ba_closed_sizes,
        'paused_branches',v_ba_paused_branches,
        'disabled_areas',v_ba_disabled_areas,
        -- Reported, never a state driver: an admin delisting is a decision.
        'untimed_closures',v_ba_untimed,
        'overdue_restores',v_ba_overdue,
        'worst_overdue_minutes',v_ba_worst_minutes,
        'overdue_grace_minutes',(extract(epoch from c_ba_overdue_grace) / 60)::int,
        'stalled_after_minutes',(extract(epoch from c_ba_stalled_after) / 60)::int,
        'latest_run_at',v_ba_latest_run_at,
        'latest_run_status',v_ba_latest_status,
        'latest_success_at',v_ba_latest_success,
        'safe_error_code',v_ba_error_code
      )
    ),
    jsonb_build_object(
      'id','database_jobs',
      'critical',true,
      'state',v_database_jobs_state,
      'source','pg_cron',
      'details',jsonb_build_object(
        -- Total allowlisted jobs now = 3 critical application crons + 3 optional
        -- internal automation crons. `automation_state` is the non-critical
        -- rollup; it never affects `state` or the overall platform health.
        'expected_jobs',6,
        'critical_jobs',3,
        'automation_jobs',3,
        'automation_state',v_automation_jobs_state,
        'jobs',v_jobs,
        'safe_error_code',v_jobs_error_code
      )
    )
  );

  select coalesce(jsonb_agg(item), '[]'::jsonb)
    into v_attention
  from (values
    (case when v_lazywait_state not in ('healthy','idle') then jsonb_build_object(
      'code','LAZYWAIT_HEALTH_'||upper(v_lazywait_state),
      'subsystem','lazywait',
      'severity',case when v_lazywait_state in ('failing','configuration_error') then 'critical' else 'warning' end,
      'count',1
    ) end),
    (case when v_integrity_state not in ('healthy','idle') then jsonb_build_object(
      'code','ORDER_INTEGRITY_'||upper(v_integrity_state),
      'subsystem','order_integrity',
      'severity',case when v_integrity_state in ('failing','configuration_error') then 'critical' else 'warning' end,
      'count',greatest(
        coalesce((v_order_integrity->>'open_critical_count')::integer,0),
        coalesce((v_order_integrity->>'open_warning_count')::integer,0),
        1
      )
    ) end),
    (case when v_ad_state not in ('healthy','idle') then jsonb_build_object(
      'code','ACCOUNT_DELETION_'||upper(v_ad_state),
      'subsystem','account_deletion',
      'severity',case when v_ad_state in ('failing','configuration_error') then 'critical' else 'warning' end,
      'count',greatest(v_ad_due_count+v_ad_manual_review,1),
      'oldest_at',v_ad_oldest_due
    ) end),
    (case when v_payment_integrity_critical > 0 then jsonb_build_object(
      'code','PAYMENT_INTEGRITY_INCIDENTS',
      'subsystem','payment',
      'severity','critical',
      'count',v_payment_integrity_critical
    ) end),
    (case when v_payment_stale_initiated > 0 then jsonb_build_object(
      'code','STALE_PAYMENT_INITIATIONS',
      'subsystem','payment',
      'severity','warning',
      'count',v_payment_stale_initiated,
      'oldest_at',v_payment_oldest_stale
    ) end),
    (case when v_push_enabled and (v_push_failed_deliveries_24h > 0 or v_push_failed_events_24h > 0)
      then jsonb_build_object(
      'code','PUSH_SEND_FAILURES_24H',
      'subsystem','push',
      'severity','warning',
      -- Single unit only (never delivery + event added together): prefer the
      -- actual failed-delivery count; fall back to the failed-event count when the
      -- only evidence is a zero-delivery lifecycle failure.
      'count',case when v_push_failed_deliveries_24h > 0
                   then v_push_failed_deliveries_24h
                   else v_push_failed_events_24h end
    ) end),
    (case when v_database_jobs_state <> 'healthy' then jsonb_build_object(
      'code','SCHEDULED_JOBS_'||upper(v_database_jobs_state),
      'subsystem','database_jobs',
      'severity',case when v_database_jobs_state='failing' then 'critical' else 'warning' end,
      'count',1
    ) end),
    -- Non-critical automation crons (evaluator + digest). Always WARNING — a
    -- stuck internal automation is worth surfacing but must never read as a
    -- platform-critical incident. `unavailable` is intentionally omitted: that
    -- path is the snapshot query error already covered by SCHEDULED_JOBS_*.
    (case when v_automation_jobs_state in ('failing','degraded') then jsonb_build_object(
      'code','OPERATIONS_AUTOMATION_JOBS_'||upper(v_automation_jobs_state),
      'subsystem','operations_automation',
      'severity','warning',
      'count',1
    ) end),
    (case when v_of_state in ('failing','degraded') then jsonb_build_object(
      'code','ORDER_FLOW_'||upper(v_of_state),
      'subsystem','order_flow',
      'severity',case when v_of_state = 'failing' then 'critical' else 'warning' end,
      'count',greatest(v_of_open_branches,1)
    ) end)
    ,
    (case when v_ba_state in ('failing','degraded') then jsonb_build_object(
      'code','BRANCH_AVAILABILITY_'||upper(v_ba_state),
      'subsystem','branch_availability',
      'severity',case when v_ba_state = 'failing' then 'critical' else 'warning' end,
      'count',greatest(v_ba_overdue,1)
    ) end)
  ) a(item)
  where item is not null;

  select
    count(*) filter (where e->>'severity'='critical')::integer,
    count(*) filter (where e->>'severity'='warning')::integer
  into v_critical_attention, v_warning_attention
  from jsonb_array_elements(v_attention) e;

  select
    count(*) filter (where s->>'state'='unavailable')::integer,
    count(*) filter (where s->>'state'='disabled')::integer,
    count(*) filter (where s->>'state'='not_configured')::integer,
    count(*) filter (where s->>'state'='not_monitored')::integer
  into v_unavailable, v_disabled, v_not_configured, v_not_monitored
  from jsonb_array_elements(v_systems) s;

  v_overall_state := public.operations_health_overall_state(
    v_lazywait_state,
    v_integrity_state,
    v_ad_state,
    v_database_jobs_state,
    v_of_state
  );

  return jsonb_build_object(
    'generated_at',v_generated_at,
    'overall_state',v_overall_state,
    'critical_attention_count',coalesce(v_critical_attention,0),
    'warning_attention_count',coalesce(v_warning_attention,0),
    'systems_unavailable_count',coalesce(v_unavailable,0),
    'systems_disabled_count',coalesce(v_disabled,0),
    'systems_not_configured_count',coalesce(v_not_configured,0),
    'systems_not_monitored_count',coalesce(v_not_monitored,0),
    'critical_systems',jsonb_build_array(
      'lazywait','order_integrity','account_deletion','database_jobs','order_flow'
    ),
    'systems',v_systems,
    'jobs',v_jobs,
    'attention',v_attention
  );
end;
$$;

revoke all on function public.operations_health_snapshot_internal()
  from public, anon, authenticated;
grant execute on function public.operations_health_snapshot_internal()
  to service_role;

comment on function public.operations_health_snapshot_internal() is
  'Read-only Operations Health snapshot. Since 20260807 it carries an order_flow card in the critical set; since 20260820 the cron allowlist also observes branch-availability-sweep, and a NON-critical branch_availability card reports whether timed closures actually reopen — the sweeper swallows its own errors, so pg_cron cannot see a sweep that runs and fails. Since 20260925 that card also observes branch_variant_availability, so a stuck PRICE TIER counts toward closed_sizes and toward the overdue-restore backlog. Since 20261003 the payment card''s configured flag mirrors resolveMoyasarConfig: provider moyasar, a secret key with the selected mode''s prefix, and a webhook token. Counts only: no branch identity, PII, secrets, raw provider payloads, tokens, cron commands or external provider probe results.';

-- ---------------------------------------------------------------------------
-- 5. operations_alerts_render_event: the payment label
-- ---------------------------------------------------------------------------
-- The other labels keep their Latin brand names ('مزامنة Lazywait',
-- 'البريد / SMTP'), and this one now does the same.
create or replace function public.operations_alerts_render_event(
  p_event_type text,
  p_language text,
  p_subsystem text,
  p_condition_code text,
  p_severity text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_sys text;
  v_event text;
  v_sev text;
begin
  if p_language = 'ar' then
    v_sys := case p_subsystem
      when 'platform' then 'المنصة'
      when 'lazywait' then 'مزامنة Lazywait'
      when 'order_integrity' then 'سلامة الطلبات'
      when 'order_flow' then 'تدفق الطلبات'
      when 'account_deletion' then 'حذف الحسابات'
      when 'database_jobs' then 'المهام المجدولة'
      when 'branch_availability' then 'إتاحة الأصناف بالفروع'
      when 'payment' then 'الدفع / Moyasar'
      when 'push' then 'الإشعارات الفورية'
      when 'email' then 'البريد / SMTP'
      when 'otp' then 'واتساب / رمز التحقق'
      else left(coalesce(p_subsystem, '?'), 40) end;
    v_event := case p_event_type
      when 'opened' then 'تنبيه جديد'
      when 'escalated' then 'تصعيد تنبيه'
      when 'downgraded' then 'خفض درجة تنبيه'
      when 'reminder' then 'تذكير بتنبيه قائم'
      when 'recovered' then 'تعافي تنبيه'
      when 'baseline_observed' then 'حالة قائمة عند خط الأساس'
      else left(coalesce(p_event_type, '?'), 40) end;
    v_sev := case p_severity
      when 'critical' then 'حرج' when 'warning' then 'تحذير' else 'معلومة' end;
    return jsonb_build_object(
      'subject', '[' || v_sev || '] ' || v_sys || ' — ' || v_event,
      'body', v_event || ': ' || v_sys || ' — الحالة ' ||
              left(coalesce(p_condition_code, '?'), 80) || ' (الخطورة: ' || v_sev || ').');
  end if;

  v_sys := case p_subsystem
    when 'platform' then 'Platform'
    when 'lazywait' then 'Lazywait Sync'
    when 'order_integrity' then 'Order Integrity'
    when 'order_flow' then 'Order Flow'
    when 'account_deletion' then 'Account Deletion'
    when 'database_jobs' then 'Scheduled Jobs'
    when 'branch_availability' then 'Branch Availability'
    when 'payment' then 'Payment / Moyasar'
    when 'push' then 'Push Notifications'
    when 'email' then 'Email / SMTP'
    when 'otp' then 'WhatsApp / OTP'
    else left(coalesce(p_subsystem, '?'), 40) end;
  v_event := case p_event_type
    when 'opened' then 'Alert opened'
    when 'escalated' then 'Alert escalated'
    when 'downgraded' then 'Alert downgraded'
    when 'reminder' then 'Alert reminder'
    when 'recovered' then 'Alert recovered'
    when 'baseline_observed' then 'Baseline condition observed'
    else left(coalesce(p_event_type, '?'), 40) end;
  v_sev := coalesce(p_severity, 'info');
  return jsonb_build_object(
    'subject', '[' || upper(v_sev) || '] ' || v_sys || ' — ' || v_event,
    'body', v_event || ': ' || v_sys || ' condition ' ||
            left(coalesce(p_condition_code, '?'), 80) || ' (severity: ' || v_sev || ').');
end;
$$;

revoke all on function public.operations_alerts_render_event(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_render_event(text, text, text, text, text)
  to service_role;

-- ---- 6. Self-verification ---------------------------------------------------
-- CARDINALITY FIRST, then the bodies: `select prosrc into` takes an arbitrary
-- row when there are two overloads, so the count has to be known first.
--
-- WHERE AN ASSERTION NAMES A TOKEN, IT NAMES A STATEMENT, and it is matched
-- against the body with its `--` comments stripped, so a comment cannot
-- satisfy it. Assertions that something is ABSENT read the whole body,
-- comments included.
--
-- WHAT IS CALLED AND WHAT IS NOT. The snapshot (`stable`) and the renderer
-- (`immutable`) are called, and their results are read back as values. The
-- other four are NOT called here. invoke_payment_refund_processor can POST to
-- the refund worker. begin_session_attempt and begin_payment_attempt write
-- payment_records. A trigger function cannot be called directly. Their
-- behaviour is proven by supabase/tests/moyasar_only_payments_test.sql and
-- moyasar_begin_attempt_test.sql on the local chain.
do $verify$
declare
  v_n      integer;
  v_fn     text;
  v_txt    text;
  v_src    text;
  v_card   jsonb;
  v_ev     jsonb;
  p_total  integer;
  p_guard  integer;
  p_reuse  integer;
  p_min    integer;
begin
  -- 6.1 ONE DEFINITION EACH.
  foreach v_fn in array array['begin_session_attempt', 'begin_payment_attempt',
                              'invoke_payment_refund_processor',
                              'open_order_refund_record', 'operations_health_snapshot_internal',
                              'operations_alerts_render_event'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception 'expected exactly one %, found %', v_fn, v_n;
    end if;
  end loop;

  -- 6.2 CONTAINMENT UNCHANGED: service_role only, everywhere it was.
  foreach v_fn in array array['public.begin_session_attempt(uuid,text,text,integer)',
                              'public.begin_payment_attempt(uuid,text,text,integer)',
                              'public.invoke_payment_refund_processor()',
                              'public.open_order_refund_record()',
                              'public.operations_health_snapshot_internal()',
                              'public.operations_alerts_render_event(text,text,text,text,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '% is executable by a client role', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '% is not executable by service_role', v_fn;
    end if;
  end loop;

  -- 6.3 THE HEADERS WERE COPIED, NOT RETYPED: definer, volatility and
  --     search_path exactly as before, for all six.
  select string_agg(p.proname || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':'
                    || coalesce(array_to_string(p.proconfig, ';'), '-'), ' | ' order by p.proname)
    into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('begin_session_attempt', 'begin_payment_attempt',
                       'invoke_payment_refund_processor',
                       'open_order_refund_record', 'operations_health_snapshot_internal',
                       'operations_alerts_render_event');
  if v_txt is distinct from
       'begin_payment_attempt:true:v:search_path=public'
    || ' | begin_session_attempt:true:v:search_path=public'
    || ' | invoke_payment_refund_processor:true:v:search_path=public, vault, extensions, net'
    || ' | open_order_refund_record:true:v:search_path=public'
    || ' | operations_alerts_render_event:false:i:search_path=public'
    || ' | operations_health_snapshot_internal:true:s:search_path=public' then
    raise exception 'a function header changed: %', coalesce(v_txt, 'NULL');
  end if;

  -- 6.4 NO TAP LEFT in the six bodies, comments included. A word-start match,
  --     so 'Tap', 'tap' and 'tap_begin_…' are all caught.
  select string_agg(p.proname, ', ') into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('begin_session_attempt', 'begin_payment_attempt',
                       'invoke_payment_refund_processor',
                       'open_order_refund_record', 'operations_health_snapshot_internal',
                       'operations_alerts_render_event')
     and p.prosrc ~* '\mtap';
  if v_txt is not null then
    raise exception 'these bodies still mention Tap: %', v_txt;
  end if;

  -- 6.5 THE REFUND GATE AND THE FALLBACK, as statements.
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoke_payment_refund_processor';
  if position('if lower(coalesce(v_provider, '''')) <> ''moyasar'' then' in v_src) = 0 then
    raise exception 'invoke_payment_refund_processor does not gate on moyasar';
  end if;

  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'open_order_refund_record';
  if position('coalesce(v_pay.provider, new.payment_provider, ''moyasar'')' in v_src) = 0 then
    raise exception 'open_order_refund_record does not fall back to moyasar';
  end if;

  -- 6.6 THE LOYALTY GUARD, whole and IN ORDER. The body is compared with its
  --     `--` comments removed and its whitespace collapsed, against the
  --     statements of 20260712170000:253-267, which are also the statements
  --     the live Tap function runs, so a weakened copy cannot pass. Then its
  --     place: after the total check, before the reuse lookup.
  select regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_session_attempt';
  p_total := position('''Order total must be greater than zero''' in v_src);
  p_guard := position(
       'v_redeem := '
       || 'coalesce((v_session.snapshot->>''loyalty_points_redeemed'')::int, 0); if '
       || 'v_redeem > 0 then select coalesce(loyalty_points, 0) into v_balance from '
       || 'public.profiles where id = v_session.customer_id for update; select '
       || 'coalesce(sum(coalesce((s.snapshot->>''loyalty_points_redeemed'')::int, '
       || '0)), 0) into v_other from public.checkout_sessions s where s.customer_id '
       || '= v_session.customer_id and s.id <> v_session.id and s.status = '
       || '''pending_payment'' and s.expires_at > now(); if v_balance < v_redeem + '
       || 'v_other then raise exception ''Your loyalty points balance changed. '
       || 'Please rebuild your order.'' using errcode = ''P0001''; end if; end if;'
       in v_src);
  p_reuse := position('select * into v_existing from public.payment_records' in v_src);
  if p_guard = 0 then
    raise exception 'begin_session_attempt is missing the loyalty multi-spend guard';
  end if;
  if not (p_total > 0 and p_total < p_guard and p_guard < p_reuse) then
    raise exception 'the loyalty guard is out of place in begin_session_attempt (%, %, %)',
      p_total, p_guard, p_reuse;
  end if;

  -- 6.6b THE INVOICE MINIMUM, as a statement in both attempt RPCs, straight
  --      after the zero-total check and before an attempt is reused or
  --      opened, in the same normalised form. Its threshold is pinned with it:
  --      1.00 SAR is MOYASAR_MIN_INVOICE_MINOR_UNITS (moyasar.ts), which a
  --      wiring test holds this file to.
  p_min := position(
       'if v_session.total < 1.00 then raise exception ''Order total is below the '
       || 'online payment minimum of 1.00 SAR'' using errcode = ''P0001''; end if;'
       in v_src);
  if p_min = 0 then
    raise exception 'begin_session_attempt does not refuse a total under the 1.00 SAR invoice minimum';
  end if;
  if not (p_total < p_min and p_min < p_guard) then
    raise exception 'the minimum is out of place in begin_session_attempt (%, %, %)', p_total, p_min, p_guard;
  end if;

  select regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_payment_attempt';
  p_total := position('''Order total must be greater than zero''' in v_src);
  p_min := position(
       'if v_order.total < 1.00 then raise exception ''Order total is below the '
       || 'online payment minimum of 1.00 SAR'' using errcode = ''P0001''; end if;'
       in v_src);
  p_reuse := position('select * into v_existing from public.payment_records' in v_src);
  if p_min = 0 then
    raise exception 'begin_payment_attempt does not refuse a total under the 1.00 SAR invoice minimum';
  end if;
  if not (p_total > 0 and p_total < p_min and p_min < p_reuse) then
    raise exception 'the minimum is out of place in begin_payment_attempt (%, %, %)', p_total, p_min, p_reuse;
  end if;

  -- 6.7 THE HEALTH PREDICATE, compared whole in the same normalised form, so
  --     every clause is pinned: the provider, the key slot, the prefix, the
  --     token slots, the shared fallback and the blank test. The trim set is
  --     pinned on its own. What the card must no longer ask for, merchant_id
  --     and Tap's key slots, is asserted absent from the whole body, comments
  --     included.
  select regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_health_snapshot_internal';
  if position(
       '(lower(coalesce(provider_name, '''')) = ''moyasar'' and starts_with( btrim( '
       || 'coalesce(secret_config->>( case when '
       || 'lower(coalesce(public_config->>''mode'', ''test'')) = ''live'' then '
       || '''moyasar_live_secret_key'' else ''moyasar_test_secret_key'' end ), ''''), '
       || 'js_ws.chars), case when lower(coalesce(public_config->>''mode'', ''test'')) '
       || '= ''live'' then ''sk_live_'' else ''sk_test_'' end) and btrim( coalesce( '
       || 'secret_config->>( case when lower(coalesce(public_config->>''mode'', '
       || '''test'')) = ''live'' then ''moyasar_live_webhook_secret_token'' else '
       || '''moyasar_test_webhook_secret_token'' end), '
       || 'secret_config->>''moyasar_webhook_secret_token'', ''''), js_ws.chars) <> '''')'
       in v_src) = 0 then
    raise exception 'the payment card does not mirror resolveMoyasarConfig';
  end if;
  if position(
       'select '
       || 'E''\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002'' || '
       || 'E''\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f'' || '
       || 'E''\u205f\u3000\ufeff'' as chars'
       in v_src) = 0 then
    raise exception 'the payment card does not trim what String.prototype.trim() trims';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_health_snapshot_internal'
     and (position('merchant_id' in p.prosrc) > 0
          or position('''test_secret_key''' in p.prosrc) > 0
          or position('''live_secret_key''' in p.prosrc) > 0);
  if v_n <> 0 then
    raise exception 'the payment card still reads a Tap setting';
  end if;

  -- 6.8 IT RUNS. A plpgsql body is not name-resolved at creation, so the
  --     snapshot is CALLED and its payment card is read back as a value. The
  --     state depends on what is saved, which this file does not read, so the
  --     assertion is coherence: a state the card can legitimately be in, a
  --     boolean `configured` consistent with it, and no key material in it.
  v_card := (
    select s from jsonb_array_elements(public.operations_health_snapshot_internal() -> 'systems') s
     where s ->> 'id' = 'payment'
  );
  if v_card is null then
    raise exception 'the payment card is absent from the snapshot';
  end if;
  if v_card ->> 'state' = 'unavailable' then
    raise exception 'the payment card is unavailable after this migration: %',
      coalesce(v_card -> 'details' ->> 'safe_error_code', 'no error code');
  end if;
  if (v_card ->> 'state') is null
     or (v_card ->> 'state') not in ('disabled', 'not_configured', 'not_monitored', 'degraded', 'failing') then
    raise exception 'the payment card is in an unexpected state: %', coalesce(v_card ->> 'state', 'NULL');
  end if;
  if jsonb_typeof(v_card -> 'details' -> 'configured') is distinct from 'boolean'
     or jsonb_typeof(v_card -> 'details' -> 'enabled') is distinct from 'boolean' then
    raise exception 'the payment card does not report enabled/configured as booleans: %', v_card -> 'details';
  end if;
  if (v_card -> 'details' ->> 'configured')::boolean and v_card ->> 'state' = 'not_configured' then
    raise exception 'the payment card reads configured but not_configured';
  end if;
  if (v_card -> 'details' ->> 'enabled')::boolean
     and not (v_card -> 'details' ->> 'configured')::boolean
     and v_card ->> 'state' is distinct from 'not_configured' then
    raise exception 'an enabled, unconfigured payment row reads %', v_card ->> 'state';
  end if;
  if v_card::text ~ '[sp]k_(test|live)_' then
    raise exception 'the payment card carries key material';
  end if;

  -- 6.9 THE LABELS, rendered.
  v_ev := public.operations_alerts_render_event('opened', 'en', 'payment', 'not_configured', 'warning');
  if v_ev ->> 'subject' is distinct from '[WARNING] Payment / Moyasar — Alert opened' then
    raise exception 'unexpected English payment subject: %', coalesce(v_ev ->> 'subject', 'NULL');
  end if;
  v_ev := public.operations_alerts_render_event('opened', 'ar', 'payment', 'not_configured', 'warning');
  if v_ev ->> 'subject' is distinct from '[تحذير] الدفع / Moyasar — تنبيه جديد' then
    raise exception 'unexpected Arabic payment subject: %', coalesce(v_ev ->> 'subject', 'NULL');
  end if;

  -- 6.10 THE COMMENTS no longer name Tap.
  if obj_description('public.begin_session_attempt(uuid,text,text,integer)'::regprocedure, 'pg_proc') ~* '\mtap'
     or obj_description('public.begin_payment_attempt(uuid,text,text,integer)'::regprocedure, 'pg_proc') ~* '\mtap'
     or obj_description('public.invoke_payment_refund_processor()'::regprocedure, 'pg_proc') ~* '\mtap'
     or col_description('public.payment_records'::regclass,
          (select attnum from pg_attribute
            where attrelid = 'public.payment_records'::regclass and attname = 'provider_checkout_ref')) ~* '\mtap' then
    raise exception 'a payment comment still names Tap';
  end if;

  -- 6.11 MONEY PATH UNCHANGED. Cardinality first, by name, `is distinct from`.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'expected exactly one place_order, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then
    raise exception 'expected exactly one compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;
end
$verify$;

-- ---------------------------------------------------------------------------
-- 7. confirm_order_payment: one paying payment per order, decided under the lock
-- ---------------------------------------------------------------------------
-- An order-first order can hold two invoices: the first attempt expires, a
-- second opens, and a payment then settles LATE on the first while another is
-- paid on the second. moyasarVerify.ts reads "already paid by another
-- payment?" before it stamps and confirms, but two confirmations that overlap
-- (two webhooks, or a webhook and the admin re-verify) both read "unpaid"
-- there. This function then locked the order and checked only THIS payment's
-- own provider_ref, so both upserted a paid row, the second rewrote paid_at,
-- and both callers answered paid. Reproduced on the local chain (two paid
-- rows, MULTIPLE_SUCCESSFUL_CAPTURES opened by the watchdog).
--
-- The decision now sits where only one caller can be at a time: after the
-- `for update`, an order already paid is refused with P0001
-- 'order_already_paid_by_another_payment' unless a paid row already carries
-- THIS (provider, provider_ref). That exception follows the existing early
-- return, so the genuine payment, its replay and a webhook racing
-- payment-verify for it all still return the order unchanged. A raise rolls
-- the call back, so nothing is written here; the caller records the payment as
-- a duplicate to refund (moyasarVerify.ts, isOrderAlreadyPaidByAnother).
--
-- An order paid with no payment id (p_provider_ref NULL) is refused the same
-- way: before this it inserted a second paid row with a NULL ref.
--
-- DERIVED, NOT RETYPED: 20260827120000_lazywait_delivery_sync.sql:207-259,
-- the only current definition, with one block inserted after the early return.
-- The block just below refuses the apply unless the body being replaced is
-- that one (comment-stripped, whitespace-collapsed md5
-- 6a0ae6eb9963d6f79fc2b086d4583ece, computed on the local chain; the live
-- body has NOT been read for this file, so a live body that differs refuses
-- the apply rather than being silently overwritten). Same signature, same header, same
-- ACL, so no deploy is implied by the SQL; the caller's handling ships with
-- the Moyasar-only payment functions.
do $confirm_pre$
declare
  v_n    integer;
  v_hash text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_order_payment';
  if v_n <> 1 then
    raise exception 'expected exactly one confirm_order_payment, found %', v_n;
  end if;
  select md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
    into v_hash
    from pg_proc p
   where p.oid = to_regprocedure('public.confirm_order_payment(uuid,text,text,numeric,jsonb)');
  if v_hash is distinct from '6a0ae6eb9963d6f79fc2b086d4583ece' then
    raise exception 'confirm_order_payment is not the 20260827120000 body (normalized md5 %): re-derive this section',
      coalesce(v_hash, 'NULL');
  end if;
end
$confirm_pre$;

create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_provider text,
  p_provider_ref text,
  p_amount numeric,
  p_raw jsonb default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if p_provider_ref is not null and exists (
    select 1 from public.payment_records
    where provider = p_provider and provider_ref = p_provider_ref and status = 'paid'
  ) then
    return v_order;
  end if;

  -- Already paid, and not by this payment (the early return above): this one
  -- paid nothing. Decided under the lock, so of two payments confirmed at
  -- once exactly one gets here first. As of 20261003120000.
  if v_order.payment_status = 'paid' then
    raise exception 'order_already_paid_by_another_payment'
      using errcode = 'P0001', detail = format('order %s', p_order_id);
  end if;

  if p_amount is distinct from v_order.total then
    insert into public.payment_records (order_id, provider, provider_ref, status, amount, raw)
      values (p_order_id, p_provider, p_provider_ref, 'failed', coalesce(p_amount, 0), p_raw);
    raise exception 'Payment amount % does not match order total %', p_amount, v_order.total;
  end if;

  insert into public.payment_records (order_id, provider, provider_ref, status, amount, raw)
    values (p_order_id, p_provider, p_provider_ref, 'paid', p_amount, p_raw)
  on conflict (provider, provider_ref) where provider_ref is not null
    do update set status = 'paid', amount = excluded.amount, raw = excluded.raw, updated_at = now();

  update public.orders
    set payment_status   = 'paid',
        payment_provider = p_provider,
        paid_at          = now(),
        -- Delivery is released here too, as of 20260827120000.
        lazywait_sync_state  = case when lazywait_sync_state = 'awaiting_payment'
                                    then 'pending' else lazywait_sync_state end,
        sync_next_attempt_at = case when lazywait_sync_state = 'awaiting_payment'
                                    then now() else sync_next_attempt_at end,
        updated_at = now()
    where id = p_order_id
    returning * into v_order;

  return v_order;
end $$;

revoke all on function public.confirm_order_payment(uuid, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_order_payment(uuid, text, text, numeric, jsonb) to service_role;

-- ---- 8. Self-verification for section 7 ------------------------------------
-- Cardinality first; the statement matched against the comment-stripped body
-- so a comment cannot satisfy it, and its POSITION checked, because the same
-- check placed before the early return would refuse the genuine payment's
-- replay. Behaviour (refusal, replay, race) is proven by
-- supabase/tests/moyasar_only_payments_test.sql on the local chain.
do $confirm_verify$
declare
  v_n    integer;
  v_src  text;
  v_txt  text;
  p_ret  integer;
  p_dup  integer;
  p_amt  integer;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_order_payment';
  if v_n <> 1 then
    raise exception 'expected exactly one confirm_order_payment, found %', v_n;
  end if;

  if has_function_privilege('anon', 'public.confirm_order_payment(uuid,text,text,numeric,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.confirm_order_payment(uuid,text,text,numeric,jsonb)', 'EXECUTE') then
    raise exception 'confirm_order_payment is executable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.confirm_order_payment(uuid,text,text,numeric,jsonb)', 'EXECUTE') then
    raise exception 'confirm_order_payment is not executable by service_role';
  end if;

  select p.prosecdef::text || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '-'),
         regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
    into v_txt, v_src
    from pg_proc p
   where p.oid = to_regprocedure('public.confirm_order_payment(uuid,text,text,numeric,jsonb)');
  if v_txt is distinct from 'true:v:search_path=public' then
    raise exception 'confirm_order_payment header changed: %', coalesce(v_txt, 'NULL');
  end if;

  p_ret := position('and status = ''paid'' ) then return v_order; end if;' in coalesce(v_src, ''));
  p_dup := position('if v_order.payment_status = ''paid'' then raise exception ''order_already_paid_by_another_payment'' using errcode = ''P0001''' in coalesce(v_src, ''));
  p_amt := position('if p_amount is distinct from v_order.total then' in coalesce(v_src, ''));
  if p_ret = 0 or p_dup = 0 or p_amt = 0 then
    raise exception 'confirm_order_payment is missing a statement (early return %, refusal %, amount check %)',
      p_ret, p_dup, p_amt;
  end if;
  if not (p_ret < p_dup and p_dup < p_amt) then
    raise exception 'confirm_order_payment refuses in the wrong place (early return %, refusal %, amount check %)',
      p_ret, p_dup, p_amt;
  end if;

  -- The money path, again, after the last replace in this file.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %', coalesce(v_txt, 'NULL');
  end if;
end
$confirm_verify$;
