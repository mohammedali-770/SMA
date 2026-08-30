import { corsHeaders, json } from '../_shared/cors.ts';
import {
  callerTarget,
  isRow,
  restProviderConfig,
  restRpc,
  restSelectMaybeSingle,
  serviceTarget,
} from '../_shared/rest.ts';

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
 *
 * NO npm DEPENDENCY. This function talks to PostgREST through
 * `_shared/rest.ts`, plain `fetch` over Web-standard APIs, instead of
 * `npm:@supabase/supabase-js@2`.
 *
 * READ THE HEADER OF `_shared/rest.ts` BEFORE REPEATING THE REASON. The change
 * was made to shrink the 2351 ms front measured on SM-2026-000073, on the
 * theory that module evaluation was a large part of it. Measurement after the
 * deploy refuted the MECHANISM: this function's `booted` event reads 23 ms with
 * supabase-js and 23 ms without, so isolate boot is not where two seconds were
 * hiding.
 *
 * What that does NOT establish is what the whole front now costs. No
 * authenticated order has run on this version yet, and the only v11 request so
 * far was an `OPTIONS` preflight, which returns before the auth check and does
 * no body read and no PostgREST call — not comparable. The dependency is still
 * better gone (the hottest customer path should not carry one it does not need,
 * and the replacement has executable tests the old path never had), but treat
 * the latency effect as UNMEASURED, not as zero.
 *
 * Keep it that way. `restNoSupabaseJs.test.ts` walks this file's import graph
 * and fails if any file in it references the package in CODE — a type-only
 * import included, because "the bundler erases it" is a belief about somebody
 * else's build step and an import graph is a fact about this one. Comments are
 * stripped first, which is why this paragraph may name it.
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

/**
 * Stamped when the MODULE is evaluated — i.e. at isolate boot, before
 * Deno.serve even registers the handler. `t0 - MODULE_LOADED_AT` at handler
 * entry is therefore the isolate's age: near zero means this request paid the
 * boot and module evaluation, a large value means it landed on a warm isolate.
 *
 * This is the only part of the pre-handler front observable from inside the
 * function, and it exists because putting t0 on the first line of the callback
 * is NOT the same as measuring the invocation. Review raised that as a P1 and
 * it was right: the imports above are evaluated here, before any callback runs,
 * and gateway JWT verification happens before that again.
 *
 * Compare `isolate_age_ms` near zero (a cold request) against the platform's
 * `execution_time_ms` minus this handler's `total_ms`: that difference is the
 * front. It was 2351 ms on the one cold order measured so far, and what it
 * consists of is NOT known. Isolate boot is ruled OUT as the large term — the
 * runtime's own `booted` metric reads 23 ms with the npm dependency and 23 ms
 * without — but the front itself has not been re-measured on this version,
 * because that needs a real authenticated order and none has run yet. Do not
 * attribute it again without a measurement that separates the parts, and do not
 * report it as unchanged either.
 */
const MODULE_LOADED_AT = Date.now();

/**
 * The customer-safe projection of a fresh order row, hoisted out of the call so
 * a test can read it. Byte-identical to the string this function has always
 * sent — the whitespace and line breaks are kept because `cleanSelect` in
 * _shared/rest.ts strips them exactly as postgrest-js did.
 *
 * The internal SM-… number and every operational column (including the POS
 * fencing token) are never sent to a customer device — Issue #94.
 *
 * IT IS NOT A MIRROR OF apps/mobile/src/lib/orderSelect.ts, whatever the comment
 * here used to say. It is SIX columns behind it — `is_comped`,
 * `comp_discount_amount`, `notes`, the item-level `note`, `variant_name_en` and
 * `variant_name_ar` — drift that predates this change and is harmless today
 * only because the caller discards everything but `.id` (CheckoutScreen) and the
 * receipt re-reads with the full mobile select. Widening it is safe now that the
 * variant and comp migrations are applied, but it is a separate change with its
 * own customer-visible surface, and nothing currently pins the two lists
 * together.
 */
const ORDER_SELECT =
  'id, status, order_type, created_at, branch_id, branch_name_en, branch_name_ar, '
  + 'subtotal, delivery_fee, discount_amount, loyalty_discount_amount, vat_amount, total, '
  + 'loyalty_points_earned, payment_status, payment_method, lazywait_order_number, '
  + 'lazywait_sync_state, lazywait_ref, sync_blocked_reason, sync_next_attempt_at, '
  + 'pos_create_attempted_at, pos_customer_retry_count, refund_state, '
  + 'order_items(id, name_en, name_ar, unit_price, quantity, '
  + 'order_item_modifiers(id, name_en, name_ar, price))';

Deno.serve(async (req: Request) => {
  // FIRST LINE of the callback, deliberately — but NOT the start of the
  // invocation, and the difference matters. The first version set t0 after
  // `await req.json()` and under-reported by 2062 ms on the first real order
  // (total_ms 7129 against the platform's execution_time_ms 9191). Moving it
  // here recovers the header checks and the body read.
  //
  // It does NOT recover the rest. Gateway JWT verification, isolate spawn and
  // module evaluation all happen before this callback is invoked, so
  // `execution_time_ms - total_ms` remains positive BY CONSTRUCTION. It is
  // quantified by subtraction in the logs, not by expecting the two numbers to
  // converge. Review raised this as a P1 against an earlier revision that
  // claimed they would.
  //
  // Call that residual the front only loosely: it is mostly the front, but it
  // also carries the tail after the total_ms stamp — serialising this response
  // and returning it. Small, and unmeasured, which is the reason to say so
  // rather than to round it away.
  const t0 = Date.now();
  const mark: Record<string, number> = {};

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required' }, 401);
  mark.entry = Date.now() - t0;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  // parse − entry is the handler-side BODY READ plus JSON decode. It is a LOWER
  // BOUND on the device's upload, not the upload itself: the runtime may already
  // have buffered part or all of the body before invoking this callback, and
  // anything buffered that early is invisible here. Named body_read_ms rather
  // than upload_span_ms for exactly that reason — the earlier name asserted
  // something this cannot measure. Measured 1 ms on SM-2026-000073, which
  // refuted the body-upload explanation for the front outright.
  mark.parse = Date.now() - t0;

  // THE CALLER'S OWN IDENTITY. `auth` is forwarded verbatim, so auth.uid() and
  // every RLS policy apply exactly as they do from the app. Both customer-facing
  // calls below — place_customer_order and the order re-read — run as this and
  // MUST keep running as this; the service-role identity constructed inside the
  // try further down bypasses RLS entirely and is for the integration secret
  // and nothing else.
  const caller = callerTarget(auth);

  // TIMING. Every hop here is CROSS-REGION and that is a large part of the cost
  // story. The database is in eu-central-1 (Frankfurt); a customer in Saudi
  // Arabia has this function executed in ap-south-1 (Mumbai) or eu-central-2
  // (Zurich), so each PostgREST call pays an intercontinental round trip.
  //
  // Measured per-request on 2026-08-30 from the gateway's own `origin_time`,
  // same worker function, same minute, IDENTICAL statements:
  // `integration_settings` cost 934 ms from Mumbai against 35 ms from
  // Frankfurt, `reap_stale_lazywait_syncs` 525 against 30, `notification_log`
  // 179 against 26. (This supersedes an earlier p50-of-whole-invocations
  // comparison that had n = 1 on one side.)
  //
  // The per-call cost is BIMODAL, not a spread: 64 repetitions of one identical
  // statement measured ~120 ms or ~305 ms and almost nothing between, flipping
  // within a single isolate in both directions. So it is not query cost, not
  // the first call, and not per-isolate setup — an earlier draft of this
  // comment claimed the last of those and was wrong.
  //
  // The practical consequence, opposite to what that draft implied: removing a
  // QUERY removes a real per-call cost, while removing an isolate removes
  // nothing measurable. HOW MUCH a query is worth on THIS path is not known —
  // 120/305 ms was a trivial select measured from IAD, and this path runs RPCs
  // and writes from BOM. docs/ORDER_CONFIRMATION_FLOW.md has the data and the
  // warning.
  //
  // There is no second term to point at here. An earlier version of this comment
  // said "the OTHER part is the boot this function no longer pays for an npm
  // module graph", which the `booted` measurement retired: 23 ms with the
  // dependency and 23 ms without.
  //
  // These marks are logged once per request so the breakdown is a measurement
  // rather than an inference. The previous attempt to apportion this time from
  // outside — subtracting known work from execution_time_ms — produced a
  // confident and WRONG answer (it blamed Deno cold start generically, which a
  // 15-minute idle test then disproved at 828 ms). Numbers only; no order
  // contents, no customer data.
  //
  // t0 and `mark` are declared at the very top of the handler — see the note
  // there on why measuring from the first line is load-bearing.

  // The provider config is read with the SERVICE-ROLE identity and does not
  // depend on the order, so it is started HERE rather than after
  // place_customer_order. It used to run strictly afterwards, which cost a full
  // extra cross-region round trip on the customer's awaited path for no ordering
  // reason.
  //
  // `.catch` rather than a bare promise: an unawaited rejection would be an
  // unhandled promise rejection before the sync block's try/catch can see it.
  // A null here degrades exactly as a missing config already did — the sync
  // block skips the kick and the background worker picks the order up.
  //
  // serviceTarget() itself is inside the guard too. It THROWS when the
  // service-role env is missing, and it used to sit inside the sync block's
  // try/catch — hoisting it bare would have turned a misconfigured environment
  // into a failed checkout, breaking the rule that a POS problem can never fail
  // the order.
  let cfgPromise: Promise<Awaited<ReturnType<typeof restProviderConfig>>>;
  try {
    const admin = serviceTarget();
    cfgPromise = restProviderConfig(admin, 'lazywait')
      .then((c) => { mark.config = Date.now() - t0; return c; })
      .catch(() => { mark.config = Date.now() - t0; return null; });
  } catch {
    mark.config = Date.now() - t0;
    cfgPromise = Promise.resolve(null);
  }

  // place_order is no longer granted to `authenticated`; the customer path goes
  // through place_customer_order, a thin wrapper with identical pricing/loyalty/
  // idempotency that returns a customer-safe projection (migration 20260724200000).
  //
  // A transport failure here comes back as `error`, not as a throw — restRpc
  // keeps postgrest-js's contract precisely so this stays a 400 with a message
  // rather than becoming an unhandled 500.
  const { data: placed, error } = await restRpc<Record<string, unknown>>(
    caller,
    'place_customer_order',
    {
      p_branch_id: body.branchId,
      p_order_type: body.orderType,
      p_items: body.items,
      p_address_id: body.addressId ?? null,
      p_coupon_code: body.couponCode ?? null,
      p_notes: body.notes ?? null,
      p_loyalty_points: body.loyaltyPoints ?? 0,
      p_idempotency_key: body.idempotencyKey ?? null,
      p_payment_method: body.paymentMethod ?? null,
    },
  );
  mark.place = Date.now() - t0;
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
      // Already in flight since before place_customer_order — usually resolved.
      const cfg = await cfgPromise;
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
    mark.sync = Date.now() - t0;
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
  // client sees the branch (POS) number if it arrived in time. Read as the
  // CALLER, never as the service role — the column list is customer-safe but the
  // ROW is scoped by RLS, and reading it with the service-role identity would
  // hand any authenticated caller any order whose id it could name.
  const { data: fresh } = await restSelectMaybeSingle<Record<string, unknown>>(
    caller,
    'orders',
    ORDER_SELECT,
    { id: `eq.${orderId}` },
  );
  mark.reread = Date.now() - t0;

  // THE ORDER EXISTS. place_customer_order committed it and returned its id —
  // that is what `orderId` above was derived from, and the request would already
  // have returned 400 if it had not. So a re-read that yields no usable row is a
  // REPORTING failure, never an order failure, and the response must not imply
  // otherwise.
  //
  // It used to. The error was discarded and `fresh` returned as-is, so a failed
  // re-read answered HTTP 200 with {"order": null} — and `placeAndSync` in
  // apps/mobile/src/services/api.ts throws 'Order was not created.' on exactly
  // that, which the app renders as "Something went wrong." A customer was told
  // their order had failed while it sat in the database, and could reasonably
  // place it again. Only the stable cart idempotency key made that survivable,
  // and only until they edited the cart.
  //
  // `isRow` rather than `fresh ?? order`, and the difference is not pedantic: a
  // 404 carrying an ARRAY body — reachable through the `order_items(...)` embed
  // this very select uses — comes back as `[]`, which is TRUTHY. `??` would keep
  // it, the client's `!res.order` guard would pass it through, and `order.id`
  // would be undefined. That is worse than the bug being fixed. See the note on
  // isRow in _shared/rest.ts for all six shapes.
  //
  // Falling back costs only the `order_items` embed and the POS fields the sync
  // may just have written: place_customer_order's projection carries the same 24
  // scalar keys in the same order (migration 20260724200000). A stale POS number
  // simply means the receipt shows it as pending and polls, which is the designed
  // behaviour for an order that has not synced yet.
  //
  // This is the house pattern for a post-write read-back — payment-webhook,
  // tapVerify and moyasarVerify all degrade to the write's own return — and it is
  // stricter than all three, which use `??`.
  const rereadUsable = isRow(fresh);
  const responseOrder = rereadUsable ? fresh : order;

  // One line, numbers only. config/place are concurrent, so `config` may be
  // larger than `place` without either having waited on the other.
  console.log(JSON.stringify({
    at: 'order-intake.timing',
    isolate_age_ms: t0 - MODULE_LOADED_AT,
    entry_ms: mark.entry ?? null,
    parse_ms: mark.parse ?? null,
    config_ms: mark.config ?? null,
    place_ms: mark.place ?? null,
    sync_ms: mark.sync ?? null,
    reread_ms: mark.reread ?? null,
    sync_span_ms: mark.sync != null && mark.place != null ? mark.sync - mark.place : null,
    reread_span_ms: mark.reread != null && mark.sync != null ? mark.reread - mark.sync : null,
    body_read_ms: mark.parse != null && mark.entry != null ? mark.parse - mark.entry : null,
    // Whether the re-read produced a usable row, so a silent fallback is visible
    // in production instead of only in a customer's confusion. A BOOLEAN derived
    // from the shape — never the error message, which PostgREST can populate with
    // echoed values, and never anything off the row itself.
    reread_ok: rereadUsable,
    total_ms: Date.now() - t0,
  }));
  return json({ order: responseOrder });
});
