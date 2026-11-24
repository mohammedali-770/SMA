-- ===========================================================================
-- A cash retry is answered only for the inputs its order was placed with, and a
-- card retry waits for a payment that can still be made
-- (audit findings F-D1-001 and F-D1-003, both medium, read 2026-11-24)
-- ===========================================================================
--
-- F-D1-001 - THE DEFECT. place_order returns the order that already holds
-- (customer, idempotency_key) without comparing anything the call in hand asks
-- for, and the app sends the CART key for cash, which stands for the item list
-- only (cartOrderSignature) and rotates only when the items change. 20261020
-- closed the same hole for card checkouts with an input fingerprint; the cash
-- path was not touched. A customer whose cash order was written but whose
-- response was lost, who then changes pickup to delivery (or the branch, the
-- address, the coupon, the notes or the points) and taps Confirm again, is
-- shown success for the FIRST order. The kitchen has the first version, and any
-- points choice is silently the old one. No money is taken wrongly - it is cash
-- - but the customer gets food they did not just choose.
--
-- F-D1-001 - THE FIX, in the wrapper customers actually call. place_order is
-- granted to service_role only (20260724200000); the one caller is
-- place_customer_order, which order-intake invokes AS THE CUSTOMER. The check
-- therefore lives there, and place_order - the money path - is NOT redefined:
--
--   1. public.checkout_input_fingerprint(...) is the fingerprint 20261020 built
--      inline in begin_checkout_session, moved into one function. begin_checkout_
--      session now calls it too, so cash and card share ONE definition and
--      cannot drift. The value is byte-for-byte what the inline expression
--      produced (asserted below against that expression), so every fingerprint
--      already stored on a checkout session still matches.
--   2. public.order_input_fingerprints(order_id, fingerprint): one row per
--      order the wrapper creates under a key. A side table rather than a column
--      on orders, so no UPDATE ever fires orders' twelve triggers (POS-sync
--      enrolment, refund enrolment and the rest). RLS on, no policy, no client
--      grant. ON DELETE CASCADE with the order.
--   3. place_customer_order, after the per-customer advisory lock it already
--      takes, looks up the order holding the key:
--        * same inputs          - falls through; place_order replays the order,
--                                 so a genuine retry makes no second ticket and
--                                 no second redemption;
--        * different inputs     - 'checkout_session_mismatch: order_placed',
--                                 P0001, with the card path's DETAIL and HINT.
--                                 The sentence already maps to the shipped
--                                 "An order was already placed from this
--                                 checkout. Check your orders before ordering
--                                 again." (userMessage.ts), so every installed
--                                 build already says the right thing;
--        * no fingerprint row   - an order placed before this file: replayed as
--                                 it always was. Refusing would turn a genuine
--                                 retry of an order that exists into an error.
--      A newly created order is stamped in the same transaction, after the
--      PG-27 backstop. An order that already existed is never stamped.
--   A new order cannot be created under the same key instead: orders_idempotency_
--   idx refuses a second row for it, so refusing is the only safe answer.
--
-- F-D1-003 - THE DEFECT, confirmed in the code and the Production setting
-- (online_payment_enabled = true per docs/MIGRATIONS.md ledger row 127). A
-- checkout session lives 30 minutes; the payment attempt opened inside it lives
-- up to 60 more (begin_session_attempt, payment-initiate invoiceExpiryForAttempt),
-- and finalize_checkout_session accepts an 'expired' session. begin_checkout_
-- session sweeps a lapsed session to 'expired' and its retry lookup then skips
-- it. So the same key with the same inputs, tapped after minute 30 while the
-- first invoice is still open, creates a SECOND session and a second invoice
-- for one cart; a customer who pays both is charged twice and gets two orders.
-- The lookup is widened to find an expired, unconsumed session that still has
-- a payment attempt that can be paid - 'initiated' and inside its own
-- expires_at, or 'authorized'. For the SAME inputs the retry is refused with
-- 'checkout_session_mismatch: payment_open' rather than handed the session: it
-- is expired, so begin_session_attempt would refuse it as not payable and the
-- caller could do nothing with it. For DIFFERENT inputs the existing payment_open
-- refusal (the "dead attempt" test of 20261020) now applies to it as well.
-- A session with no live attempt is not found and is replaced exactly as before.
-- The block lasts at most as long as the attempt's own window and is cleared at
-- once by the customer abandoning that payment (payment-verify, abandon).
--
-- WHAT THIS DOES NOT CHANGE
--   * place_order, compute_order_snapshot, insert_order_from_snapshot,
--     finalize_checkout_session, begin_session_attempt and
--     checkout_session_may_still_capture are asserted unmoved against pre-images
--     read at the top of this file.
--   * Late settlement AFTER an attempt's window (the 24-hour grace the catalog
--     guard uses) still does not hold a customer's key. That residual is stated
--     rather than closed: blocking a retry for a day to cover it would cost far
--     more customers than it protects.
--   * Orders without a fingerprint row (everything placed before this file, and
--     orders placed with no key) are replayed exactly as before.
--   * The fingerprint is a sha256, not the inputs. It is stored with the order
--     and removed with it.
--   * No Edge Function, no app code, no deploy. The app half would be to
--     reword checkoutEarlierPaymentOpen, which says "for different order
--     details"; for the same-inputs case that wording is slightly off but safe
--     ("try again in a few minutes").
--
-- PRE-IMAGES (read from the local chain at 20261023120000; the live read is part
-- of the apply steps and must match before this file is sent):
--
--                               md5(prosrc)                       md5(pg_get_functiondef)
--   begin_checkout_session      bb7292aa64d8ac6d7c3a11b30a477b30  5e274a8d2e8be25af9343f41b80df177
--   place_customer_order        dc7d0f140c6d987ed46cb6cf0c9fdc59  971aa034eaffae72a38c030134aa4615
--   place_order (unmoved)       ea2b65d4cf47dad464d46b1cd9735c6e  7078c7ddc36eb5eb0f7b0fc86b26dc8d
--   compute_order_snapshot      (unmoved)                         22e2d42935459e7bf93abb2941b56325
--   insert_order_from_snapshot  (unmoved)                         da9e57fe5da7ed0d5fc9895a4fb118de
--
-- POST-IMAGES, what this file stores (md5(pg_get_functiondef)). THESE TWO HASHES
-- CHANGE; THE MONEY-PATH PAIR DOES NOT:
--
--   begin_checkout_session      6bbcfb658a8573c9bc59e4258738f412
--   place_customer_order        4a0a4acce1357f59b0490acd39b7247e
--   checkout_input_fingerprint  new
--
-- FIDELITY, asserted by the closing block rather than claimed: each new body,
-- with this file's edits reversed (the same fragments that built it) and with
-- comments and whitespace normalised, hashes to its pre-image's normalised md5.
-- That is the check that "unrelated behaviour is preserved" - every statement
-- that is not one of the listed edits is byte-identical to what ran before.
--
-- Apply by version, never as "the outstanding migrations": 20260824100000
-- (Moyasar, frozen under CLAUDE.md section 6) sorts ahead of everything.

-- ---------------------------------------------------------------------------
-- 0. Preconditions and pre-images
-- ---------------------------------------------------------------------------
create or replace function pg_temp.sma_nrm(t text) returns text language sql immutable as $f$
  select btrim(regexp_replace(regexp_replace(t, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'));
$f$;

do $pre$
declare
  v_n   integer;
  v_raw text;
  v_pre jsonb;
begin
  -- Cardinality first: every read below takes ONE body.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_checkout_session';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 begin_checkout_session, found %', v_n; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_customer_order';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 place_customer_order, found %', v_n; end if;

  -- 20261020120000 must be in place: its column is what the fingerprint fills.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'checkout_sessions' and column_name = 'input_fingerprint';
  if v_n <> 1 then raise exception 'PRECONDITION: apply 20261020120000 first (checkout_sessions.input_fingerprint)'; end if;

  -- Each replaced function is either the body this file was derived from or this
  -- file's own (a re-apply).
  select p.prosrc into v_raw from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_checkout_session';
  if md5(v_raw) is distinct from 'bb7292aa64d8ac6d7c3a11b30a477b30'
     and position('checkout_input_fingerprint' in v_raw) = 0 then
    raise exception 'PRECONDITION: begin_checkout_session is neither the 20261020120000 body nor this file''s (md5 %)', md5(v_raw);
  end if;
  select p.prosrc into v_raw from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_customer_order';
  if md5(v_raw) is distinct from 'dc7d0f140c6d987ed46cb6cf0c9fdc59'
     and position('checkout_input_fingerprint' in v_raw) = 0 then
    raise exception 'PRECONDITION: place_customer_order is neither the 20261012120000 body nor this file''s (md5 %)', md5(v_raw);
  end if;

  -- The functions this file must NOT move, read before anything else runs. A
  -- session setting rather than a temporary table, so it survives whether or not
  -- the file runs inside one transaction.
  select coalesce(jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))), '{}'::jsonb)
    into v_pre
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('place_order', 'compute_order_snapshot', 'insert_order_from_snapshot',
                       'finalize_checkout_session', 'begin_session_attempt',
                       'checkout_session_may_still_capture');
  select count(*) into v_n from jsonb_object_keys(v_pre);
  if v_n <> 6 then raise exception 'PRECONDITION: expected 6 unmoved functions, found %', v_n; end if;
  perform set_config('sma_20261024120000.preimage', v_pre::text, false);
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. The fingerprint, in one place
-- ---------------------------------------------------------------------------
-- Every input a cart-to-order call prices from. jsonb_build_object keeps a key
-- whose value is NULL, so "no coupon" and "empty coupon" stay distinct; jsonb
-- text is canonical (key order and whitespace normalised), so a retry sending
-- the same body always produces the same value. The points are normalised the
-- way the row stores them. STABLE, not IMMUTABLE: the enum's output function is.
create or replace function public.checkout_input_fingerprint(
  p_branch_id      uuid,
  p_order_type     public.order_type,
  p_items          jsonb,
  p_address_id     uuid,
  p_coupon_code    text,
  p_notes          text,
  p_loyalty_points integer
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'branch_id', p_branch_id,
    'order_type', p_order_type,
    'items', p_items,
    'address_id', p_address_id,
    'coupon_code', p_coupon_code,
    'notes', p_notes,
    'loyalty_points', greatest(0, coalesce(p_loyalty_points, 0))
  )::text, 'UTF8')), 'hex');
$$;

revoke all on function public.checkout_input_fingerprint(uuid, public.order_type, jsonb, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.checkout_input_fingerprint(uuid, public.order_type, jsonb, uuid, text, text, integer) to service_role;

comment on function public.checkout_input_fingerprint(uuid, public.order_type, jsonb, uuid, text, text, integer) is
  'sha256 over every input a cart-to-order call prices from (branch, order type, items, address, coupon, notes, points). Shared by begin_checkout_session (card, 20261020120000) and place_customer_order (cash, 20261024120000) so the two cannot drift.';

-- ---------------------------------------------------------------------------
-- 2. The fingerprint of each order the wrapper creates under a key
-- ---------------------------------------------------------------------------
create table if not exists public.order_input_fingerprints (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now()
);

alter table public.order_input_fingerprints enable row level security;
-- No policy: RLS denies every client role. Revoked as well, because this
-- project's default privileges grant new tables to anon and authenticated.
revoke all on table public.order_input_fingerprints from public, anon, authenticated;
grant all on table public.order_input_fingerprints to service_role;

comment on table public.order_input_fingerprints is
  'sha256 of the inputs a cash order was placed with, written by place_customer_order for an order created under an idempotency key (20261024120000, audit F-D1-001). A retry under the same key with different inputs is refused instead of answered with this order. Absent for orders placed before that file. Never readable by a client.';

-- ---------------------------------------------------------------------------
-- 3. begin_checkout_session: shared fingerprint; an expired session with a
--    payment that can still be made is found, and waited for (F-D1-003)
-- ---------------------------------------------------------------------------
create or replace function public.begin_checkout_session(
  p_branch_id       uuid,
  p_order_type      public.order_type,
  p_items           jsonb,
  p_address_id      uuid    default null,
  p_coupon_code     text    default null,
  p_notes           text    default null,
  p_loyalty_points  integer default 0,
  p_idempotency_key uuid    default null
)
returns public.checkout_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid := auth.uid();
  v_settings public.app_settings;
  v_snapshot jsonb;
  v_session  public.checkout_sessions;
  v_existing public.checkout_sessions;
  v_order    public.orders;
  v_fingerprint text;
begin
  if v_customer is null then
    raise exception 'Authentication is required to place an order' using errcode = '28000';
  end if;

  -- Every input this call prices from, hashed by the ONE function the cash path
  -- also uses (checkout_input_fingerprint, above), so the two cannot drift. The
  -- value is byte-for-byte what the inline expression of 20261020120000 produced.
  v_fingerprint := public.checkout_input_fingerprint(
    p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code, p_notes, p_loyalty_points);

  -- Expire this customer's stale sessions FIRST: frees the partial unique index
  -- (customer_id, idempotency_key) WHERE status='pending_payment', which would
  -- otherwise raise on a retried Confirm after the 30-minute window.
  update public.checkout_sessions
     set status = 'expired'
   where customer_id = v_customer and status = 'pending_payment' and expires_at <= now();

  -- Refused before the lookup, so a session for this key cannot answer for a
  -- branch that does not exist. Same sentence as compute_order_snapshot.
  if p_branch_id is null or not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'The selected branch is not available' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    -- Two kinds of session are reusable, and until now only the first was found.
    --
    --   * still live      - pending_payment and inside its window, the ordinary
    --                       "customer tapped Confirm twice" case;
    --   * already settled - order_id is not null. A zero-total session is
    --                       created, consumed and given its order inside a
    --                       SINGLE call, so by the time a retry arrives it is no
    --                       longer 'pending_payment' and the old lookup missed
    --                       it entirely - falling through to create a SECOND
    --                       session and a SECOND free order. Matching on
    --                       order_id rather than on a status list also covers a
    --                       session consumed by finalize_checkout_session.
    --
    --   * expired but still payable (F-D1-003) - the session window is 30
    --                       minutes, but an attempt opened inside it lives for
    --                       up to 60 more, bounded by the attempt and not by the
    --                       session (payment-initiate, invoiceExpiryForAttempt),
    --                       and finalize_checkout_session accepts 'expired'. The
    --                       lookup skipped such a session, so the same key and
    --                       the same inputs opened a SECOND session and a second
    --                       invoice while the first could still be paid. "Still
    --                       payable" is the attempt's own window: an 'initiated'
    --                       attempt that has not reached its expires_at, or an
    --                       'authorized' one. A failed or lapsed attempt does not
    --                       hold the key; the 24-hour late-settlement grace of
    --                       checkout_session_may_still_capture is deliberately
    --                       not extended to a customer's retry.
    --
    -- Locked, because a mismatch below may retire it: begin_session_attempt
    -- takes the same row lock before it opens an attempt.
    select * into v_existing from public.checkout_sessions cs
      where cs.customer_id = v_customer and cs.idempotency_key = p_idempotency_key
        and (cs.order_id is not null
             or (cs.status = 'pending_payment' and cs.expires_at > now())
             or (cs.status = 'expired'
                 and exists (
                   select 1 from public.payment_records pr
                    where pr.checkout_session_id = cs.id
                      and (pr.status = 'authorized'
                           or (pr.status = 'initiated'
                               and coalesce(pr.expires_at, pr.created_at + interval '60 minutes') > now())))))
      order by cs.created_at desc limit 1
      for update of cs;
    if found then
      -- Reused ONLY for the inputs it was priced on (F-X02-001).
      if v_existing.input_fingerprint is not distinct from v_fingerprint then
        -- An expired session is never handed back: begin_session_attempt
        -- refuses it as not payable, so the caller could do nothing with it.
        -- The payment on it can still be completed, so this retry waits for it
        -- instead of opening a second invoice (F-D1-003).
        if v_existing.order_id is null and v_existing.status = 'expired' then
          raise exception 'checkout_session_mismatch: payment_open'
            using errcode = 'P0001',
                  detail  = 'A checkout for this idempotency key has a payment that may still be completed; its session has timed out, but the payment page is still open.',
                  hint    = 'Wait for that payment to finish or expire, then try again.';
        end if;
        return v_existing;
      end if;

      if v_existing.order_id is not null then
        raise exception 'checkout_session_mismatch: order_placed'
          using errcode = 'P0001',
                detail  = 'An order already exists for this idempotency key, placed with different inputs.',
                hint    = 'Use a new idempotency key for a changed order.';
      end if;

      -- Still pending_payment. Replace it only when nothing on it can still be
      -- paid; see "WHAT DEAD MEANS" in this file's header.
      if exists (
        select 1 from public.payment_records pr
         where pr.checkout_session_id = v_existing.id
           and not (pr.status = 'failed'
                    and (pr.failure_code = 'invoice_canceled'
                         or (pr.provider_checkout_ref is null and pr.provider_ref is null)))
      ) then
        raise exception 'checkout_session_mismatch: payment_open'
          using errcode = 'P0001',
                detail  = 'A checkout for this idempotency key has a payment that may still be completed, for different inputs.',
                hint    = 'Abandon or resolve that checkout, or use a new idempotency key.';
      end if;

      -- 'expired', never 'cancelled': finalize_checkout_session still accepts
      -- an expired session, so a captured payment is never refused.
      update public.checkout_sessions
         set status = 'expired'
       where id = v_existing.id;
    end if;
  end if;

  select * into v_settings from public.app_settings where id = true;
  if not coalesce(v_settings.online_payment_enabled, false) then
    raise exception 'Online payment is not available' using errcode = 'P0001';
  end if;

  v_snapshot := public.compute_order_snapshot(
    v_customer, p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code, p_loyalty_points);

  insert into public.checkout_sessions (
    customer_id, status, order_type, payment_method, branch_id, address_id, coupon_code, notes,
    loyalty_points, snapshot, subtotal, delivery_fee, discount_amount, loyalty_discount_amount,
    vat_amount, total, currency, idempotency_key, input_fingerprint
  ) values (
    v_customer, 'pending_payment', p_order_type, 'online', p_branch_id,
    nullif(v_snapshot->>'address_id','')::uuid, p_coupon_code, p_notes,
    greatest(0, coalesce(p_loyalty_points,0)), v_snapshot,
    (v_snapshot->>'subtotal')::numeric, (v_snapshot->>'delivery_fee')::numeric,
    (v_snapshot->>'discount_amount')::numeric, (v_snapshot->>'loyalty_discount_amount')::numeric,
    (v_snapshot->>'vat_amount')::numeric, (v_snapshot->>'total')::numeric, 'SAR', p_idempotency_key,
    v_fingerprint
  )
  returning * into v_session;

  -- Zero-total (fully covered): nothing to charge — settle immediately.
  if v_session.total <= 0 then
    begin
      -- The key is now carried onto the ORDER as well. The lookup above stops a
      -- sequential retry; this stops a concurrent one, because
      -- orders_idempotency_idx (20260707121400:14) refuses the second insert
      -- instead of letting two free orders exist for one cart.
      v_order := public.insert_order_from_snapshot(
        v_customer, v_snapshot || jsonb_build_object('notes', p_notes),
        'online', 'paid', p_idempotency_key, null);
    exception when unique_violation then
      -- Only the idempotency index may be recovered from. Without a key it
      -- cannot have been that index, so the error is something else and must
      -- not be swallowed; the same is true if the supposed winner is absent.
      if p_idempotency_key is null then raise; end if;
      select * into v_order from public.orders
        where customer_id = v_customer and idempotency_key = p_idempotency_key;
      if not found then raise; end if;

      -- Another call won the race, and its session is already settled against
      -- this order. Hand back THAT session and drop the one this call just
      -- inserted, so one key still means one session.
      --
      -- The session-level index cannot do this on its own: it is partial on
      -- status = 'pending_payment', so the winner leaves it the moment it
      -- consumes itself, and this call's insert then succeeds. Without the
      -- delete the money would still be right - one order, recovered above -
      -- but two settled sessions would exist for one key, which is precisely
      -- what the lookup at the top of this function promises does not happen.
      --
      -- Deleting is safe here and only here: the row was inserted by THIS
      -- transaction moments ago, it is still 'pending_payment', and a
      -- zero-total session never reaches a payment attempt, so no
      -- payment_records row references it.
      --
      -- NOT COVERED BY THE SUITE, and said plainly rather than left to be
      -- assumed. This branch is reachable only when two transactions overlap:
      -- the loser's reuse lookup has to run BEFORE the winner commits, and its
      -- recovery lookup AFTER. A single psql connection cannot produce that
      -- ordering - any state that hides the winner from the first lookup hides
      -- it from the second as well - so `comp_members_test.sql` exercises the
      -- sequential retry (which the lookup above handles) and stops there.
      -- Writing a case that merely appeared to cover this would be worse than
      -- the gap.
      select * into v_existing from public.checkout_sessions
        where customer_id = v_customer and idempotency_key = p_idempotency_key
          and order_id = v_order.id and id <> v_session.id
        order by created_at limit 1;
      if found then
        delete from public.checkout_sessions where id = v_session.id;
        return v_existing;
      end if;
    end;
    update public.checkout_sessions
      set status = 'consumed', order_id = v_order.id, consumed_at = now()
      where id = v_session.id
      returning * into v_session;
  end if;

  return v_session;
end $$;

-- Grants re-stated exactly as 20261020120000 left them. `from public, anon`
-- matters: this project's default privileges grant EXECUTE to anon directly
-- (CLAUDE.md section 8).
revoke all on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. place_customer_order: a cash retry is answered only for its own inputs
--    (F-D1-001)
-- ---------------------------------------------------------------------------
create or replace function public.place_customer_order(
  p_branch_id       uuid,
  p_order_type      public.order_type,
  p_items           jsonb,
  p_address_id      uuid    default null,
  p_coupon_code     text    default null,
  p_notes           text    default null,
  p_loyalty_points  integer default 0,
  p_idempotency_key uuid    default null,
  p_payment_method  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      public.orders;
  v_uid        uuid := auth.uid();
  v_verified   boolean;
  v_open_limit integer;
  v_hour_limit integer;
  v_open       integer;
  v_hour       integer;
  -- F-D1-001 (20261024120000).
  v_fp         text;
  v_prior_id   uuid;
  v_prior_fp   text;
begin
  -- PG-27 (20261012120000). The app pays by card through checkout sessions,
  -- which create the order only once the payment is verified. An online order
  -- placed here would wait unpaid, so it is refused before anything is locked
  -- or written. The method is normalised exactly as place_order normalises it.
  if lower(nullif(btrim(coalesce(p_payment_method, '')), '')) = 'online' then
    raise exception
      using
        errcode = 'P0001',
        message = 'Card payment orders cannot be placed here. Pay by card at checkout.',
        hint    = 'online_orders_use_checkout';
  end if;

  -- S04#1. At most 50 of one item per line, read exactly as place_order reads
  -- it. The constraint name in the message is what the app matches on.
  if jsonb_typeof(p_items) = 'array' and exists (
       select 1 from jsonb_array_elements(p_items) as e(value)
        where coalesce((e.value ->> 'quantity')::int, 0) > 50) then
    raise exception
      using
        errcode    = '23514',
        constraint = 'order_items_quantity_max',
        message    = 'order_items_quantity_max: at most 50 of one item per order line.';
  end if;

  -- No caller: place_order raises its own 28000, unchanged.
  if v_uid is not null then
    perform pg_advisory_xact_lock(hashtext('spicymeal:place-customer-order:' || v_uid::text));

    -- F-D1-001. place_order returns the order that already holds this key
    -- without looking at what THIS call asks for, and the app's cash key stands
    -- for the item list only, so a retry after a lost response that changed the
    -- branch, order type, address, coupon, notes or points was told "done" for
    -- the old order. The fingerprint the card path uses is stored with every new
    -- order and compared here, under the per-customer lock above, so the compare,
    -- the order and the stamp are one atomic step.
    --
    --   * same inputs      - falls through; place_order replays the order, so a
    --                        genuine retry never makes a second ticket or a
    --                        second redemption;
    --   * different inputs - refused with the card path's own sentence, which
    --                        every shipped build already translates;
    --   * no fingerprint   - an order placed before this file: replayed as it
    --                        always was.
    if p_idempotency_key is not null then
      v_fp := public.checkout_input_fingerprint(
        p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code, p_notes, p_loyalty_points);
      select o.id, f.fingerprint into v_prior_id, v_prior_fp
        from public.orders o
        left join public.order_input_fingerprints f on f.order_id = o.id
       where o.customer_id = v_uid and o.idempotency_key = p_idempotency_key;
      if v_prior_id is not null and v_prior_fp is not null and v_prior_fp is distinct from v_fp then
        raise exception 'checkout_session_mismatch: order_placed'
          using errcode = 'P0001',
                detail  = 'An order already exists for this idempotency key, placed with different inputs.',
                hint    = 'Use a new idempotency key for a changed order.';
      end if;
    end if;

    -- A retry of an order that already exists is not a new order. place_order
    -- returns the existing row for it, so the limits must not refuse it.
    if p_idempotency_key is null
       or not exists (select 1 from public.orders o
                       where o.customer_id = v_uid
                         and o.idempotency_key = p_idempotency_key) then

      select p.phone_verified into v_verified
        from public.profiles p where p.id = v_uid;
      if v_verified is distinct from true then
        raise exception
          using
            errcode = 'P0001',
            message = 'Please verify your phone number before placing an order.',
            hint    = 'Sign in with your WhatsApp number.';
      end if;

      select s.order_limit_open, s.order_limit_per_hour
        into v_open_limit, v_hour_limit
        from public.app_settings s where s.id = true;
      v_open_limit := coalesce(v_open_limit, 5);
      v_hour_limit := coalesce(v_hour_limit, 10);

      select count(*) into v_open
        from public.orders o
       where o.customer_id = v_uid
         and o.status in ('received', 'preparing', 'ready', 'out_for_delivery')
         and o.created_at > now() - interval '24 hours';
      if v_open >= v_open_limit then
        raise exception
          using
            errcode = 'P0001',
            message = format('You already have %s orders in progress. Please wait until one is ready before placing another.', v_open);
      end if;

      select count(*) into v_hour
        from public.orders o
       where o.customer_id = v_uid
         and o.created_at > now() - interval '1 hour';
      if v_hour >= v_hour_limit then
        raise exception
          using
            errcode = 'P0001',
            message = format('You have placed %s orders in the last hour. Please try again later.', v_hour);
      end if;
    end if;
  end if;

  v_order := public.place_order(
    p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code,
    p_notes, p_loyalty_points, p_idempotency_key, p_payment_method);

  -- PG-27 backstop. A call with no method takes app_settings' default, which
  -- place_order can resolve to online. Raising here rolls the order back; the
  -- SM- number it drew stays used, because a sequence is not transactional.
  if v_order.payment_method = 'online' then
    raise exception
      using
        errcode = 'P0001',
        message = 'Card payment orders cannot be placed here. Pay by card at checkout.',
        hint    = 'online_orders_use_checkout';
  end if;

  -- F-D1-001. Stamp an order THIS call created, in the same transaction. An
  -- order that already existed is never stamped: a replay of an older order must
  -- not be pinned to inputs it was not placed with.
  if v_uid is not null and p_idempotency_key is not null and v_prior_id is null then
    insert into public.order_input_fingerprints (order_id, fingerprint)
    values (v_order.id, v_fp)
    on conflict (order_id) do nothing;
  end if;

  -- EXPLICIT customer-safe projection, identical to the §1 column grant. No
  -- order_number, no pos_create_attempt_token, no POS/integration/refund/
  -- idempotency internals, no staff notes, no customer PII copies.
  return jsonb_build_object(
    'id',                        v_order.id,
    'status',                    v_order.status,
    'order_type',                v_order.order_type,
    'created_at',                v_order.created_at,
    'branch_id',                 v_order.branch_id,
    'branch_name_en',            v_order.branch_name_en,
    'branch_name_ar',            v_order.branch_name_ar,
    'subtotal',                  v_order.subtotal,
    'delivery_fee',              v_order.delivery_fee,
    'discount_amount',           v_order.discount_amount,
    'loyalty_discount_amount',   v_order.loyalty_discount_amount,
    'vat_amount',                v_order.vat_amount,
    'total',                     v_order.total,
    'loyalty_points_earned',     v_order.loyalty_points_earned,
    'payment_status',            v_order.payment_status,
    'payment_method',            v_order.payment_method,
    'lazywait_order_number',     v_order.lazywait_order_number,
    'lazywait_sync_state',       v_order.lazywait_sync_state,
    'lazywait_ref',              v_order.lazywait_ref,
    'sync_blocked_reason',       v_order.sync_blocked_reason,
    'sync_next_attempt_at',      v_order.sync_next_attempt_at,
    'pos_create_attempted_at',   v_order.pos_create_attempted_at,
    'pos_customer_retry_count',  v_order.pos_customer_retry_count,
    'refund_state',              v_order.refund_state
  );
end $$;

revoke all on function public.place_customer_order(
  uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text
) from public, anon;
grant execute on function public.place_customer_order(
  uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text
) to authenticated;
comment on function public.place_customer_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text) is
  'Customer-facing wrapper over the UNCHANGED place_order. Refuses an online order, asked for or resolved from the default (hint online_orders_use_checkout; card payment goes through begin_checkout_session, since 20261012120000). Refuses a caller who is not phone_verified or is over app_settings.order_limit_open / order_limit_per_hour, serialised per caller (20261005120000). Refuses a retry under an existing idempotency key whose inputs differ from the order''s (checkout_session_mismatch: order_placed, 20261024120000). Otherwise identical pricing, coupons, VAT, loyalty, transactionality and idempotency, returning an explicit customer-safe projection (20260724200000).';

-- ---------------------------------------------------------------------------
-- 5. Self-verification. Every check fails explicitly on NULL.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_src    text;
  v_norm   text;
  v_n      integer;
  v_def    boolean;
  v_cfg    text[];
  v_state  text;
  v_msg    text;
  v_branch uuid;
  v_pre    jsonb;
  v_a      text;
  v_b      text;
  i        integer;
  r        record;
  v_pairs  text[];
  v_cmp    text;
begin
  -- ---- helper ---------------------------------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'checkout_input_fingerprint';
  if v_n is distinct from 1 then raise exception 'VERIFY: expected one checkout_input_fingerprint, found %', v_n; end if;
  if has_function_privilege('anon', 'public.checkout_input_fingerprint(uuid, public.order_type, jsonb, uuid, text, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.checkout_input_fingerprint(uuid, public.order_type, jsonb, uuid, text, text, integer)', 'execute') then
    raise exception 'VERIFY: a client role can execute checkout_input_fingerprint';
  end if;

  -- Byte-for-byte what 20261020120000 computed inline: the stored fingerprints of
  -- live checkout sessions must still match. Two probes, one with every optional
  -- input NULL and negative points, one with everything set.
  v_a := public.checkout_input_fingerprint(
    'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup', '[{"product_id":"x","quantity":2}]'::jsonb,
    null, null, null, -5);
  v_b := encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'branch_id', 'b0000000-0000-0000-0000-000000000001'::uuid,
    'order_type', 'pickup'::public.order_type,
    'items', '[{"product_id":"x","quantity":2}]'::jsonb,
    'address_id', null::uuid,
    'coupon_code', null::text,
    'notes', null::text,
    'loyalty_points', greatest(0, coalesce(-5, 0))
  )::text, 'UTF8')), 'hex');
  if v_a is null or v_a is distinct from v_b then
    raise exception 'VERIFY: checkout_input_fingerprint differs from the 20261020120000 expression (% vs %)', v_a, v_b;
  end if;
  v_a := public.checkout_input_fingerprint(
    'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery', '[]'::jsonb,
    'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE10', 'ring twice', 300);
  v_b := encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'branch_id', 'b0000000-0000-0000-0000-000000000001'::uuid,
    'order_type', 'delivery'::public.order_type,
    'items', '[]'::jsonb,
    'address_id', 'a0000000-0000-0000-0000-0000000000a1'::uuid,
    'coupon_code', 'SAVE10'::text,
    'notes', 'ring twice'::text,
    'loyalty_points', greatest(0, coalesce(300, 0))
  )::text, 'UTF8')), 'hex');
  if v_a is null or v_a is distinct from v_b then
    raise exception 'VERIFY: checkout_input_fingerprint (all inputs set) differs from the 20261020120000 expression';
  end if;
  -- Each input moves the value, and the same inputs give the same value.
  v_b := public.checkout_input_fingerprint(
    'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery', '[]'::jsonb,
    'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE10', 'ring twice', 300);
  if v_a is distinct from v_b then raise exception 'VERIFY: checkout_input_fingerprint is not deterministic'; end if;
  for r in select * from (values
      ('branch',  public.checkout_input_fingerprint('b0000000-0000-0000-0000-000000000002'::uuid, 'delivery', '[]'::jsonb, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE10', 'ring twice', 300)),
      ('type',    public.checkout_input_fingerprint('b0000000-0000-0000-0000-000000000001'::uuid, 'pickup', '[]'::jsonb, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE10', 'ring twice', 300)),
      ('items',   public.checkout_input_fingerprint('b0000000-0000-0000-0000-000000000001'::uuid, 'delivery', '[1]'::jsonb, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE10', 'ring twice', 300)),
      ('address', public.checkout_input_fingerprint('b0000000-0000-0000-0000-000000000001'::uuid, 'delivery', '[]'::jsonb, 'a0000000-0000-0000-0000-0000000000a2'::uuid, 'SAVE10', 'ring twice', 300)),
      ('coupon',  public.checkout_input_fingerprint('b0000000-0000-0000-0000-000000000001'::uuid, 'delivery', '[]'::jsonb, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE20', 'ring twice', 300)),
      ('notes',   public.checkout_input_fingerprint('b0000000-0000-0000-0000-000000000001'::uuid, 'delivery', '[]'::jsonb, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE10', 'ring once', 300)),
      ('points',  public.checkout_input_fingerprint('b0000000-0000-0000-0000-000000000001'::uuid, 'delivery', '[]'::jsonb, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'SAVE10', 'ring twice', 301))
    ) as t(label, fp)
  loop
    if r.fp is null or r.fp = v_a then raise exception 'VERIFY: changing the % does not change the fingerprint', r.label; end if;
  end loop;

  -- ---- table ----------------------------------------------------------------
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'order_input_fingerprints' and c.relkind = 'r' and c.relrowsecurity;
  if v_n is distinct from 1 then raise exception 'VERIFY: order_input_fingerprints missing or RLS off'; end if;
  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'order_input_fingerprints';
  if v_n is distinct from 0 then raise exception 'VERIFY: order_input_fingerprints has % policies, expected none', v_n; end if;
  foreach v_a in array array['anon', 'authenticated'] loop
    foreach v_b in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege(v_a, 'public.order_input_fingerprints', v_b) then
        raise exception 'VERIFY: % can % order_input_fingerprints', v_a, v_b;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role', 'public.order_input_fingerprints', 'insert') then
    raise exception 'VERIFY: service_role cannot write order_input_fingerprints';
  end if;
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.order_input_fingerprints'::regclass and contype = 'f' and confdeltype = 'c';
  if v_n is distinct from 1 then raise exception 'VERIFY: order_input_fingerprints lost ON DELETE CASCADE to orders'; end if;

  -- ---- both replaced functions: one overload, definer, search_path, grants ---
  for r in select * from (values
      ('begin_checkout_session', 'public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid)'),
      ('place_customer_order',   'public.place_customer_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)')
    ) as t(fname, sig)
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fname;
    if v_n is distinct from 1 then raise exception 'VERIFY: expected one %, found %', r.fname, v_n; end if;
    select p.prosecdef, p.proconfig into v_def, v_cfg
      from pg_proc p where p.oid = r.sig::regprocedure;
    if v_def is distinct from true then raise exception 'VERIFY: % is not SECURITY DEFINER', r.fname; end if;
    if v_cfg is null or not ('search_path=public' = any (v_cfg)) then
      raise exception 'VERIFY: % lost search_path=public (%)', r.fname, v_cfg;
    end if;
    if has_function_privilege('anon', r.sig, 'execute') then raise exception 'VERIFY: anon can execute %', r.fname; end if;
    if not has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception 'VERIFY: authenticated lost EXECUTE on %', r.fname;
    end if;
  end loop;

  -- ---- statements present (comments stripped, so a comment cannot satisfy) ---
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_checkout_session';
  v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');
  for r in select * from (values
      ('shared fingerprint',        'v_fingerprint := public.checkout_input_fingerprint('),
      ('fingerprint compared',      'if v_existing.input_fingerprint is not distinct from v_fingerprint then'),
      ('expired branch in lookup',  'or (cs.status = ''expired'''),
      ('attempt window bound',      'coalesce(pr.expires_at, pr.created_at + interval ''60 minutes'') > now()'),
      ('authorized holds the key',  'pr.status = ''authorized'''),
      ('lookup locked',             'for update of cs;'),
      ('expired same-input refusal','if v_existing.order_id is null and v_existing.status = ''expired'' then'),
      ('open-payment refusal',      'raise exception ''checkout_session_mismatch: payment_open'''),
      ('settled refusal',           '''checkout_session_mismatch: order_placed'''),
      ('dead predicate',            'pr.failure_code = ''invoice_canceled'''),
      ('retire as expired',         'set status = ''expired''
       where id = v_existing.id'),
      ('gate kept',                 'Online payment is not available'),
      ('zero-total kept',           '''online'', ''paid'', p_idempotency_key, null)')
    ) as t(label, needle)
  loop
    if position(r.needle in v_src) = 0 then raise exception 'VERIFY: begin_checkout_session lost: %', r.label; end if;
  end loop;
  select count(*) into v_n from regexp_matches(v_src, 'raise exception ''checkout_session_mismatch: payment_open''', 'g');
  if v_n is distinct from 2 then raise exception 'VERIFY: expected 2 payment_open refusals, found %', v_n; end if;
  select count(*) into v_n from regexp_matches(v_src, 'return v_existing;', 'g');
  if v_n is distinct from 2 then raise exception 'VERIFY: expected 2 return v_existing, found %', v_n; end if;
  if position('''cancelled''' in v_src) > 0 then raise exception 'VERIFY: begin_checkout_session writes status cancelled'; end if;
  if position('encode(sha256' in v_src) > 0 then raise exception 'VERIFY: begin_checkout_session still hashes inline'; end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_customer_order';
  v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');
  for r in select * from (values
      ('shared fingerprint',   'v_fp := public.checkout_input_fingerprint('),
      ('prior order read',     'left join public.order_input_fingerprints f on f.order_id = o.id'),
      ('mismatch compared',    'v_prior_fp is not null and v_prior_fp is distinct from v_fp'),
      ('mismatch refusal',     'raise exception ''checkout_session_mismatch: order_placed'''),
      ('stamp',                'insert into public.order_input_fingerprints (order_id, fingerprint)'),
      ('stamp only new',       'and p_idempotency_key is not null and v_prior_id is null then'),
      ('stamp idempotent',     'on conflict (order_id) do nothing;'),
      ('online refusal kept',  'online_orders_use_checkout'),
      ('quantity bound kept',  'order_items_quantity_max'),
      ('lock kept',            'pg_advisory_xact_lock(hashtext(''spicymeal:place-customer-order:'''),
      ('phone rule kept',      'Please verify your phone number before placing an order.'),
      ('place_order called',   'v_order := public.place_order(')
    ) as t(label, needle)
  loop
    if position(r.needle in v_src) = 0 then raise exception 'VERIFY: place_customer_order lost: %', r.label; end if;
  end loop;
  select count(*) into v_n from regexp_matches(v_src, 'public\.place_order\(', 'g');
  if v_n is distinct from 1 then raise exception 'VERIFY: place_customer_order calls place_order % times', v_n; end if;
  -- The refusal sits after the lock and BEFORE the limits and the place_order call.
  if position('left join public.order_input_fingerprints' in v_src) < position('pg_advisory_xact_lock' in v_src)
     or position('left join public.order_input_fingerprints' in v_src) > position('Please verify your phone number' in v_src) then
    raise exception 'VERIFY: place_customer_order compares the fingerprint outside the lock or after the limits';
  end if;
  -- The stamp comes after the call, and the projection after the stamp.
  if position('insert into public.order_input_fingerprints' in v_src) < position('v_order := public.place_order(' in v_src)
     or position('insert into public.order_input_fingerprints' in v_src) > position('jsonb_build_object' in v_src) then
    raise exception 'VERIFY: place_customer_order stamps outside the order transaction';
  end if;

  -- ---- unrelated behaviour is byte-identical ----------------------------------
  -- Reverse this file's edits in the stored body and compare, with comments and
  -- whitespace normalised, against the pre-image's normalised hash. Each fragment
  -- must occur exactly once. Everything the edits do not name is therefore the
  -- text that ran before.
  for r in select * from (values
      ('begin_checkout_session', '20a35ffc1d541ff0225ead5d9c080c64'),
      ('place_customer_order',   '59e9a3d67f858b54bfbb897cbfe4f08a')
    ) as t(fname, norm_md5)
  loop
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fname;
    v_norm := pg_temp.sma_nrm(v_src);
    if r.fname = 'begin_checkout_session' then
      v_pairs := array[
    $sma$  -- Every input this call prices from. jsonb_build_object keeps a key whose
  -- value is NULL, so "no coupon" and "empty coupon" stay distinct; jsonb text
  -- is canonical (key order and whitespace normalized), so a retry sending the
  -- same body always produces the same value. The points are normalized the
  -- way the row stores them.
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'branch_id', p_branch_id,
    'order_type', p_order_type,
    'items', p_items,
    'address_id', p_address_id,
    'coupon_code', p_coupon_code,
    'notes', p_notes,
    'loyalty_points', greatest(0, coalesce(p_loyalty_points, 0))
  )::text, 'UTF8')), 'hex');

$sma$,
    $sma$  -- Every input this call prices from, hashed by the ONE function the cash path
  -- also uses (checkout_input_fingerprint, above), so the two cannot drift. The
  -- value is byte-for-byte what the inline expression of 20261020120000 produced.
  v_fingerprint := public.checkout_input_fingerprint(
    p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code, p_notes, p_loyalty_points);

$sma$,
    $sma$    -- Locked, because a mismatch below may retire it: begin_session_attempt
    -- takes the same row lock before it opens an attempt.
    select * into v_existing from public.checkout_sessions
      where customer_id = v_customer and idempotency_key = p_idempotency_key
        and (order_id is not null
             or (status = 'pending_payment' and expires_at > now()))
      order by created_at desc limit 1
      for update;
    if found then
      -- Reused ONLY for the inputs it was priced on (F-X02-001).
      if v_existing.input_fingerprint is not distinct from v_fingerprint then
        return v_existing;
      end if;
$sma$,
    $sma$    --   * expired but still payable (F-D1-003) - the session window is 30
    --                       minutes, but an attempt opened inside it lives for
    --                       up to 60 more, bounded by the attempt and not by the
    --                       session (payment-initiate, invoiceExpiryForAttempt),
    --                       and finalize_checkout_session accepts 'expired'. The
    --                       lookup skipped such a session, so the same key and
    --                       the same inputs opened a SECOND session and a second
    --                       invoice while the first could still be paid. "Still
    --                       payable" is the attempt's own window: an 'initiated'
    --                       attempt that has not reached its expires_at, or an
    --                       'authorized' one. A failed or lapsed attempt does not
    --                       hold the key; the 24-hour late-settlement grace of
    --                       checkout_session_may_still_capture is deliberately
    --                       not extended to a customer's retry.
    --
    -- Locked, because a mismatch below may retire it: begin_session_attempt
    -- takes the same row lock before it opens an attempt.
    select * into v_existing from public.checkout_sessions cs
      where cs.customer_id = v_customer and cs.idempotency_key = p_idempotency_key
        and (cs.order_id is not null
             or (cs.status = 'pending_payment' and cs.expires_at > now())
             or (cs.status = 'expired'
                 and exists (
                   select 1 from public.payment_records pr
                    where pr.checkout_session_id = cs.id
                      and (pr.status = 'authorized'
                           or (pr.status = 'initiated'
                               and coalesce(pr.expires_at, pr.created_at + interval '60 minutes') > now())))))
      order by cs.created_at desc limit 1
      for update of cs;
    if found then
      -- Reused ONLY for the inputs it was priced on (F-X02-001).
      if v_existing.input_fingerprint is not distinct from v_fingerprint then
        -- An expired session is never handed back: begin_session_attempt
        -- refuses it as not payable, so the caller could do nothing with it.
        -- The payment on it can still be completed, so this retry waits for it
        -- instead of opening a second invoice (F-D1-003).
        if v_existing.order_id is null and v_existing.status = 'expired' then
          raise exception 'checkout_session_mismatch: payment_open'
            using errcode = 'P0001',
                  detail  = 'A checkout for this idempotency key has a payment that may still be completed; its session has timed out, but the payment page is still open.',
                  hint    = 'Wait for that payment to finish or expire, then try again.';
        end if;
        return v_existing;
      end if;
$sma$
      ];
    else
      v_pairs := array[
    $sma$  v_hour       integer;
begin
$sma$,
    $sma$  v_hour       integer;
  -- F-D1-001 (20261024120000).
  v_fp         text;
  v_prior_id   uuid;
  v_prior_fp   text;
begin
$sma$,
    $sma$    perform pg_advisory_xact_lock(hashtext('spicymeal:place-customer-order:' || v_uid::text));
$sma$,
    $sma$    perform pg_advisory_xact_lock(hashtext('spicymeal:place-customer-order:' || v_uid::text));

    -- F-D1-001. place_order returns the order that already holds this key
    -- without looking at what THIS call asks for, and the app's cash key stands
    -- for the item list only, so a retry after a lost response that changed the
    -- branch, order type, address, coupon, notes or points was told "done" for
    -- the old order. The fingerprint the card path uses is stored with every new
    -- order and compared here, under the per-customer lock above, so the compare,
    -- the order and the stamp are one atomic step.
    --
    --   * same inputs      - falls through; place_order replays the order, so a
    --                        genuine retry never makes a second ticket or a
    --                        second redemption;
    --   * different inputs - refused with the card path's own sentence, which
    --                        every shipped build already translates;
    --   * no fingerprint   - an order placed before this file: replayed as it
    --                        always was.
    if p_idempotency_key is not null then
      v_fp := public.checkout_input_fingerprint(
        p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code, p_notes, p_loyalty_points);
      select o.id, f.fingerprint into v_prior_id, v_prior_fp
        from public.orders o
        left join public.order_input_fingerprints f on f.order_id = o.id
       where o.customer_id = v_uid and o.idempotency_key = p_idempotency_key;
      if v_prior_id is not null and v_prior_fp is not null and v_prior_fp is distinct from v_fp then
        raise exception 'checkout_session_mismatch: order_placed'
          using errcode = 'P0001',
                detail  = 'An order already exists for this idempotency key, placed with different inputs.',
                hint    = 'Use a new idempotency key for a changed order.';
      end if;
    end if;
$sma$,
    $sma$  -- EXPLICIT customer-safe projection, identical to the §1 column grant.$sma$,
    $sma$  -- F-D1-001. Stamp an order THIS call created, in the same transaction. An
  -- order that already existed is never stamped: a replay of an older order must
  -- not be pinned to inputs it was not placed with.
  if v_uid is not null and p_idempotency_key is not null and v_prior_id is null then
    insert into public.order_input_fingerprints (order_id, fingerprint)
    values (v_order.id, v_fp)
    on conflict (order_id) do nothing;
  end if;

  -- EXPLICIT customer-safe projection, identical to the §1 column grant.$sma$
      ];
    end if;
    i := 1;
    while i < array_length(v_pairs, 1) loop
      -- v_pairs holds (old, new) in order: reverse by replacing new with old.
      v_a := pg_temp.sma_nrm(v_pairs[i + 1]);
      v_b := pg_temp.sma_nrm(v_pairs[i]);
      v_n := (length(v_norm) - length(replace(v_norm, v_a, ''))) / greatest(length(v_a), 1);
      if v_n is distinct from 1 then
        raise exception 'VERIFY: % edit % occurs % times in the stored body', r.fname, (i + 1) / 2, v_n;
      end if;
      v_norm := replace(v_norm, v_a, v_b);
      i := i + 2;
    end loop;
    v_cmp := md5(pg_temp.sma_nrm(v_norm));
    if v_cmp is distinct from r.norm_md5 then
      raise exception 'VERIFY: % with this file''s edits reversed hashes % , expected the pre-image %', r.fname, v_cmp, r.norm_md5;
    end if;
  end loop;

  -- ---- CALLED, not only stored: a plpgsql body is not name-resolved at creation.
  -- Each probe runs as a caller who owns nothing and raises before any write.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.begin_checkout_session(gen_random_uuid(), 'pickup', '[]'::jsonb, null, null, null, 0, gen_random_uuid());
    v_state := 'no error';
  exception when others then
    v_state := sqlstate; v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001' or v_msg is distinct from 'The selected branch is not available' then
    perform set_config('request.jwt.claim.sub', '', true);
    raise exception 'VERIFY: unknown branch not refused (% / %)', v_state, v_msg;
  end if;

  select id into v_branch from public.branches order by id limit 1;
  if v_branch is not null then
    -- Resolves the widened lookup (payment_records columns, the alias and the
    -- locked read). Any error is accepted EXCEPT an unresolved name.
    begin
      perform public.begin_checkout_session(v_branch, 'pickup', '[]'::jsonb, null, null, null, 0, gen_random_uuid());
      v_state := 'no error';
    exception when others then
      v_state := sqlstate; v_msg := sqlerrm;
    end;
    if v_state in ('no error', '42703', '42883', '42P01', '42702') then
      perform set_config('request.jwt.claim.sub', '', true);
      raise exception 'VERIFY: begin_checkout_session probe with a fresh key ended %: %', v_state, v_msg;
    end if;

    -- The wrapper: with a key it computes the fingerprint and reads the prior
    -- order through the new join, then stops at the phone rule for a caller who
    -- has no profile. Reading the outcome as a value, not a notice.
    begin
      perform public.place_customer_order(v_branch, 'pickup', '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
                                          null, null, null, 0, gen_random_uuid(), 'cash');
      v_state := 'no error';
    exception when others then
      v_state := sqlstate; v_msg := sqlerrm;
    end;
    if v_state is distinct from 'P0001' or v_msg is distinct from 'Please verify your phone number before placing an order.' then
      perform set_config('request.jwt.claim.sub', '', true);
      raise exception 'VERIFY: place_customer_order probe ended %: %', v_state, v_msg;
    end if;
  end if;
  perform set_config('request.jwt.claim.sub', '', true);

  -- The stamp statement's names resolve, read-only, with the identical shape.
  perform 1 from public.order_input_fingerprints f
    join public.orders o on o.id = f.order_id
   where f.order_id = gen_random_uuid() and f.fingerprint = repeat('0', 64);

  -- ---- nothing else moved ------------------------------------------------------
  v_pre := nullif(current_setting('sma_20261024120000.preimage', true), '')::jsonb;
  if v_pre is null then raise exception 'VERIFY: the pre-images were not recorded'; end if;
  select count(*) into v_n from jsonb_object_keys(v_pre);
  if v_n is distinct from 6 then raise exception 'VERIFY: expected 6 pre-images, recorded %', v_n; end if;
  for r in
    select pre.key as sig, pre.value as h, md5(pg_get_functiondef(p.oid)) as now_h
      from jsonb_each_text(v_pre) pre
      left join pg_proc p on p.oid::regprocedure::text = pre.key
  loop
    if r.now_h is distinct from r.h then
      raise exception 'VERIFY: % moved (% -> %)', r.sig, r.h, coalesce(r.now_h, 'NULL');
    end if;
  end loop;
end $verify$;
