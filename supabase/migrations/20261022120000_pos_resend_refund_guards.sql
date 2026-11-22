-- Spicy Meal — the POS and refunds stop contradicting each other.
-- Audit 2026-11-19: F-X04-001, F-X03-002 and F-X04-002 (all high, all
-- confirmed by an independent re-check). docs/MIGRATIONS.md §71.
--
-- WHAT WAS WRONG, read on the default branch at fe53628:
--
--   * F-X04-001. Every POS decision read the sync columns and treated
--     `orders.status` only as "cancelled or not". A Create Order refused with a
--     non-429 4xx is recorded 'blocked' with sync_last_error, and the BEFORE
--     trigger normalize_known_pos_failure_for_manual_resend then clears the
--     may-have-sent marker, so the order becomes resendable. If the branch took
--     the order by hand meanwhile and staff moved it on (preparing, ready,
--     delivered), the customer's Resend was still accepted and the worker sent
--     a second Create Order: a second kitchen ticket for food already made or
--     handed over. The admin Retry (requeue_lazywait_order) had the same gap.
--   * F-X03-002. The admin Retry re-queued an order whose refund was enrolled
--     or completed. Nothing on the requeue, claim or pre-send path read
--     refund_state, so the order reached the kitchen on a ticket marked paid
--     while its money was going, or had gone, back to the card.
--   * F-X04-002. The POS-failure refund (set_order_refund_enrollment through
--     order_refund_due) was enrolled whatever the order's progress, and staff
--     could deliver an order whose refund was pending; claim_order_refund then
--     handed the worker a delivered order with its full amount.
--
-- WHAT CHANGES. Four function bodies and one new trigger. No signature, no
-- table, no row:
--
--   1. begin_lazywait_create_attempt, the last check before the POST, refuses
--      two more shapes, in the same place and the same way as the cancelled
--      refusal of 20261015120000 (parked in the same locked statement, one
--      'skipped' sync-log row, no notification):
--        - any refund lifecycle ('pending', 'processing', 'refunded',
--          'failed'): answer 'refund_started', parked blocked/refund_started;
--        - status 'ready', 'out_for_delivery' or 'delivered': answer
--          'order_progressed', parked blocked/order_progressed.
--      'preparing' is still sent here, on purpose: an unpaid card order an
--      administrator advanced (LiveOrdersPanel asks before doing so) reaches
--      its FIRST send only when the payment lands, and that first ticket is
--      the one the kitchen and the POS books need. The human-facing paths
--      below refuse 'preparing', because they only ever act after a failure.
--      THE WORKER IS UNCHANGED: it treats any answer other than its five as
--      "not ready", sends nothing and writes nothing
--      (supabase/functions/_shared/lazywaitCancelledGate.test.ts, extended).
--   2. request_customer_pos_resend: an order whose status has left 'received'
--      is refused with outcome 'unavailable', reason 'order_in_progress' and a
--      message, after the eligibility predicate (so every existing refusal
--      keeps its answer) and before the update. A refund was already refused
--      there (customer_manual_pos_resend_eligibility, 'refund_in_progress').
--   3. requeue_lazywait_order: after the eligibility predicate and before the
--      update, P0001 'refund_in_progress: …' for any refund lifecycle, then
--      P0001 'order_in_progress: …' for any status other than 'received'. The
--      console (LazywaitPanel) shows a refused Retry's message as it is.
--   4. claim_order_refund hands the worker a refund only while its order is
--      'received' or 'cancelled', in the candidate scan and again under the
--      lock. Those are the only two statuses a refund is opened in (the
--      POS-failure refund on a received order, the cancellation refund of
--      20261018120000), and with (5) the only two an order with a refund can
--      reach. So the filter changes nothing for any refund this file lets
--      exist; it stops a refund that ALREADY exists on a progressed order
--      (opened before this file) from being paid out. Such a refund is left
--      'pending' for a human, untouched.
--   5. A new BEFORE INSERT OR UPDATE trigger on orders,
--      set_orders_refund_progress_guard → guard_order_progress_refund(). Its
--      name sorts after set_orders_refund_enrollment, so it sees that
--      trigger's decision. On UPDATE it:
--        a. undoes the POS-failure enrolment for an order whose status is
--           neither 'received' nor 'cancelled': when the row arrives with
--           refund_state 'pending' from 'none' and order_refund_due(...) holds
--           for it (the enrolment rule's own test), refund_state and
--           refund_required_at are put back. open_order_refund_record is an
--           AFTER trigger, so no refund row is written;
--        b. refuses, with P0001 'refund_in_progress: …', any status change
--           other than to 'cancelled' while refund_state is 'pending',
--           'processing' or 'refunded'. admin_set_order_status updates the row,
--           so the refusal reaches the console's "Save failed" banner as the
--           error message, and the console rolls the row back.
--
-- WHY THESE STATUS SETS, from the state machine (results/cross/X04 §1):
-- received → preparing | cancelled; preparing → ready | cancelled; ready →
-- out_for_delivery | delivered | cancelled; out_for_delivery → delivered |
-- cancelled; delivered and cancelled are terminal. admin_set_order_status is
-- the only writer of `status`, so every move off 'received' other than
-- cancelling is a person saying the branch is fulfilling the order. Hence:
--   * the POS-failure refund is enrolled only while 'received'. Nothing paid is
--     stranded by that: every progressed status except 'delivered' can still be
--     cancelled, and cancelling a paid card order opens the cancellation refund
--     (20261018120000). A delivered order is never refunded automatically,
--     because the customer has the food;
--   * a live or completed refund ('pending', 'processing', 'refunded') blocks
--     every forward move, not only 'delivered': with (5a) such a refund exists
--     only on a received order, so a forward move would start the kitchen on
--     food whose money is going back. Cancelling stays open, and is the exit.
--     'failed' does not block: finalize_order_refund writes it only for a
--     refund the worker has stopped (order_refunds 'failed' is terminal and no
--     function re-arms it), so no money moves after a delivery, and the claim
--     filter in (4) would stop one that was re-armed by hand.
--
-- WHAT THIS DOES NOT CHANGE, deliberately:
--
--   * admin_set_order_status (owned by another change), set_order_refund_
--     enrollment, order_refund_due, the eligibility helpers and
--     lazywait_requeue_eligibility, the claims, lazywait-sync, payment-refund,
--     place_order, insert_order_from_snapshot, open_order_refund_record.
--     set_order_refund_enrollment would be the more direct place for (5a) — the
--     word `<> 'cancelled'` becoming `= 'received'` — and is outside this
--     change's remit, so (5a) sits in a trigger that runs after it instead.
--   * Cash orders. None of the refund rules apply to them (order_refund_due
--     needs payment_status 'paid'; the cancellation refund needs 'online'), and
--     the gate, Resend and Retry act on them exactly as before while 'received'.
--   * Any row. A refund already pending on a progressed order stays pending.
--   * The customer receipt. It derives its state from the POS columns, so an
--     order refused here can still show Resend; the server now answers that tap
--     'unavailable' with reason 'order_in_progress'. Copy for it is an app
--     change (EAS build) and an owner decision, recorded in docs/MIGRATIONS.md.
--   * MONEY PATH UNTOUCHED: neither place_order nor compute_order_snapshot is
--     redefined; the foot of the file asserts each still has one overload and
--     that neither body changed during this file's run.
--
-- DEPENDS ON, and the precondition block refuses to apply without:
--   20261012120000_cancelled_orders_guard (request_customer_pos_resend),
--   20261015120000_cancelled_order_followups (begin_lazywait_create_attempt,
--   requeue_lazywait_order), 20261016120000_refund_retry_backoff
--   (claim_order_refund) and 20261018120000_refund_cancelled_paid_orders (the
--   enrolment rule (5) runs after). Apply those first, each by version.
--
-- PRE-IMAGES, md5(prosrc). Each replaced function must be a body this file was
-- derived from, or this file's own (a re-apply, recognised by a statement only
-- this file writes). Two values where the body carries whole-line comments: the
-- chain as it replays, and the same text with those lines removed, which is how
-- an inline apply has stored bodies before (ledger rows 92 and 108):
--
--   request_customer_pos_resend    c4a21ddb872b79098d369f8d5cb39934 / 2051aafdde9384c05b07d0f6d44675ca
--   begin_lazywait_create_attempt  365fcc1b8d82a95eac196076740bd957 (no comment lines)
--   requeue_lazywait_order         5b83a99cb110ec14bb99deb2c839e0fc (no comment lines)
--   claim_order_refund             a97954d897596a3c052888e8ef9689d5 / df42bb949390fec8aa1a0631dca5071d
--
-- The new bodies carry NO whole-line comment between their dollar quotes, so a
-- transport that trims comments stores exactly the same text.
--
-- SELF-VERIFICATION, at the foot. Outcomes first, inside a sub-transaction that
-- is then aborted: probe orders (explicit order numbers, so no SM- number is
-- drawn) drive the gate in every status and refund shape, the enrolment rule
-- with and without progress, the status guard, and claim_order_refund (with
-- every pre-existing refund excluded, so no real refund is touched); then the
-- rollback is proven. request_customer_pos_resend and requeue_lazywait_order
-- need a signed-in customer and an AAL2 administrator, which would mean writing
-- to auth.users in Production; they are called as far as their gates, and
-- their new statements are checked in the comment-stripped body. Their outcomes
-- are proven by supabase/tests/pos_resend_refund_guards_test.sql.
--
-- No deploy implied: lazywait-sync, payment-refund and the console are
-- unchanged. Apply by version, never as "the outstanding migrations"
-- (CLAUDE.md §8).

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n   integer;
  v_src text;
  r     record;
begin
  for r in
    select * from (values
      ('request_customer_pos_resend',
       array['c4a21ddb872b79098d369f8d5cb39934', '2051aafdde9384c05b07d0f6d44675ca'],
       'resend_rejected_order_in_progress'),
      ('begin_lazywait_create_attempt',
       array['365fcc1b8d82a95eac196076740bd957'],
       'order_progressed_before_send'),
      ('requeue_lazywait_order',
       array['5b83a99cb110ec14bb99deb2c839e0fc'],
       'order_in_progress: '),
      ('claim_order_refund',
       array['a97954d897596a3c052888e8ef9689d5', 'df42bb949390fec8aa1a0631dca5071d'],
       'o.status in (''received'', ''cancelled'')')
    ) as t(fn, pre, marker)
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_n <> 1 then raise exception 'PRECONDITION: expected 1 % overload, found %', r.fn, v_n; end if;
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if not (md5(coalesce(v_src, '')) = any (r.pre)) and position(r.marker in coalesce(v_src, '')) = 0 then
      raise exception 'PRECONDITION: % hashes % (md5(prosrc)); this file was derived from %. Apply its dependencies first, or re-derive it from the live body.',
        r.fn, md5(coalesce(v_src, '')), array_to_string(r.pre, ' or ');
    end if;
  end loop;

  -- The enrolment rule this file's trigger runs after: the 20261018120000 body,
  -- which enrols a POS failure for any status but cancelled.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_order_refund_enrollment';
  if position('new.status <> ''cancelled''' in coalesce(v_src, '')) = 0
     or position('pr.status = ''paid''' in coalesce(v_src, '')) = 0 then
    raise exception 'PRECONDITION: set_order_refund_enrollment is not the 20261018120000 body; apply 20261018120000 first';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.orders'::regclass and tgname = 'set_orders_refund_enrollment'
                    and not tgisinternal) then
    raise exception 'PRECONDITION: trigger set_orders_refund_enrollment is missing on public.orders';
  end if;
end
$pre$;

-- The money-path bodies at the start of this file, to prove at the foot that
-- this file moved neither. Not a fixed hash: a sibling change may move them.
create temp table pos_resend_refund_guards_money_path as
  select p.proname::text as fn, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('place_order', 'compute_order_snapshot');

-- ---------------------------------------------------------------------------
-- 1. begin_lazywait_create_attempt: no ticket for a refunded or finished order
-- ---------------------------------------------------------------------------
-- The 20261015120000 body with two statements added directly after the
-- cancelled refusal, before the deadline checks. Answers, for the record:
--   ready_to_send | already_synced | ref_present_unverified | deadline_expired
--   | invalid_state | not_found | order_cancelled
-- and now refund_started and order_progressed, both "not ready" to the worker.
create or replace function public.begin_lazywait_create_attempt(
  p_order_id      uuid,
  p_attempt_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.orders;
begin
  if p_attempt_token is null or p_attempt_token = '' then
    raise exception 'attempt token required' using errcode = '22004';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;

  if v_row.lazywait_ref is not null or v_row.lazywait_sync_state = 'synced' then
    if public.lazywait_pos_ref_is_usable(v_row.lazywait_ref) then
      return 'already_synced';
    end if;
    return 'ref_present_unverified';
  end if;

  if v_row.lazywait_sync_state <> 'syncing' then
    return 'invalid_state';
  end if;

  if v_row.pos_create_attempted_at is not null then
    if v_row.pos_create_attempt_token is not distinct from p_attempt_token then
      return 'ready_to_send';
    end if;
    return 'invalid_state';
  end if;

  if v_row.status = 'cancelled' then
    update public.orders
       set lazywait_sync_state  = 'blocked',
           sync_blocked_reason  = 'order_cancelled',
           sync_last_error      = 'order_cancelled_before_send',
           sync_next_attempt_at = null,
           sync_status          = 'failed'::public.sync_status,
           updated_at           = now()
     where id = p_order_id;
    insert into public.integration_sync_logs (provider, order_id, direction, status, error)
      values ('lazywait', p_order_id, 'push', 'skipped', 'order_cancelled_before_send');
    return 'order_cancelled';
  end if;

  if coalesce(v_row.refund_state, 'none') <> 'none' then
    update public.orders
       set lazywait_sync_state  = 'blocked',
           sync_blocked_reason  = 'refund_started',
           sync_last_error      = 'refund_started_before_send',
           sync_next_attempt_at = null,
           sync_status          = 'failed'::public.sync_status,
           updated_at           = now()
     where id = p_order_id;
    insert into public.integration_sync_logs (provider, order_id, direction, status, error)
      values ('lazywait', p_order_id, 'push', 'skipped', 'refund_started_before_send');
    return 'refund_started';
  end if;

  if v_row.status in ('ready', 'out_for_delivery', 'delivered') then
    update public.orders
       set lazywait_sync_state  = 'blocked',
           sync_blocked_reason  = 'order_progressed',
           sync_last_error      = 'order_progressed_before_send',
           sync_next_attempt_at = null,
           sync_status          = 'failed'::public.sync_status,
           updated_at           = now()
     where id = p_order_id;
    insert into public.integration_sync_logs (provider, order_id, direction, status, error)
      values ('lazywait', p_order_id, 'push', 'skipped', 'order_progressed_before_send');
    return 'order_progressed';
  end if;

  if v_row.pos_sync_deadline_at is null then
    return 'invalid_state';
  end if;
  if now() >= v_row.pos_sync_deadline_at then
    return 'deadline_expired';
  end if;

  update public.orders
     set pos_create_attempted_at  = now(),
         pos_create_attempt_token = p_attempt_token,
         updated_at               = now()
   where id = p_order_id;

  return 'ready_to_send';
end $$;
-- create or replace keeps the ACL; restated so it does not depend on history.
revoke all on function public.begin_lazywait_create_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_lazywait_create_attempt(uuid, text) to service_role;
comment on function public.begin_lazywait_create_attempt(uuid, text) is
  'Fenced pre-send gate for the Lazywait Create Order POST: under the row lock, refuses a ref-bearing, non-syncing, already-attempted or past-deadline order, else durably stamps the attempt marker and token and answers ready_to_send (20260721120000). Refuses and parks, in the same statement and with no notification: a cancelled order (order_cancelled, 20261015120000); an order with any refund lifecycle (refund_started) and an order already ready, out for delivery or delivered (order_progressed), since 20261022120000. Service role only.';

-- ---------------------------------------------------------------------------
-- 2. request_customer_pos_resend: no Resend once the branch has the order
-- ---------------------------------------------------------------------------
-- The 20261012120000 body, comment lines removed, with one statement added
-- after the eligibility refusal and before the update.
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

  if v_order.status <> 'received' then
    insert into public.integration_sync_logs(provider,order_id,direction,status,request,error)
      values('lazywait',p_order_id,'push','skipped',jsonb_build_object('action','customer_resend','status',v_order.status::text),'resend_rejected_order_in_progress');
    v_state := public.customer_order_state(v_order.order_type::text,v_order.payment_method,v_order.payment_status::text,v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,v_order.sync_next_attempt_at,v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,v_order.refund_state);
    return jsonb_build_object('outcome','unavailable','state',v_state,'reason','order_in_progress',
      'message','The branch already has this order, so it was not sent again.');
  end if;

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
revoke all on function public.request_customer_pos_resend(uuid) from public, anon;
grant execute on function public.request_customer_pos_resend(uuid) to authenticated;
comment on function public.request_customer_pos_resend(uuid) is
  'Customer Resend order. Owner-only (NULL-safe since 20261012120000). Refuses a cancelled order with reason order_cancelled (since 20261012120000), and an otherwise eligible order whose status has left received with reason order_in_progress (since 20261022120000), each with outcome unavailable and a message; otherwise re-queues a proven-not-sent order within the three-attempt budget (20260813143000).';

-- ---------------------------------------------------------------------------
-- 3. requeue_lazywait_order: no Retry for a refunded or progressed order
-- ---------------------------------------------------------------------------
-- The 20261015120000 body with two statements after the eligibility refusal
-- and before the update, so every existing refusal keeps its message.
create or replace function public.requeue_lazywait_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_elig  text;
begin
  if not public.is_admin() then
    raise exception 'Only admins may requeue Lazywait sync' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found: Order not found' using errcode = 'P0002';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled: This order was cancelled. A cancelled order is never sent to the branch.'
      using errcode = 'P0001';
  end if;

  v_elig := public.lazywait_requeue_eligibility(
    v_order.lazywait_sync_state, v_order.lazywait_ref, v_order.pos_sync_deadline_at,
    v_order.sync_attempt_count, v_order.pos_create_attempted_at, v_order.order_type::text,
    v_order.sync_blocked_reason);

  if v_elig <> 'requeued' then
    raise exception '%', v_elig || ': ' || case v_elig
      when 'deadline_expired'      then 'Automatic POS retry window has expired. Verify the order manually.'
      when 'confirmation_required' then 'Order needs manual verification; automatic retry is disabled.'
      when 'already_synced'        then 'Order already has a usable POS reference / is synced; never resend.'
      when 'ref_present_unverified' then 'An existing POS reference marker requires manual verification; automatic resend is disabled.'
      when 'may_have_sent'         then 'A Create Order request may already have been sent; verify manually before any resend.'
      when 'attempt_limit_reached' then 'Maximum POS retry attempts reached. Verify the order manually.'
      else                              'Order is not in a safe, retryable state.'
    end
    using errcode = 'P0001';
  end if;

  if coalesce(v_order.refund_state, 'none') <> 'none' then
    raise exception 'refund_in_progress: This order''s payment is being refunded or has been refunded (refund %). An order whose money is going back is never sent to the branch.',
      v_order.refund_state
      using errcode = 'P0001';
  end if;

  if v_order.status <> 'received' then
    raise exception 'order_in_progress: This order is already %. The branch is handling it, so it is not sent to the POS again.',
      replace(v_order.status::text, '_', ' ')
      using errcode = 'P0001';
  end if;

  update public.orders set
    lazywait_sync_state  = 'pending',
    sync_next_attempt_at = now(),
    sync_last_error      = null,
    sync_blocked_reason  = null,
    sync_status          = 'not_synced'::public.sync_status,
    updated_at           = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;
revoke all on function public.requeue_lazywait_order(uuid) from public, anon;
grant execute on function public.requeue_lazywait_order(uuid) to authenticated;
comment on function public.requeue_lazywait_order(uuid) is
  'Admin Retry for a Lazywait POS sync. is_admin() only. Refuses a cancelled order with P0001 order_cancelled (since 20261015120000), every order lazywait_requeue_eligibility does not answer requeued (20260721120000, 20260827120000), and, since 20261022120000, an order with any refund lifecycle (refund_in_progress) or whose status has left received (order_in_progress); otherwise re-queues it as pending.';

-- ---------------------------------------------------------------------------
-- 4. claim_order_refund: only for an order that is received or cancelled
-- ---------------------------------------------------------------------------
-- The 20261016120000 body, comment lines removed, with the same order-status
-- filter added to the candidate scan and to the re-check under the lock.
create or replace function public.claim_order_refund(
  p_claim_token        text,
  p_exclude_refund_ids uuid[] default '{}'::uuid[]
)
returns table (
  refund_id       uuid,
  order_id        uuid,
  provider        text,
  charge_ref      text,
  idempotency_key text,
  amount          numeric,
  currency        text,
  attempt_count   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.order_refunds;
  v_id    uuid;
  v_found boolean := false;
  v_exclude uuid[] := coalesce(array_remove(p_exclude_refund_ids, null), '{}'::uuid[]);
begin
  if p_claim_token is null or p_claim_token = '' then
    raise exception 'claim token required' using errcode = '22004';
  end if;

  for v_id in
    select rf.id from public.order_refunds rf
     where rf.status = 'pending'
       and rf.id <> all (v_exclude)
       and (rf.next_attempt_at is null or rf.next_attempt_at <= now())
       and exists (select 1 from public.orders o
                    where o.id = rf.order_id and o.status in ('received', 'cancelled'))
     order by rf.updated_at, rf.created_at, rf.id
     limit 50
  loop
    select * into v_row from public.order_refunds rf
     where rf.id = v_id and rf.status = 'pending'
       and (rf.next_attempt_at is null or rf.next_attempt_at <= now())
       and exists (select 1 from public.orders o
                    where o.id = rf.order_id and o.status in ('received', 'cancelled'))
     for update of rf skip locked;
    if found then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    return;
  end if;

  update public.order_refunds r
     set status = 'processing', claim_token = p_claim_token,
         attempt_count = r.attempt_count + 1, updated_at = now()
   where r.id = v_row.id
   returning r.* into v_row;

  update public.orders set refund_state = 'processing', updated_at = now()
   where id = v_row.order_id and refund_state in ('pending','failed');

  return query select v_row.id, v_row.order_id, v_row.provider, v_row.charge_ref,
                      v_row.idempotency_key, v_row.amount, v_row.currency, v_row.attempt_count;
end $$;
revoke all on function public.claim_order_refund(text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_order_refund(text, uuid[]) to service_role;
comment on function public.claim_order_refund(text, uuid[]) is
  'Refund worker claim: the least-recently-touched DUE pending refund (20261013120000, 20261016120000), locked with SKIP LOCKED and re-checked, moved to processing under the caller''s token. Since 20261022120000 only for an order that is received or cancelled, so a refund on an order the branch fulfilled is never paid out automatically. Service role only.';

-- ---------------------------------------------------------------------------
-- 5. guard_order_progress_refund: no POS-failure refund for an order the branch
--    is fulfilling, and no fulfilment of an order whose money is going back
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_progress_refund()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status not in ('received', 'cancelled')
     and new.refund_state = 'pending'
     and coalesce(old.refund_state, 'none') = 'none'
     and public.order_refund_due(
       new.payment_status::text, new.lazywait_sync_state, new.lazywait_ref,
       new.sync_blocked_reason, new.pos_create_attempted_at,
       new.pos_customer_retry_count, 'none', new.total) then
    new.refund_state       := old.refund_state;
    new.refund_required_at := old.refund_required_at;
  end if;

  if new.status is distinct from old.status
     and new.status <> 'cancelled'
     and new.refund_state in ('pending', 'processing', 'refunded') then
    raise exception 'refund_in_progress: This order''s payment % to the customer, so it cannot be moved to %. Cancel the order instead.',
      case when new.refund_state = 'refunded' then 'has been refunded' else 'is being refunded' end,
      replace(new.status::text, '_', ' ')
      using errcode = 'P0001';
  end if;

  return new;
end $$;
revoke all on function public.guard_order_progress_refund() from public, anon, authenticated;
comment on function public.guard_order_progress_refund() is
  'BEFORE INSERT OR UPDATE on orders, after set_orders_refund_enrollment (20261022120000). Undoes the POS-failure refund enrolment for an order whose status is neither received nor cancelled, and refuses any status change other than to cancelled while a refund is pending, processing or refunded.';

drop trigger if exists set_orders_refund_progress_guard on public.orders;
create trigger set_orders_refund_progress_guard
  before insert or update on public.orders
  for each row execute function public.guard_order_progress_refund();

-- ---------------------------------------------------------------------------
-- 6. Self-verification: outcomes first, then the stored text, trigger order,
--    grants and the money path. Every outcome is read back as a value.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_tag     constant text := 'VERIFY-20261022120000-';
  v_branch  uuid := gen_random_uuid();
  v_rf      uuid := gen_random_uuid();   -- syncing, received, refund pending
  v_g       uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                            gen_random_uuid(), gen_random_uuid()];
  v_stat    text[] := array['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
  v_want    text[] := array['ready_to_send', 'ready_to_send', 'order_progressed', 'order_progressed', 'order_progressed'];
  v_e_rcv   uuid := gen_random_uuid();   -- paid card order, received, fails at the POS
  v_e_rdy   uuid := gen_random_uuid();   -- the same, ready
  v_c_dlv   uuid := gen_random_uuid();   -- delivered, a refund pending from before
  v_c_ofd   uuid := gen_random_uuid();   -- out for delivery, a refund pending from before
  v_r_rfd   uuid := gen_random_uuid();   -- received, its refund paid out
  v_all     uuid[];
  v_exclude uuid[];
  v_n       integer;
  v_ans     text;
  v_code    text;
  v_msg     text;
  v_src     text;
  v_at      integer;
  o         public.orders;
  r         record;
  i         integer;
begin
  v_all := v_g || array[v_rf, v_e_rcv, v_e_rdy, v_c_dlv, v_c_ofd, v_r_rfd];
  begin
    insert into public.branches (id, name_en, name_ar) values (v_branch, v_tag || 'branch', v_tag || 'branch');

    -- (a) The gate in every status, and with a refund pending.
    for i in 1 .. 5 loop
      insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                                 payment_method, payment_status)
      values (v_g[i], v_tag || 'g' || i, v_branch, case when i = 4 then 'delivery' else 'pickup' end::public.order_type,
              v_stat[i]::public.order_status, 10, 10, 'cash', 'pending');
    end loop;
    insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                               payment_method, payment_status)
    values (v_rf, v_tag || 'rf', v_branch, 'pickup', 'received', 10, 10, 'cash', 'pending');
    update public.orders set refund_state = 'pending' where id = v_rf;
    update public.orders
       set lazywait_sync_state = 'syncing', lazywait_ref = null,
           pos_create_attempted_at = null, pos_create_attempt_token = null,
           pos_sync_deadline_at = now() + interval '5 minutes'
     where id = any (v_g || array[v_rf]);
    if (select count(*) from public.orders where id = any (v_g || array[v_rf]) and lazywait_sync_state = 'syncing') <> 6 then
      raise exception 'VERIFY: the gate probes did not start in the shape a claim leaves';
    end if;

    for i in 1 .. 5 loop
      v_ans := public.begin_lazywait_create_attempt(v_g[i], 'verify-token');
      select * into o from public.orders where id = v_g[i];
      if v_ans is distinct from v_want[i] then
        raise exception 'VERIFY: the gate answered a % order with % (expected %)', v_stat[i], coalesce(v_ans, '<null>'), v_want[i];
      end if;
      if v_want[i] = 'ready_to_send' and o.pos_create_attempt_token is distinct from 'verify-token' then
        raise exception 'VERIFY: a % order was not stamped for sending', v_stat[i];
      end if;
      if v_want[i] = 'order_progressed'
         and (o.lazywait_sync_state is distinct from 'blocked' or o.sync_blocked_reason is distinct from 'order_progressed'
              or o.pos_create_attempted_at is not null) then
        raise exception 'VERIFY: a % order was not parked blocked/order_progressed with no marker (% / %)',
          v_stat[i], o.lazywait_sync_state, coalesce(o.sync_blocked_reason, '<null>');
      end if;
    end loop;
    v_ans := public.begin_lazywait_create_attempt(v_rf, 'verify-token');
    select * into o from public.orders where id = v_rf;
    if v_ans is distinct from 'refund_started' or o.lazywait_sync_state is distinct from 'blocked'
       or o.sync_blocked_reason is distinct from 'refund_started' or o.pos_create_attempted_at is not null then
      raise exception 'VERIFY: an order with a refund pending was answered % and left % / %',
        coalesce(v_ans, '<null>'), o.lazywait_sync_state, coalesce(o.sync_blocked_reason, '<null>');
    end if;
    if (select count(*) from public.integration_sync_logs where order_id = any (v_g || array[v_rf])
         and status = 'skipped' and error in ('order_progressed_before_send', 'refund_started_before_send')) <> 4 then
      raise exception 'VERIFY: the gate refusals did not write exactly one skipped sync-log row each';
    end if;
    if exists (select 1 from public.notification_log where order_id = any (v_g || array[v_rf])) then
      raise exception 'VERIFY: a gate refusal queued a notification';
    end if;

    -- (b) The POS-failure refund: enrolled while received, not once ready.
    insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                               payment_method, payment_status)
    values (v_e_rcv, v_tag || 'er', v_branch, 'pickup', 'received', 20, 20, 'online', 'paid'),
           (v_e_rdy, v_tag || 'ey', v_branch, 'pickup', 'ready',    20, 20, 'online', 'paid');
    update public.orders
       set lazywait_sync_state = 'blocked', sync_blocked_reason = 'client_error_422',
           sync_last_error = 'client_error_422', lazywait_ref = null,
           pos_create_attempted_at = null, pos_customer_retry_count = public.customer_pos_resend_limit()
     where id in (v_e_rcv, v_e_rdy);
    select * into o from public.orders where id = v_e_rcv;
    if o.refund_state is distinct from 'pending'
       or (select count(*) from public.order_refunds where order_id = v_e_rcv) <> 1 then
      raise exception 'VERIFY: a received paid order that failed at the POS was not enrolled (refund %)', coalesce(o.refund_state, '<null>');
    end if;
    select * into o from public.orders where id = v_e_rdy;
    if o.refund_state is distinct from 'none' or o.refund_required_at is not null
       or exists (select 1 from public.order_refunds where order_id = v_e_rdy) then
      raise exception 'VERIFY: a ready paid order that failed at the POS was enrolled (refund %)', coalesce(o.refund_state, '<null>');
    end if;

    -- (c) The status guard: no forward move with a refund pending; cancel is open.
    v_code := 'none';
    begin
      update public.orders set status = 'preparing' where id = v_e_rcv;
    exception when others then
      v_code := sqlstate; v_msg := sqlerrm;
    end;
    if v_code is distinct from 'P0001' or coalesce(v_msg, '') not like 'refund_in_progress:%' then
      raise exception 'VERIFY: moving an order with a refund pending to preparing answered % (%)', v_code, coalesce(v_msg, '<null>');
    end if;
    insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                               payment_method, payment_status)
    values (v_c_dlv, v_tag || 'cd', v_branch, 'pickup',   'delivered',        15, 15, 'cash', 'pending'),
           (v_c_ofd, v_tag || 'co', v_branch, 'delivery', 'out_for_delivery', 15, 15, 'cash', 'pending');
    update public.orders set refund_state = 'pending' where id in (v_c_dlv, v_c_ofd);
    v_code := 'none';
    begin
      update public.orders set status = 'delivered' where id = v_c_ofd;
    exception when others then
      v_code := sqlstate; v_msg := sqlerrm;
    end;
    if v_code is distinct from 'P0001' or coalesce(v_msg, '') not like 'refund_in_progress:%' then
      raise exception 'VERIFY: delivering an order with a refund pending answered % (%)', v_code, coalesce(v_msg, '<null>');
    end if;
    update public.orders set status = 'cancelled' where id = v_c_ofd;
    if (select status::text from public.orders where id = v_c_ofd) is distinct from 'cancelled' then
      raise exception 'VERIFY: an order with a refund pending could not be cancelled';
    end if;
    -- A refund already paid out blocks a forward move just the same.
    insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                               payment_method, payment_status)
    values (v_r_rfd, v_tag || 'rr', v_branch, 'pickup', 'received', 15, 15, 'cash', 'pending');
    update public.orders set refund_state = 'pending'    where id = v_r_rfd;
    update public.orders set refund_state = 'processing' where id = v_r_rfd;
    update public.orders set refund_state = 'refunded'   where id = v_r_rfd;
    v_code := 'none';
    begin
      update public.orders set status = 'preparing' where id = v_r_rfd;
    exception when others then
      v_code := sqlstate; v_msg := sqlerrm;
    end;
    if v_code is distinct from 'P0001' or coalesce(v_msg, '') not like 'refund_in_progress:%' then
      raise exception 'VERIFY: moving a refunded order to preparing answered % (%)', v_code, coalesce(v_msg, '<null>');
    end if;

    -- (d) The claim: the received order's refund is handed out; the delivered
    -- one's is not. Every other refund, including every one that existed before
    -- this probe, is excluded, so no real refund is claimed, even inside this
    -- aborted sub-transaction.
    select coalesce(array_agg(id), '{}'::uuid[]) into v_exclude from public.order_refunds
     where not (order_id in (v_e_rcv, v_c_dlv));
    select count(*) into v_n from public.order_refunds where order_id in (v_e_rcv, v_c_dlv) and status = 'pending';
    if v_n <> 2 then
      raise exception 'VERIFY: the claim probes did not start with two pending refunds (found %)', v_n;
    end if;
    v_ans := null;
    select cr.order_id::text into v_ans from public.claim_order_refund('verify-claim', v_exclude) cr;
    if v_ans is distinct from v_e_rcv::text then
      raise exception 'VERIFY: the claim handed out % (expected the received order)', coalesce(v_ans, '<nothing>');
    end if;
    v_ans := null;
    select cr.order_id::text into v_ans from public.claim_order_refund('verify-claim', v_exclude || array(
      select id from public.order_refunds where order_id = v_e_rcv)) cr;
    if v_ans is not null then
      raise exception 'VERIFY: the claim handed out a refund for a delivered order (%)', v_ans;
    end if;
    if (select status from public.order_refunds where order_id = v_c_dlv) is distinct from 'pending'
       or (select refund_state from public.orders where id = v_c_dlv) is distinct from 'pending' then
      raise exception 'VERIFY: the delivered order''s refund was touched';
    end if;

    -- (e) The two client RPCs, as far as their gates (see the header).
    v_code := 'none';
    begin
      perform public.requeue_lazywait_order(v_g[3]);
    exception when others then
      v_code := sqlstate;
    end;
    if v_code is distinct from '42501' then
      raise exception 'VERIFY: requeue_lazywait_order without an administrator answered % instead of 42501', v_code;
    end if;
    v_code := 'none';
    begin
      perform public.request_customer_pos_resend(v_g[3]);
    exception when others then
      v_code := sqlstate;
    end;
    if v_code is distinct from '28000' then
      raise exception 'VERIFY: request_customer_pos_resend without a caller answered % instead of 28000', v_code;
    end if;

    raise exception 'ROLLBACK_PROBE_20261022120000';
  exception when others then
    if sqlerrm is distinct from 'ROLLBACK_PROBE_20261022120000' then raise; end if;
  end;

  if exists (select 1 from public.orders where order_number like v_tag || '%')
     or exists (select 1 from public.branches where id = v_branch)
     or exists (select 1 from public.order_refunds where order_id = any (v_all))
     or exists (select 1 from public.integration_sync_logs where order_id = any (v_all))
     or exists (select 1 from public.notification_log where order_id = any (v_all)) then
    raise exception 'VERIFY: a probe row survived the sub-transaction';
  end if;

  -- ---- The stored text, comment-stripped so a comment cannot satisfy it ----
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_customer_pos_resend';
  v_at := position('if v_order.status <> ''received'' then' in v_src);
  if v_at = 0 or position('''reason'',''order_in_progress''' in v_src) = 0 then
    raise exception 'VERIFY: request_customer_pos_resend does not refuse an order the branch has';
  end if;
  if v_at < position('if v_elig <> ''eligible'' then' in v_src)
     or v_at > position('update public.orders set' in v_src)
     or position('if v_order.status = ''cancelled'' then' in v_src) = 0 then
    raise exception 'VERIFY: the order_in_progress refusal is not between the eligibility refusal and the update';
  end if;

  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'requeue_lazywait_order';
  v_at := least(nullif(position('refund_in_progress: ' in v_src), 0), nullif(position('order_in_progress: ' in v_src), 0));
  if v_at is null or position('refund_in_progress: ' in v_src) = 0 or position('order_in_progress: ' in v_src) = 0
     or position('if v_order.status <> ''received'' then' in v_src) = 0
     or position('if coalesce(v_order.refund_state, ''none'') <> ''none'' then' in v_src) = 0 then
    raise exception 'VERIFY: requeue_lazywait_order does not refuse a refunded or progressed order';
  end if;
  if v_at < position('if not public.is_admin() then' in v_src)
     or v_at < position('if v_elig <> ''requeued'' then' in v_src)
     or v_at > position('update public.orders set' in v_src) then
    raise exception 'VERIFY: the requeue refusals are not between the eligibility refusal and the update';
  end if;

  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_order_refund';
  select count(*) into v_n from regexp_matches(v_src, 'o\.status in \(''received'', ''cancelled''\)', 'g');
  if v_n <> 2 then
    raise exception 'VERIFY: claim_order_refund carries the order-status filter % times (expected 2: the scan and the lock)', v_n;
  end if;

  -- ---- The trigger: present, enabled, row-level BEFORE, after the enrolment --
  select count(*) into v_n from pg_trigger t
   where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgenabled = 'O'
     and t.tgname = 'set_orders_refund_progress_guard'
     and t.tgfoid = 'public.guard_order_progress_refund()'::regprocedure
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
  if v_n <> 1 then
    raise exception 'VERIFY: set_orders_refund_progress_guard is not an enabled BEFORE UPDATE row trigger on orders';
  end if;
  if not ('set_orders_refund_progress_guard' > 'set_orders_refund_enrollment' collate "C") then
    raise exception 'VERIFY: the guard trigger would fire before the enrolment trigger';
  end if;

  -- ---- Grants -------------------------------------------------------------
  for r in
    select * from (values
      ('public.begin_lazywait_create_attempt(uuid, text)', false, true),
      ('public.request_customer_pos_resend(uuid)',         true,  false),
      ('public.requeue_lazywait_order(uuid)',              true,  false),
      ('public.claim_order_refund(text, uuid[])',          false, true),
      ('public.guard_order_progress_refund()',             false, false)
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

  -- ---- The money path: one overload each, and neither moved by this file ---
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('place_order', 'compute_order_snapshot');
  if v_n <> 2 then raise exception 'VERIFY: expected one place_order and one compute_order_snapshot, found % functions', v_n; end if;
  for r in select fn, h from pos_resend_refund_guards_money_path loop
    if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.fn) is distinct from r.h or r.h is null then
      raise exception 'VERIFY: % changed during this migration', r.fn;
    end if;
  end loop;
end
$verify$;

drop table pos_resend_refund_guards_money_path;
