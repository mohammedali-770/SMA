-- ===========================================================================
-- begin_checkout_session: reuse a session only for the inputs it was priced on
-- (audit finding F-X02-001, high; verdict confirmed 2026-11-22)
-- ===========================================================================
--
-- THE DEFECT. begin_checkout_session's retry lookup (20260826110000:90-97)
-- returned any session for the same customer and idempotency key that was
-- either settled or still pending_payment inside its 30-minute window. It
-- compared NONE of the inputs of the call in hand. The app's key stands for
-- the item list only (cartOrderSignature), so a customer who opened a card
-- payment for a pickup order, closed the page, switched to delivery (or
-- changed branch, address, coupon, points or notes) and paid again was handed
-- the OLD session: payment-initiate invoices `checkout_sessions.total`, and
-- finalize_checkout_session builds the order from `checkout_sessions.snapshot`.
-- The customer paid the old total and the kitchen got the old order. The
-- lookup also ran before compute_order_snapshot, so an unknown branch id was
-- not even refused when a session for the key existed.
--
-- THE FIX, one function body and one column:
--
--   1. checkout_sessions.input_fingerprint (text, nullable): sha256 over every
--      input the caller sends - branch, order type, items, address, coupon,
--      notes and points - with a version tag. Written on every new session.
--      A session created before this file has NULL and therefore matches
--      nothing; see "Rows written before this file" below.
--
--   2. The lookup returns the existing session ONLY when its fingerprint
--      equals this call's. On a mismatch it never returns the old session:
--
--        a. settled (order_id is not null): raise
--           'checkout_session_mismatch: order_placed'. An order already
--           exists for this key; nothing can be replaced.
--        b. pending_payment, and every payment attempt on it is DEAD (below):
--           the old session is retired to 'expired' and a new session is
--           priced from this call's inputs, under the same key.
--        c. pending_payment with any attempt that is not dead: raise
--           'checkout_session_mismatch: payment_open'.
--
--      Both raises are SQLSTATE P0001 (PostgREST answers HTTP 400) with a
--      stable machine-readable prefix the app matches
--      (apps/mobile/src/lib/errors/userMessage.ts), and a DETAIL naming the
--      reason.
--
--   3. An unknown branch id is refused before the lookup, with the sentence
--      compute_order_snapshot already uses ('The selected branch is not
--      available'), so a matching key can no longer bypass that check.
--
-- WHY REPLACE IN (b) RATHER THAN ALWAYS RAISING. Builds already in customers'
-- hands send the items-only key, and no app update reaches them. With a raise
-- only, such a build that changes order type after a cancelled payment would be
-- stuck on a generic error until the old session's window ran out. Replacing
-- gives that build the correctly priced session instead. The new app half
-- rotates its key on every input change, so it should never reach (b) or (c);
-- both remain for old builds and for defence in depth.
--
-- WHAT "DEAD" MEANS, and why it is this narrow. Read from payment-initiate,
-- payment-verify and begin_session_attempt (20261003120000):
--
--   * an attempt with status 'initiated' may be creating its invoice right
--     now, or have one the customer is paying: NOT dead;
--   * an attempt closed with an invoice that EXPIRED is not dead either: "a
--     payment made in time on the first invoice can settle after that invoice
--     expired (a slow 3-D Secure)" (payment-verify, askOlderInvoices);
--   * 'paid', 'authorized' and 'refunded' hold or held money: NOT dead;
--   * DEAD is exactly: status 'failed' AND either
--       - failure_code 'invoice_canceled' - written only after Moyasar
--         confirmed the cancel with nothing in flight (abandonSession), or
--         after Moyasar reported the invoice cancelled with no paid payment
--         (closedInvoiceOutcome); a cancelled invoice "can no longer be paid";
--       - no invoice and no charge reference at all (provider_checkout_ref and
--         provider_ref both NULL). payment-initiate persists the invoice id
--         BEFORE it hands out any checkout URL, so such an attempt never gave
--         the customer anything to pay.
--   A session with no attempt at all is dead by the same reasoning.
--
-- The old row is LOCKED (FOR UPDATE) before its attempts are read.
-- begin_session_attempt takes the same lock before it inserts an attempt, so
-- no attempt can appear between the check and the retirement; once retired,
-- begin_session_attempt refuses the session as not payable.
--
-- WHY 'expired' AND NOT 'cancelled'. finalize_checkout_session refuses a
-- 'cancelled' session but accepts an 'expired' one, because "a captured
-- payment must never be refused". If the narrow rule above were ever wrong and
-- money did settle on the retired session, it still becomes an order rather
-- than a charge with nothing behind it. 'expired' also drops the session out of
-- begin_session_attempt's loyalty multi-spend sum, so its points are released.
-- expires_at is left as it was: nothing reads it once the status is not
-- pending_payment.
--
-- ROWS WRITTEN BEFORE THIS FILE carry a NULL fingerprint and match nothing. A
-- live pending one is replaced when dead, else refused; a settled one is
-- refused. Online payment is switched off in Production according to
-- docs/PAYMENTS.md §1 (not re-read live for this file), and with it off this
-- function raises before creating any session, so no such row is expected to
-- be live when this applies.
--
-- WHAT DOES NOT CHANGE. The signature, SECURITY DEFINER, search_path and the
-- grants (re-stated below). The expiry sweep, the online-payment gate, the
-- pricing call, the zero-total settlement and its unique_violation recovery are
-- reproduced verbatim from 20260826110000 - the only edits are the fingerprint,
-- the branch check, the matched lookup and the new column in the INSERT. No
-- other function is redefined: begin_session_attempt, place_order,
-- insert_order_from_snapshot, finalize_checkout_session and
-- compute_order_snapshot are asserted unmoved at the end of this file against
-- pre-images read at its start. No Edge Function changes, and no deploy is
-- implied.
-- ===========================================================================

-- Pre-images of the functions this file must NOT move, read before anything
-- else runs, so the closing block compares against the live database rather
-- than a hard-coded hash a sibling migration may have changed.
-- Kept in a session setting, not a temporary table, so it survives whether or
-- not the file runs inside one transaction.
do $$
declare v_pre jsonb;
begin
  select coalesce(jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))), '{}'::jsonb)
    into v_pre
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('begin_session_attempt', 'place_order', 'insert_order_from_snapshot',
                       'finalize_checkout_session', 'compute_order_snapshot');
  perform set_config('sma_20261020120000.preimage', v_pre::text, false);
end $$;

alter table public.checkout_sessions add column if not exists input_fingerprint text;

comment on column public.checkout_sessions.input_fingerprint is
  'sha256 of the inputs this session was priced from (branch, order type, items, address, '
  'coupon, notes, points). begin_checkout_session reuses a session for the same key only '
  'when this matches (20261020120000, audit F-X02-001). NULL on rows written before that '
  'file, which therefore match nothing.';

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

  -- Every input this call prices from. jsonb_build_object keeps a key whose
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
    -- Locked, because a mismatch below may retire it: begin_session_attempt
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

-- Grants re-stated exactly as 20260712170000 left them. `from public, anon`
-- matters: this project's default privileges grant EXECUTE to anon directly
-- (CLAUDE.md §8).
revoke all on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-verification. Every check fails explicitly on NULL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src   text;
  v_n     integer;
  v_def   boolean;
  v_cfg   text[];
  v_state text;
  v_msg   text;
  v_branch uuid;
  v_pre   jsonb;
  r record;
begin
  -- Cardinality first: every read below takes ONE body.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_checkout_session';
  if v_n is distinct from 1 then
    raise exception 'VERIFY: expected one begin_checkout_session, found %', v_n;
  end if;

  select p.prosrc, p.prosecdef, p.proconfig into v_src, v_def, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_checkout_session';
  if v_src is null then raise exception 'VERIFY: begin_checkout_session body is NULL'; end if;
  if v_def is distinct from true then raise exception 'VERIFY: begin_checkout_session is not SECURITY DEFINER'; end if;
  if v_cfg is null or not ('search_path=public' = any (v_cfg)) then
    raise exception 'VERIFY: begin_checkout_session lost search_path=public (%)', v_cfg;
  end if;

  -- The column exists, is text and nullable.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'checkout_sessions'
     and column_name = 'input_fingerprint' and data_type = 'text' and is_nullable = 'YES';
  if v_n is distinct from 1 then raise exception 'VERIFY: checkout_sessions.input_fingerprint missing or wrong type'; end if;

  -- The pieces of the fix are present as statements, not only as comments:
  -- comments are stripped before matching so a comment cannot satisfy a check.
  v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');
  for r in select * from (values
      ('fingerprint computed',  'v_fingerprint := encode(sha256(convert_to(jsonb_build_object('),
      ('fingerprint compared',  'if v_existing.input_fingerprint is not distinct from v_fingerprint then'),
      ('fingerprint stored',    'idempotency_key, input_fingerprint'),
      ('fp branch',             '''branch_id'', p_branch_id,'),
      ('fp order type',         '''order_type'', p_order_type,'),
      ('fp items',              '''items'', p_items,'),
      ('fp address',            '''address_id'', p_address_id,'),
      ('fp coupon',             '''coupon_code'', p_coupon_code,'),
      ('fp notes',              '''notes'', p_notes,'),
      ('fp points',             '''loyalty_points'', greatest(0, coalesce(p_loyalty_points, 0))'),
      ('lookup locked',         'for update;'),
      ('settled checked first', 'if v_existing.order_id is not null then
        raise exception ''checkout_session_mismatch: order_placed'''),
      ('attempt guard',         'if exists (
        select 1 from public.payment_records pr
         where pr.checkout_session_id = v_existing.id'),
      ('settled refusal',       '''checkout_session_mismatch: order_placed'''),
      ('open-payment refusal',  '''checkout_session_mismatch: payment_open'''),
      ('dead predicate',        'pr.failure_code = ''invoice_canceled'''),
      ('dead predicate refs',   'pr.provider_checkout_ref is null and pr.provider_ref is null'),
      ('retire as expired',     'set status = ''expired''
       where id = v_existing.id'),
      ('branch refused',        'not exists (select 1 from public.branches where id = p_branch_id)'),
      ('gate kept',             'Online payment is not available'),
      ('zero-total kept',       '''online'', ''paid'', p_idempotency_key, null)')
    ) as t(label, needle)
  loop
    if position(r.needle in v_src) = 0 then
      raise exception 'VERIFY: begin_checkout_session lost: %', r.label;
    end if;
  end loop;
  -- The unconditional reuse is gone: exactly one `return v_existing` guarded by
  -- the fingerprint, plus the zero-total race recovery's.
  select count(*) into v_n from regexp_matches(v_src, 'return v_existing;', 'g');
  if v_n is distinct from 2 then raise exception 'VERIFY: expected 2 return v_existing, found %', v_n; end if;
  -- Never retired as 'cancelled', which finalize_checkout_session refuses.
  if position('''cancelled''' in v_src) > 0 then
    raise exception 'VERIFY: begin_checkout_session writes status cancelled';
  end if;

  -- Grants: authenticated only among client roles.
  if has_function_privilege('anon', 'public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid)', 'execute') then
    raise exception 'VERIFY: anon can execute begin_checkout_session';
  end if;
  if not has_function_privilege('authenticated', 'public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid)', 'execute') then
    raise exception 'VERIFY: authenticated lost EXECUTE on begin_checkout_session';
  end if;

  -- CALLED, not only stored: a plpgsql body is not name-resolved at creation.
  -- Both probes run as a caller who owns nothing, and raise before any write
  -- (the expiry sweep matches no row for a customer that does not exist).
  --   1. an unknown branch is refused, through the fingerprint and the sweep;
  --   2. an existing branch with a fresh key resolves the locked lookup and
  --      then stops at the payment gate or at pricing - any error is accepted
  --      EXCEPT an unresolved name.
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
  end if;
  perform set_config('request.jwt.claim.sub', '', true);

  -- Nothing else moved.
  v_pre := nullif(current_setting('sma_20261020120000.preimage', true), '')::jsonb;
  if v_pre is null then raise exception 'VERIFY: the pre-images were not recorded'; end if;
  select count(*) into v_n from jsonb_object_keys(v_pre);
  if v_n is distinct from 5 then raise exception 'VERIFY: expected 5 pre-images, recorded %', v_n; end if;
  for r in
    select pre.key as sig, pre.value as h, md5(pg_get_functiondef(p.oid)) as now_h
      from jsonb_each_text(v_pre) pre
      left join pg_proc p on p.oid::regprocedure::text = pre.key
  loop
    if r.now_h is distinct from r.h then
      raise exception 'VERIFY: % moved (% -> %)', r.sig, r.h, coalesce(r.now_h, 'NULL');
    end if;
  end loop;
end $$;
