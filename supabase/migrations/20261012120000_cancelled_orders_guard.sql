-- Spicy Meal — a cancelled order is never resent, sent, refunded automatically
-- or paid (card-payment gaps PG-03 and PG-27, and OWNER_ACTIONS §47.13).
--
-- WHAT WAS WRONG, read on the default branch at 52a3976, where every function
-- below hashes exactly as it does live (docs/readiness/20261113-card-payments-gaps.md):
--
--   * PG-03. Nothing on the way to the kitchen looked at orders.status.
--     request_customer_pos_resend re-queued a cancelled order, both sync claims
--     handed one to the worker, and the automatic-refund trigger enrolled a
--     refund for one. Cancelling does not touch the sync state, so a paid order
--     that never reached the branch, cancelled and refunded by hand on the
--     customer's call, could still be resent from the app, print a ticket, and
--     after three failed resends queue a second, automatic refund.
--   * PG-27. place_customer_order, which every signed-in customer may call,
--     passed p_payment_method = 'online' straight to place_order. That creates
--     an unpaid order the app never makes: the app pays by card through
--     checkout sessions (begin_checkout_session), and sends 'cash' here.
--   * §47.13. begin_payment_attempt refused only a paid order, a non-online
--     order and a total under 1.00. Three cancelled online orders from
--     2026-07-12 are still unpaid (live, read 2026-11-14), so once the payment
--     row is LIVE a direct call to payment-initiate's order-first flow could
--     open a real invoice for one, and paying it would mark it paid.
--
-- WHAT CHANGES. Six function bodies. No signature, no table, no row:
--
--   1. request_customer_pos_resend refuses a cancelled order with
--      {outcome:'unavailable', reason:'order_cancelled', message, state}. The
--      app shows its own translation of the message. While redefining it, its
--      ownership test is made NULL-safe: `customer_id <> auth.uid()` is NULL,
--      not true, for an order with no customer (ON DELETE SET NULL after an
--      account deletion), so any signed-in caller passed it.
--   2. claim_lazywait_sync_batch and claim_lazywait_sync_one never claim a
--      cancelled order. The two keep byte-identical predicates apart from the id
--      filter and the ordering, as lazywait-sync's comment requires.
--   3. set_order_refund_enrollment, the trigger that enrols automatic refunds,
--      does not enrol a cancelled order. order_refund_due is unchanged and is
--      still the rule for every other order; it takes no status, and its only
--      caller is this trigger, so the check sits here rather than in a new
--      signature. Its EXECUTE grant to PUBLIC, anon and authenticated is
--      revoked: no caller can invoke a trigger function directly, and a trigger
--      fires whether or not the writing role holds EXECUTE (measured on PG16).
--   4. place_customer_order refuses an online order, both as asked for
--      ('online' in any case or spacing, normalised as place_order normalises
--      it) and as resolved (a call with no method that place_order would turn
--      into an online order from app_settings). The first refusal comes before
--      any lock or write. The second is a backstop: the order is rolled back,
--      but the SM- number it drew is not, because a sequence is not
--      transactional. place_order itself does not change.
--   5. begin_payment_attempt refuses a cancelled order before it reuses or
--      opens an attempt, so no invoice can be opened for one. payment-initiate
--      already answers a refusal from it with a 400 ("Could not start the
--      payment. Please try again.") and never creates the invoice, so no
--      deploy is needed.
--
-- WHAT THIS DOES NOT DECIDE OR CHANGE, deliberately:
--
--   * It does not decide PG-13 (refund a cancelled paid order automatically,
--     or by hand). A refund already enrolled before an order is cancelled keeps
--     running; a refund enrolled at cancellation by a future change is not
--     stopped by this trigger, which only ever SETS refund_state.
--   * customer_manual_pos_resend_eligibility, customer_order_state and
--     order_refund_due are untouched. Their clause sequences are pinned by
--     apps/mobile/src/features/orders/orderConfirmationSqlParity.test.ts.
--   * confirm_order_payment still records a captured payment for any order:
--     money that was taken is never refused. With this file no attempt can be
--     opened for a cancelled order, and live holds 0 Moyasar attempts.
--   * requeue_lazywait_order (the admin Retry) is not changed. A cancelled
--     order it re-queues is no longer claimed, so it cannot reach the kitchen.
--   * begin_session_attempt, the card path the app uses, is not changed.
--   * MONEY PATH UNTOUCHED, and the file asserts it before and after:
--     place_order 12b6816d256c29b76edf947ae1a7ea77, compute_order_snapshot
--     22e2d42935459e7bf93abb2941b56325 (md5(pg_get_functiondef)).
--
-- PRE-IMAGES. The block below refuses to apply unless each replaced function is
-- either the definition this file was derived from or this file's own (a
-- re-apply). Basis: md5(prosrc), which is what the 2026-11-14 live read gives.
-- It is not md5(pg_get_functiondef); do not compare the two.
--
--   request_customer_pos_resend  5ffad2102d6f05f79c088bd67edf376f
--   claim_lazywait_sync_batch    6109cbe2f43dcbdcb09f0e562710f239
--   claim_lazywait_sync_one      f150563fe92cd9b477638b82bb06fb8f
--   set_order_refund_enrollment  3494b28d166b5bde64923f6d6fc0be14
--   place_customer_order         bf7af92d35cc2c79e7ffb0e0718e2a4b
--   begin_payment_attempt        9add3686b376e30ec4795a4695230df5
--
-- SELF-VERIFICATION, at the foot. Outcomes, not only text: inside a
-- sub-transaction that is then aborted, it writes a probe branch and probe
-- orders (explicit order numbers, so no SM- number is drawn) and drives the two
-- claims, the refund trigger and begin_payment_attempt, each for a cancelled
-- order and for an otherwise identical one that is not, and
-- place_customer_order for 'online' (three spellings) and for cash, then
-- proves the rollback. Two things cannot be driven that far here, because they
-- need a signed-in customer who owns the order, and building one would mean
-- writing to auth.users in Production, which no migration in this repository
-- does: request_customer_pos_resend, and place_customer_order's backstop for a
-- call with no method. The first is called as far as its sign-in gate and its
-- new statements are checked in the comment-stripped body. Both outcomes are
-- proven by supabase/tests/cancelled_orders_guard_test.sql. That is said
-- rather than glossed.
--
-- No deploy implied. The app half (the Cancelled state, no Resend) ships in the
-- next EAS build (docs/OWNER_ACTIONS.md §47.17); this file protects every
-- build already installed. Apply it by version, never as "the outstanding
-- migrations" (docs/OWNER_ACTIONS.md §54, docs/MIGRATIONS.md §64).

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n    integer;
  v_hash text;
  v_src  text;
  r      record;
begin
  -- The money-path pair, cardinality first: with two overloads the hash below
  -- would read an arbitrary one.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 place_order overload, found %', v_n; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 compute_order_snapshot overload, found %', v_n; end if;

  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'PRECONDITION: place_order hashes %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_hash, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'PRECONDITION: compute_order_snapshot hashes %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_hash, 'NULL');
  end if;

  -- Each replaced function: exactly one overload, and either the pre-image this
  -- file was derived from or this file's own version (marked by a statement
  -- only this file writes).
  for r in
    select * from (values
      ('request_customer_pos_resend', '5ffad2102d6f05f79c088bd67edf376f', 'resend_rejected_order_cancelled'),
      ('claim_lazywait_sync_batch',   '6109cbe2f43dcbdcb09f0e562710f239', 'and status <> ''cancelled'''),
      ('claim_lazywait_sync_one',     'f150563fe92cd9b477638b82bb06fb8f', 'and status <> ''cancelled'''),
      ('set_order_refund_enrollment', '3494b28d166b5bde64923f6d6fc0be14', 'new.status <> ''cancelled'''),
      ('place_customer_order',        'bf7af92d35cc2c79e7ffb0e0718e2a4b', 'online_orders_use_checkout'),
      ('begin_payment_attempt',       '9add3686b376e30ec4795a4695230df5', 'Order is cancelled')
    ) as t(fn, pre, marker)
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_n <> 1 then raise exception 'PRECONDITION: expected 1 % overload, found %', r.fn, v_n; end if;
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if md5(v_src) is distinct from r.pre and position(r.marker in coalesce(v_src, '')) = 0 then
      raise exception 'PRECONDITION: % hashes % (md5(prosrc)); this file was derived from %. Re-derive it from the live body.',
        r.fn, md5(v_src), r.pre;
    end if;
  end loop;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. request_customer_pos_resend: a cancelled order is refused (PG-03)
-- ---------------------------------------------------------------------------
-- Body of 20260813143000 with two changes: the ownership test is NULL-safe,
-- and a cancelled order is refused after the lock and the ownership test, and
-- before the eligibility predicate. The refusal follows the function's own
-- contract for every other refusal (a skipped sync-log row, outcome
-- 'unavailable', nothing else written), and adds `reason` and `message`.
--
-- `state` stays advisory, as before. For a cancelled order it is
-- 'order_cancelled', the state the app shows, unless a refund already exists
-- for the order: then the refund is the customer's story, and the state says
-- so, exactly as customer_order_state would.
create or replace function public.request_customer_pos_resend(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_elig text;
  v_state text;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='28000'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.customer_id is distinct from auth.uid() then raise exception 'Order not found' using errcode='P0002'; end if;

  -- A cancelled order is never sent to the branch again (20261012120000).
  if v_order.status = 'cancelled' then
    insert into public.integration_sync_logs(provider,order_id,direction,status,request,error)
      values('lazywait',p_order_id,'push','skipped',jsonb_build_object('action','customer_resend'),'resend_rejected_order_cancelled');
    v_state := case
      when v_order.refund_state in ('pending','processing','refunded','failed')
        then public.customer_order_state(v_order.order_type::text,v_order.payment_method,v_order.payment_status::text,v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,v_order.sync_next_attempt_at,v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,v_order.refund_state)
      else 'order_cancelled' end;
    return jsonb_build_object('outcome','unavailable','state',v_state,'reason','order_cancelled',
      'message','This order was cancelled, so it was not sent to the branch.');
  end if;

  v_elig := public.customer_manual_pos_resend_eligibility(
    v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,
    v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,
    v_order.payment_method,v_order.payment_status::text,v_order.refund_state);

  if v_elig <> 'eligible' then
    insert into public.integration_sync_logs(provider,order_id,direction,status,request,error)
      values('lazywait',p_order_id,'push','skipped',jsonb_build_object('action','customer_resend'),'resend_rejected_'||v_elig);
    v_state := public.customer_order_state(v_order.order_type::text,v_order.payment_method,v_order.payment_status::text,v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,v_order.sync_next_attempt_at,v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,v_order.refund_state);
    return jsonb_build_object('outcome','unavailable','state',v_state);
  end if;

  -- This explicit action is the ONLY customer path from failure back into the
  -- scheduled queue. The worker then owns exactly this newly queued attempt.
  update public.orders set
    pos_customer_retry_count=pos_customer_retry_count+1,
    pos_customer_retry_last_at=now(),
    lazywait_sync_state='pending',
    sync_next_attempt_at=now(),
    pos_sync_deadline_at=greatest(coalesce(pos_sync_deadline_at,now()),now())+public.customer_pos_resend_window(),
    sync_last_error=null,
    sync_blocked_reason=null,
    pos_create_attempted_at=null,
    pos_create_attempt_token=null,
    sync_status='not_synced'::public.sync_status,
    updated_at=now()
  where id=p_order_id returning * into v_order;

  insert into public.integration_sync_logs(provider,order_id,direction,status,request,error)
    values('lazywait',p_order_id,'push','success',jsonb_build_object('action','customer_resend','attempt',v_order.pos_customer_retry_count),null);
  v_state := public.customer_order_state(v_order.order_type::text,v_order.payment_method,v_order.payment_status::text,v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,v_order.sync_next_attempt_at,v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,v_order.refund_state);
  return jsonb_build_object('outcome','accepted','state',v_state);
end $$;
-- create or replace keeps the ACL; restated so it does not depend on history.
revoke all on function public.request_customer_pos_resend(uuid) from public, anon;
grant execute on function public.request_customer_pos_resend(uuid) to authenticated;
comment on function public.request_customer_pos_resend(uuid) is
  'Customer Resend order. Owner-only (NULL-safe since 20261012120000). Refuses a cancelled order with outcome unavailable, reason order_cancelled and a message (since 20261012120000); otherwise re-queues a proven-not-sent order within the three-attempt budget (20260813143000).';

-- ---------------------------------------------------------------------------
-- 2. The sync claims never take a cancelled order (PG-03)
-- ---------------------------------------------------------------------------
-- Bodies of 20260813143000 with one added line each. lazywait-sync relies on
-- the two predicates staying byte-identical apart from the id filter and the
-- ordering; they still are.
create or replace function public.claim_lazywait_sync_batch(p_limit integer default 10)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing',
         pos_create_attempted_at = null,
         pos_create_attempt_token = null,
         updated_at = now()
   where o.id in (
     select id from public.orders
      where lazywait_sync_state = 'pending'
        and status <> 'cancelled'
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
        and (pos_sync_deadline_at is null or now() < pos_sync_deadline_at)
      order by sync_next_attempt_at nulls first, created_at
      limit greatest(1, least(coalesce(p_limit, 10), 100))
      for update skip locked
   )
   returning o.*;
end $$;
revoke all on function public.claim_lazywait_sync_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_batch(integer) to service_role;
comment on function public.claim_lazywait_sync_batch(integer) is
  'Scheduled POS claim: due pending orders only, never a cancelled one (since 20261012120000), FOR UPDATE SKIP LOCKED. Service role only.';

create or replace function public.claim_lazywait_sync_one(p_order_id uuid)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing',
         pos_create_attempted_at = null,
         pos_create_attempt_token = null,
         updated_at = now()
   where o.id in (
     select id from public.orders
      where id = p_order_id
        and lazywait_sync_state = 'pending'
        and status <> 'cancelled'
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
        and (pos_sync_deadline_at is null or now() < pos_sync_deadline_at)
      for update skip locked
   )
   returning o.*;
end $$;
revoke all on function public.claim_lazywait_sync_one(uuid) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_one(uuid) to service_role;
comment on function public.claim_lazywait_sync_one(uuid) is
  'Targeted POS claim for one order, the same predicate as claim_lazywait_sync_batch: due, pending, never cancelled (since 20261012120000). Service role only.';

-- ---------------------------------------------------------------------------
-- 3. The automatic-refund trigger never enrols a cancelled order (PG-03)
-- ---------------------------------------------------------------------------
-- Body of 20260724120000 with the status test in front of order_refund_due.
-- Still path-independent: it fires on every insert and update of an order,
-- whatever drove the order terminal.
create or replace function public.set_order_refund_enrollment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A cancelled order is refunded by hand while that is the procedure
  -- (OWNER_ACTIONS §47.20, gap PG-13), so an automatic refund on top of it
  -- would be a second refund (20261012120000).
  if new.status <> 'cancelled'
     and public.order_refund_due(
       new.payment_status::text, new.lazywait_sync_state, new.lazywait_ref,
       new.sync_blocked_reason, new.pos_create_attempted_at,
       new.pos_customer_retry_count, new.refund_state, new.total) then
    new.refund_state       := 'pending';
    new.refund_required_at := coalesce(new.refund_required_at, now());
  end if;
  return new;
end $$;
-- A trigger function cannot be called directly, and a trigger fires whether or
-- not the writing role holds EXECUTE, so no client role needs this grant.
revoke all on function public.set_order_refund_enrollment() from public, anon, authenticated;
comment on function public.set_order_refund_enrollment() is
  'BEFORE trigger on orders: enrols the automatic refund when order_refund_due() holds, never for a cancelled order (since 20261012120000). Fires whatever role writes the row.';

-- ---------------------------------------------------------------------------
-- 4. place_customer_order places no online order (PG-27)
-- ---------------------------------------------------------------------------
-- Body of 20261005120000 with a refusal at the top and a backstop after the
-- place_order call. The projection is unchanged.
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
  'Customer-facing wrapper over the UNCHANGED place_order. Refuses an online order, asked for or resolved from the default (hint online_orders_use_checkout; card payment goes through begin_checkout_session, since 20261012120000). Refuses a caller who is not phone_verified or is over app_settings.order_limit_open / order_limit_per_hour, serialised per caller (20261005120000); otherwise identical pricing, coupons, VAT, loyalty, transactionality and idempotency, returning an explicit customer-safe projection (20260724200000).';

-- ---------------------------------------------------------------------------
-- 5. begin_payment_attempt opens nothing for a cancelled order (§47.13)
-- ---------------------------------------------------------------------------
-- Body of 20261003120000 with one statement after the lock, ahead of every
-- other refusal and of the reuse lookup, so a live attempt is not handed back
-- for a cancelled order either.
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
  if v_order.status = 'cancelled' then raise exception 'Order is cancelled' using errcode = 'P0001'; end if;
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
  'Opens (or reuses) THE single active payment attempt for an order, for any provider. reference_order is an OPAQUE ORD-… value, never the internal SM-… order number. Refuses with P0001 a cancelled order (since 20261012120000) and a total under Moyasar''s 1.00 SAR invoice minimum (since 20261003120000).';

-- ---------------------------------------------------------------------------
-- 6. Self-verification: outcomes first, then the stored text, grants and the
--    money path. Every outcome is read back as a value, never a notice.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_tag     constant text := 'VERIFY-20261012120000-';
  v_branch  uuid := gen_random_uuid();
  v_c1      uuid := gen_random_uuid();   -- claims: cancelled, sorts first
  v_r1      uuid := gen_random_uuid();   -- claims: received, sorts second
  v_r2      uuid := gen_random_uuid();   -- claim_one: received
  v_e1      uuid := gen_random_uuid();   -- refund: cancelled, paid
  v_e2      uuid := gen_random_uuid();   -- refund: received, paid
  v_p1      uuid := gen_random_uuid();   -- attempt: cancelled, online unpaid
  v_p2      uuid := gen_random_uuid();   -- attempt: received, online unpaid
  v_p3      uuid := gen_random_uuid();   -- attempt: cancelled, with a live attempt to reuse
  v_n       integer;
  v_state   text;
  v_code    text;
  v_msg     text;
  v_hint    text;
  v_hash    text;
  v_src     text;
  v_method  text;
  v_id      uuid;
  r         record;
begin
  -- ---- Behaviour, in a sub-transaction that the final raise aborts --------
  begin
    insert into public.branches (id, name_en, name_ar) values (v_branch, v_tag || 'branch', v_tag || 'branch');

    -- Explicit order numbers, so set_order_number draws nothing from the
    -- SM- sequence. The insert triggers put every one of these in the queue
    -- ('pending', or 'awaiting_payment' for the unpaid online ones).
    insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                               payment_method, payment_status, created_at)
    values
      (v_c1, v_tag || 'c1', v_branch, 'pickup', 'cancelled', 10, 10, 'cash',   'pending', '2000-01-01 00:00:00+00'),
      (v_r1, v_tag || 'r1', v_branch, 'pickup', 'received',  10, 10, 'cash',   'pending', '2000-01-01 00:00:01+00'),
      (v_r2, v_tag || 'r2', v_branch, 'pickup', 'received',  10, 10, 'cash',   'pending', now()),
      (v_e1, v_tag || 'e1', v_branch, 'pickup', 'cancelled', 10, 10, 'online', 'paid',    now()),
      (v_e2, v_tag || 'e2', v_branch, 'pickup', 'received',  10, 10, 'online', 'paid',    now()),
      (v_p1, v_tag || 'p1', v_branch, 'pickup', 'cancelled', 10, 10, 'online', 'pending', now()),
      (v_p2, v_tag || 'p2', v_branch, 'pickup', 'received',  10, 10, 'online', 'pending', now()),
      (v_p3, v_tag || 'p3', v_branch, 'pickup', 'cancelled', 10, 10, 'online', 'pending', now());

    -- (a) The claims. c1 and r1 are due now and sort ahead of any real order
    -- (no next-attempt time, created in 2000), c1 first. So claim_batch(1)
    -- takes c1 if the status filter is missing, and r1 if it is there.
    update public.orders set sync_next_attempt_at = null where id in (v_c1, v_r1);
    if (select count(*) from public.orders where id in (v_c1, v_r1) and lazywait_sync_state = 'pending') <> 2 then
      raise exception 'VERIFY: the claim probes did not start in the queue';
    end if;

    select count(*) into v_n from public.claim_lazywait_sync_one(v_c1);
    if v_n <> 0 then raise exception 'VERIFY: claim_lazywait_sync_one claimed a cancelled order'; end if;

    select array_agg(id)::text into v_msg from public.claim_lazywait_sync_batch(1);
    if v_msg is distinct from format('{%s}', v_r1) then
      raise exception 'VERIFY: claim_lazywait_sync_batch(1) claimed %, expected only the received probe', coalesce(v_msg, '<nothing>');
    end if;
    select lazywait_sync_state into v_state from public.orders where id = v_c1;
    if v_state is distinct from 'pending' then
      raise exception 'VERIFY: the cancelled probe left the queue as %', coalesce(v_state, '<null>');
    end if;

    select count(*) into v_n from public.claim_lazywait_sync_one(v_r2);
    if v_n <> 1 then raise exception 'VERIFY: claim_lazywait_sync_one no longer claims a received order'; end if;

    -- (b) The refund trigger. Both orders are driven into the shape
    -- order_refund_due accepts: paid, proven not sent, three resends spent.
    update public.orders
       set lazywait_sync_state = 'dead_letter', pos_customer_retry_count = 3
     where id in (v_e1, v_e2);
    select refund_state into v_state from public.orders where id = v_e1;
    if v_state is distinct from 'none' then
      raise exception 'VERIFY: a cancelled paid order was enrolled for an automatic refund (%)', coalesce(v_state, '<null>');
    end if;
    if exists (select 1 from public.order_refunds where order_id = v_e1) then
      raise exception 'VERIFY: a refund record was opened for a cancelled order';
    end if;
    select refund_state into v_state from public.orders where id = v_e2;
    if v_state is distinct from 'pending' then
      raise exception 'VERIFY: an eligible paid order was not enrolled (%)', coalesce(v_state, '<null>');
    end if;
    if (select count(*) from public.order_refunds where order_id = v_e2) <> 1 then
      raise exception 'VERIFY: an eligible paid order did not get exactly one refund record';
    end if;

    -- (c) begin_payment_attempt: no new attempt (p1), and no reuse of one
    -- that was already live (p3), for a cancelled order.
    insert into public.payment_records (order_id, provider, status, amount, currency, mode,
                                        reference_transaction, reference_order, initiated_at, expires_at)
    values (v_p3, 'moyasar', 'initiated', 10, 'SAR', 'test', 'sm_' || replace(v_p3::text, '-', ''),
            v_tag || 'p3', now(), now() + interval '20 minutes');
    foreach v_id in array array[v_p1, v_p3] loop
      v_code := 'none'; v_msg := null;
      begin
        perform public.begin_payment_attempt(v_id, 'moyasar', 'test', 30);
      exception when others then
        v_code := sqlstate; v_msg := sqlerrm;
      end;
      if v_code is distinct from 'P0001' or v_msg is distinct from 'Order is cancelled' then
        raise exception 'VERIFY: begin_payment_attempt answered a cancelled order with % %', v_code, coalesce(v_msg, '');
      end if;
    end loop;
    if exists (select 1 from public.payment_records where order_id = v_p1) then
      raise exception 'VERIFY: an attempt was opened for a cancelled order';
    end if;
    if (select count(*) from public.payment_records where order_id = v_p3) <> 1 then
      raise exception 'VERIFY: a cancelled order''s live attempt was multiplied';
    end if;
    select * into r from public.begin_payment_attempt(v_p2, 'moyasar', 'test', 30);
    if r.attempt_id is null or r.reused then
      raise exception 'VERIFY: begin_payment_attempt no longer opens an attempt for an unpaid online order';
    end if;

    -- (d) place_customer_order. No caller is signed in here, so a call that
    -- gets past the new refusal reaches place_order's own 28000.
    foreach v_method in array array['online', ' Online ', 'ONLINE'] loop
      v_code := 'none'; v_msg := null; v_hint := null;
      begin
        perform public.place_customer_order(v_branch, 'pickup', '[]'::jsonb, null, null, null, 0, null, v_method);
      exception when others then
        get stacked diagnostics v_code = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
      end;
      if v_code is distinct from 'P0001' or v_hint is distinct from 'online_orders_use_checkout' then
        raise exception 'VERIFY: place_customer_order answered method "%" with % % (hint %)', v_method, v_code, coalesce(v_msg, ''), coalesce(v_hint, '<none>');
      end if;
    end loop;
    foreach v_method in array array['cash', ''] loop
      v_code := 'none';
      begin
        perform public.place_customer_order(v_branch, 'pickup', '[]'::jsonb, null, null, null, 0, null, nullif(v_method, ''));
      exception when others then
        v_code := sqlstate;
      end;
      if v_code is distinct from '28000' then
        raise exception 'VERIFY: place_customer_order did not hand method "%" on to place_order (got %)', coalesce(nullif(v_method, ''), 'null'), v_code;
      end if;
    end loop;

    -- (e) request_customer_pos_resend, as far as its sign-in gate. Its
    -- outcomes are proven by the paired suite; see the header.
    v_code := 'none';
    begin
      perform public.request_customer_pos_resend(v_c1);
    exception when others then
      v_code := sqlstate;
    end;
    if v_code is distinct from '28000' then
      raise exception 'VERIFY: request_customer_pos_resend without a caller answered % instead of 28000', v_code;
    end if;

    raise exception 'ROLLBACK_PROBE_20261012120000';
  exception when others then
    if sqlerrm is distinct from 'ROLLBACK_PROBE_20261012120000' then raise; end if;
  end;

  -- The probe is evidence only if the rollback is proven, not assumed.
  if exists (select 1 from public.orders where order_number like v_tag || '%')
     or exists (select 1 from public.branches where id = v_branch)
     or exists (select 1 from public.payment_records where order_id in (v_p1, v_p2, v_p3))
     or exists (select 1 from public.order_refunds where order_id in (v_e1, v_e2)) then
    raise exception 'VERIFY: a probe row survived the sub-transaction';
  end if;

  -- ---- The stored text, comment-stripped so a comment cannot satisfy it ----
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_customer_pos_resend';
  if position('v_order.customer_id is distinct from auth.uid()' in v_src) = 0 then
    raise exception 'VERIFY: request_customer_pos_resend lost its NULL-safe ownership test';
  end if;
  if position('if v_order.status = ''cancelled'' then' in v_src) = 0 then
    raise exception 'VERIFY: request_customer_pos_resend does not refuse a cancelled order';
  end if;
  if position('if v_order.status = ''cancelled'' then' in v_src) > position('customer_manual_pos_resend_eligibility(' in v_src)
     or position('if v_order.status = ''cancelled'' then' in v_src) > position('update public.orders set' in v_src)
     or position('if v_order.status = ''cancelled'' then' in v_src) < position('for update;' in v_src) then
    raise exception 'VERIFY: the cancelled refusal is not between the order lock and the eligibility check';
  end if;
  if position('''reason'',''order_cancelled''' in v_src) = 0 or position('''message'',' in v_src) = 0 then
    raise exception 'VERIFY: the cancelled refusal carries no reason or message';
  end if;

  -- ---- Grants: anon executes none of these, and the clients keep theirs ----
  for r in
    select * from (values
      ('public.request_customer_pos_resend(uuid)', true,  false),
      ('public.claim_lazywait_sync_one(uuid)', false, true),
      ('public.claim_lazywait_sync_batch(integer)', false, true),
      ('public.set_order_refund_enrollment()', false, false),
      ('public.order_refund_due(text, text, text, text, timestamptz, integer, text, numeric)', true, true),
      ('public.place_customer_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)', true, false),
      ('public.begin_payment_attempt(uuid, text, text, integer)', false, true)
    ) as t(sig, authed, service)
  loop
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception 'VERIFY: anon can execute %', r.sig;
    end if;
    if has_function_privilege('authenticated', r.sig, 'execute') is distinct from r.authed then
      raise exception 'VERIFY: authenticated EXECUTE on % is %, expected %', r.sig, not r.authed, r.authed;
    end if;
    if r.service and not has_function_privilege('service_role', r.sig, 'execute') then
      raise exception 'VERIFY: service_role lost EXECUTE on %', r.sig;
    end if;
  end loop;

  -- ---- The money path, one overload each first ----------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('place_order', 'compute_order_snapshot');
  if v_n <> 2 then raise exception 'VERIFY: expected one place_order and one compute_order_snapshot, found % functions', v_n; end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'VERIFY: place_order moved to %', coalesce(v_hash, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'VERIFY: compute_order_snapshot moved to %', coalesce(v_hash, 'NULL');
  end if;
end
$verify$;
