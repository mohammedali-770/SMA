import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';

/**
 * order-intake — authenticated "create order + sync to POS" orchestration.
 *
 * 1) Calls place_order AS THE USER, so auth.uid(), RLS, totals, coupon, VAT and
 *    loyalty stay the single source of truth (nothing about pricing changes).
 * 2) Best-effort SYNCHRONOUS Lazywait sync so the receipt can show the POS order
 *    number (e.g. "#5") immediately: it invokes the existing `lazywait-sync`
 *    worker (which owns the confirmed Create Order payload + claim-lock + retry
 *    logic) server-to-server and waits for it, bounded by an ~11s timeout. On a
 *    slow/down POS it returns the order WITHOUT a POS number — the order still
 *    stands and the background worker finishes it, so the app falls back to the
 *    SM-… number. A POS problem can NEVER fail the order or block checkout past
 *    the timeout.
 *
 * The Lazywait payload/logic live only in the worker (unchanged), and the
 * `sync_trigger_secret` is read server-side and sent as the x-sync-secret header
 * — it never reaches the app or the response.
 */
/**
 * How long checkout will wait for the POS before returning the order without a
 * branch number.
 *
 * CUT TO 5 s ON 2026-08-27 AND REVERTED TO 11 s ON 2026-08-28. The measurements
 * behind the cut still stand — once the kick was targeted and the reaper, push
 * drain and CRM lookup came off the awaited path, everything WE do collapsed to
 * ~1.2-1.5 s (SM-2026-000068: worker boot + config 1.08 s, claim and three
 * reads 2 ms apart, 68 ms from the reads to the pre-send gate), and what is
 * left is Lazywait's own erratic Create Order call:
 *
 *     SM-2026-000065   1.57 s
 *     SM-2026-000067   2.40 s
 *     SM-2026-000068   8.02 s
 *
 * The cut was reverted anyway, because it was shipped WITHOUT its client half
 * and that broke a customer-visible promise. Returning at 5 s hands the app a
 * row that is `syncing` with `pos_create_attempted_at` already set — the marker
 * is written immediately before the POST leaves — and the confirmation screen
 * read that as ambiguous, showing "we could not verify whether the branch
 * received this order" on a healthy order. SM-2026-000070 was synced as ticket
 * #2 in 7.30 s with zero failed attempts, and its customer was shown that
 * screen and a "confirmed" push at the same time.
 *
 * Two client changes make 5 s safe, and BOTH need an app build to reach a
 * customer:
 *
 *   1. deriveCustomerOrderState must test `syncing` before the phase marker
 *      (fixed 2026-08-28 in apps/mobile/src/features/orders/orderConfirmation.ts);
 *   2. the receipt must poll at 2 s while the number is pending rather than 25 s
 *      (nextReceiptPollMs, apps/mobile/src/features/orders/ordersRefresh.ts).
 *
 * Until a build ships both, 11 s is the value that keeps the number on first
 * paint for every observed order — SM-2026-000070 included.
 *
 * TIMING OUT IS NOT A FAILURE. The abort only stops order-intake WAITING; the
 * worker keeps running and finishes the sync (observed on SM-2026-000064). That
 * remains true at either value; it is not what made 5 s unsafe.
 *
 * RE-CUT THIS TO 5 s once a build carrying both client changes is out, not
 * before. It is a one-constant change with a tripwire in
 * _shared/orderIntakeSyncWiring.test.ts.
 */
const SYNC_TIMEOUT_MS = 11_000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const supa = userClient(auth);
  // place_order is no longer granted to `authenticated`; the customer path goes
  // through place_customer_order, a thin wrapper with identical pricing/loyalty/
  // idempotency that returns a customer-safe projection (migration 20260724200000).
  const { data: placed, error } = await supa.rpc('place_customer_order', {
    p_branch_id: body.branchId,
    p_order_type: body.orderType,
    p_items: body.items,
    p_address_id: body.addressId ?? null,
    p_coupon_code: body.couponCode ?? null,
    p_notes: body.notes ?? null,
    p_loyalty_points: body.loyaltyPoints ?? 0,
    p_idempotency_key: body.idempotencyKey ?? null,
    p_payment_method: body.paymentMethod ?? null,
  });
  if (error) return json({ error: error.message }, 400);

  const order = placed as Record<string, unknown> | null;
  const orderId = order?.id ? String(order.id) : null;
  if (!orderId) return json({ error: 'Order was not created.' }, 400);

  // Best-effort synchronous POS sync, for PICKUP AND DELIVERY alike. Fully
  // guarded — a POS/network problem never fails the order.
  //
  // This used to read `if (order_type === 'pickup')`, which was correct only
  // while `set_lazywait_initial_sync` parked every delivery order at `blocked`
  // on INSERT: kicking the worker for an order it would refuse was pointless.
  // Migration 20260827120000 removed that trigger branch and worker v6 sends
  // delivery, so the gate became a leftover — and an expensive one. A delivery
  // order fell through to the once-a-minute cron instead, which is exactly the
  // 18-45 s the owner measured between placing an order and the branch number
  // appearing (SM-2026-000059 42.3 s, -60 32.2 s, -61 17.8 s, -62 44.6 s — all
  // first-attempt successes, so the wait was the tick, never the POS).
  //
  // It also explains the false push. The "order received" push below fires
  // AFTER this block, so for pickup it followed a real sync attempt; for
  // delivery the block was skipped entirely and the customer was told the
  // kitchen had their order before anything had been sent. Closing the gate
  // makes the ordering honest for both.
  //
  // This was the FIFTH place the pickup-only assumption was written down —
  // after the insert trigger, `buildCreateOrderPayload`, `confirm_order_payment`
  // and the watchdog's R1/R7.
  {
    try {
      const admin = adminClient();
      const cfg = await getProviderConfig(admin, 'lazywait');
      const secret = String((cfg?.secretConfig as Record<string, unknown>)?.sync_trigger_secret ?? '');
      const url = Deno.env.get('SUPABASE_URL');
      const anon = Deno.env.get('SUPABASE_ANON_KEY');
      if (cfg?.enabled && secret && url && anon) {
        await fetch(`${url}/functions/v1/lazywait-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anon, 'x-sync-secret': secret },
          // TARGETED: sync THIS order, not "up to five, oldest first".
          //
          // claim_lazywait_sync_batch orders by created_at ASC, and the worker
          // processes serially, so the customer's brand-new order was the LAST
          // of whatever the batch claimed — their checkout blocked while other
          // people's orders were sent to the POS. On SM-2026-000065 the awaited
          // call took 10.747 s against the 11 s abort below; on -000064 the
          // abort appears to have fired and the order number arrived by luck.
          //
          // The id is server-derived: it comes from place_customer_order's
          // return, not from the request body, so a client cannot name somebody
          // else's order. Draining the rest of the queue was never this
          // function's job — the once-a-minute cron owns that.
          body: JSON.stringify({ orderId }),
          signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        });
      }
    } catch { /* never block/fail the order on a POS hiccup — background retry covers it */ }
  }

  // NO "order received" push is sent from here, deliberately — removed
  // 2026-08-27. Do not put one back without reading this.
  //
  // This used to fire `order_status/received` unconditionally, whose copy is
  // "We received your order and sent it to the kitchen" / "استلمنا طلبك وتم
  // إرساله إلى المطبخ". That is a claim about the BRANCH, and it was made
  // whether or not the branch had heard of the order: for delivery the sync
  // block above was skipped entirely, so the customer was told the kitchen had
  // their food before anything had been sent anywhere. The owner's instruction
  // was exact — it "shall not happen until the order is reached lazywait".
  //
  // The POS outcome now owns the customer's first message, because only the POS
  // outcome knows the truth. `record_lazywait_sync` enqueues one deduplicated
  // event per transition and `lazywait-sync` dispatches it in the same
  // invocation this function just triggered:
  //
  //   reached the branch  -> pos_confirmed             "confirmed by the restaurant"
  //   retryable failure   -> pos_retrying              "we are retrying, do not reorder"
  //   ambiguous outcome   -> pos_confirmation_required "we are verifying"
  //   terminal failure    -> pos_failed                "we could not send it"
  //
  // So the customer still hears within a second or two on the happy path — and
  // whatever they hear is true. `STATUS_COPY.received` is retained in
  // push-dispatch for the admin status path, which is a real transition made by
  // a human and is unaffected.

  // Return ONLY the customer-safe projection of the fresh RLS-scoped row, so the
  // client sees the branch (POS) number if it arrived in time. The internal SM-…
  // number and every operational column (including the POS fencing token) are
  // never sent to a customer device — Issue #94. The column list mirrors
  // apps/mobile/src/lib/orderSelect.ts.
  const { data: fresh } = await supa
    .from('orders')
    .select(
      'id, status, order_type, created_at, branch_id, branch_name_en, branch_name_ar, '
      + 'subtotal, delivery_fee, discount_amount, loyalty_discount_amount, vat_amount, total, '
      + 'loyalty_points_earned, payment_status, payment_method, lazywait_order_number, '
      + 'lazywait_sync_state, lazywait_ref, sync_blocked_reason, sync_next_attempt_at, '
      + 'pos_create_attempted_at, pos_customer_retry_count, refund_state, '
      + 'order_items(id, name_en, name_ar, unit_price, quantity, '
      + 'order_item_modifiers(id, name_en, name_ar, price))',
    )
    .eq('id', orderId)
    .maybeSingle();
  return json({ order: fresh });
});
