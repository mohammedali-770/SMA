import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import {
  buildCreateOrderPayload, classifyCreateOrderResult, computePosNextAttempt, lazywaitFetch,
  mapOrderItemRows, MAX_POS_ATTEMPTS, normalizePhone, ORDER_ITEM_SELECT,
  resolveLazywaitBaseUrl, shouldResendCreateOrder, STALE_SYNC_TIMEOUT_MINUTES,
  timingSafeEqual, type LazywaitConfig,
} from '../_shared/lazywait.ts';

/**
 * lazywait-sync — server-side POS sync worker (invoked by a schedule/cron, NOT
 * by the app). Claims due orders (FOR UPDATE SKIP LOCKED), pushes each to the
 * confirmed Lazywait Create Order endpoint, and records the outcome via the
 * service-role-only record_lazywait_sync RPC.
 *
 * Source of truth stays Supabase/place_order. A Lazywait failure NEVER affects
 * the local order — it is retried with backoff, blocked (config/mapping), or
 * dead-lettered. PICKUP AND DELIVERY are both synced. Delivery was enabled on
 * 2026-08-27 by migration 20260827120000 (which removed the insert-time block)
 * plus worker v6; SM-2026-000059 was the first delivery order the POS accepted.
 *
 * verify_jwt = false (config.toml): server/scheduled caller. Optionally gated by
 * a shared secret in secret_config.sync_trigger_secret (header x-sync-secret).
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'lazywait');
  if (!cfg || !cfg.enabled) return json({ status: 'disabled', reason: 'lazywait not enabled' }, 200);

  // Shared-secret gate for the scheduled/server trigger — fail CLOSED. Because
  // verify_jwt=false makes this function internet-reachable, we REQUIRE a
  // configured secret and a matching x-sync-secret header; without it we refuse
  // rather than run unauthenticated. Configure secret_config.sync_trigger_secret
  // and send it as the x-sync-secret header (see docs/LAZYWAIT_PILOT.md).
  const triggerSecret = String((cfg.secretConfig as Record<string, unknown>).sync_trigger_secret ?? '');
  if (!triggerSecret) {
    return json({ error: 'sync trigger secret not configured' }, 503);
  }
  // Constant-time compare so the shared-secret check is not a timing oracle
  // (same treatment as the webhook HMAC checks). A null header -> '' -> length
  // mismatch -> false -> 401.
  const providedSyncSecret = req.headers.get('x-sync-secret') ?? '';
  if (!timingSafeEqual(providedSyncSecret, triggerSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  // ---- Base URL: FAIL CLOSED, before anything is claimed or sent -----------
  // A missing/blank base_url used to fall back to DEFAULT_BASE_URL — the
  // PRODUCTION POS — which would have started POSTing live customer orders to a
  // host nobody is watching. There is no fallback now. This runs BEFORE the
  // reaper and BEFORE claim_lazywait_sync_batch, so on a blank config no order
  // is claimed, no order changes state, and no HTTP request is attempted; the
  // queue simply waits for the config to be fixed. It is deliberately NOT
  // routed through lazywaitFetch: `status: 0` would be classified as a
  // retryable/ambiguous NETWORK error and would either retry forever or mark
  // real orders confirmation_required over a config typo.
  const resolvedBase = resolveLazywaitBaseUrl((cfg.publicConfig as Record<string, unknown>).base_url);
  if (!resolvedBase.ok) {
    console.error('lazywait-sync refusing to run:', resolvedBase.reason);
    return json({ status: 'blocked', error: resolvedBase.reason }, 500);
  }

  const lw: LazywaitConfig = {
    baseUrl: resolvedBase.baseUrl,
    clientId: String((cfg.publicConfig as Record<string, unknown>).client_id ?? ''),
    apiToken: String((cfg.secretConfig as Record<string, unknown>).api_token ?? ''),
  };
  if (!lw.clientId || !lw.apiToken) {
    return json({ error: 'lazywait config missing client_id or api_token' }, 500);
  }

  // TARGETED mode: order-intake passes the id of the order the customer is
  // waiting on, so the kick syncs THAT order and nothing else. Untargeted
  // (cron, and the post-payment handoff in _shared/paymentSync.ts) is unchanged.
  //
  // Why this exists. The kick used to send `{limit: 5}`, which claims up to five
  // orders OLDEST-FIRST and processes them SERIALLY. The customer's order is the
  // NEWEST, so it was handled LAST of whatever the batch picked up — the
  // customer's checkout blocked while four other people's orders were sent to
  // the POS. Measured on SM-2026-000065 the awaited call took 10.747 s against
  // an 11 s abort: 253 ms of headroom, and on SM-2026-000064 the abort appears
  // to have actually fired.
  let limit = 5;
  let targetOrderId: string | null = null;
  try {
    const b = await req.json();
    if (b && typeof b.limit === 'number') limit = b.limit;
    if (b && typeof b.orderId === 'string' && b.orderId) targetOrderId = b.orderId;
  } catch { /* no body */ }
  const targeted = targetOrderId !== null;

  // Work the customer's response does not depend on, moved off the awaited path
  // in targeted mode. `EdgeRuntime.waitUntil` keeps the isolate alive past the
  // Response; the optional call is the same guarded shape used by
  // account-delete-request/index.ts. On a platform without it, or in a local
  // run, this degrades to awaiting — never to skipping.
  const deferred: Promise<unknown>[] = [];
  const runOffPath = async (work: () => Promise<unknown>): Promise<void> => {
    if (!targeted) { await work(); return; }
    const p = work();
    deferred.push(p);
    const rt = (globalThis as { EdgeRuntime?: { waitUntil(x: Promise<unknown>): void } }).EdgeRuntime;
    if (rt?.waitUntil) { try { rt.waitUntil(p); return; } catch { /* fall through to await */ } }
    await p;
  };

  // Reap stale 'syncing' claims. If a previous run crashed/timed-out after a
  // claim flipped a row to 'syncing' but before record_lazywait_sync ran, that
  // row is stuck outside the queue predicate. reap_stale_lazywait_syncs recovers
  // rows already carrying a POS ref to 'synced' (never re-POST — Create Order
  // has no idempotency key) and requeues ref-less rows to 'failed' with backoff
  // (or dead-letters at max attempts). Non-fatal: a reaper hiccup must not stop
  // the sync run.
  //
  // DEFERRED IN TARGETED MODE, NOT SKIPPED — and the difference matters.
  // Skipping it on the kick path would be ~0.9 s cheaper in exactly the same
  // way, but this RPC has only ONE production caller (here), so the worker's two
  // independent drivers — the once-a-minute cron and this kick — are also its
  // only two reaping drivers. They do NOT share a failure mode:
  // `invoke_lazywait_sync_processor()` returns early without invoking anything
  // when the vault secret `lazywait_sync_project_url` is missing, while the kick
  // builds its URL from SUPABASE_URL and is unaffected. Deleting the redundant
  // driver would mean one missing vault secret stops all reaping, and a cash
  // order stuck in 'syncing' with no ref is invisible to the watchdog too (R1
  // and R7 both require payment_status = 'paid'; R10 covers only
  // 'pending'/'failed'). Deferring buys the identical 0.9 s and keeps both
  // drivers alive.
  //
  // Ordering is safe because everything the reaper decides is time-thresholded
  // (STALE_SYNC_TIMEOUT_MINUTES = 10), not event-driven: nothing it would act on
  // can have become stale during this invocation.
  let reaped: Record<string, unknown> = {
    recovered_synced: 0, requeued: 0, dead_lettered: 0, confirmation_required: 0, deadline_failed: 0,
  };
  await runOffPath(async () => {
    const { data: reapData, error: reapErr } = await admin.rpc('reap_stale_lazywait_syncs', {
      p_timeout_minutes: STALE_SYNC_TIMEOUT_MINUTES,
      p_max_attempts: MAX_POS_ATTEMPTS,
    });
    if (reapErr) {
      console.error('reap_stale_lazywait_syncs failed (non-fatal):', safeErr(reapErr.message));
      return;
    }
    if (reapData && typeof reapData === 'object') {
      reaped = reapData as Record<string, unknown>;
      const n = Number(reaped.recovered_synced ?? 0) + Number(reaped.requeued ?? 0)
        + Number(reaped.dead_lettered ?? 0) + Number(reaped.confirmation_required ?? 0)
        + Number(reaped.deadline_failed ?? 0);
      if (n > 0) console.log('reaped stale lazywait syncing rows:', JSON.stringify(reaped));
    }
  });

  // Claim (flips to 'syncing').
  //
  // TARGETED: claim_lazywait_sync_one takes the customer's order and only that
  // one, so their checkout never waits behind somebody else's. The two RPCs
  // carry BYTE-IDENTICAL predicates apart from the id filter and the ordering,
  // so this widens nothing: the claim still requires 'pending', a due
  // sync_next_attempt_at and an unexpired deadline, and still uses FOR UPDATE
  // SKIP LOCKED, so a cron tick racing this kick cannot double-claim.
  //
  // DO NOT "restore" a ('pending','failed') filter here. The migration that
  // first created these functions used it, but 20260813143000_manual_only_pos_resend
  // narrowed BOTH to 'pending' alone, deliberately, to close the automatic
  // resend path. The live definitions are the narrow ones.
  const { data: claimed, error: claimErr } = targeted
    ? await admin.rpc('claim_lazywait_sync_one', { p_order_id: targetOrderId })
    : await admin.rpc('claim_lazywait_sync_batch', { p_limit: limit });
  if (claimErr) return json({ error: claimErr.message }, 500);
  const orders = (claimed ?? []) as Array<Record<string, unknown>>;

  const summary = {
    claimed: orders.length, synced: 0, retrying: 0,
    confirmation_required: 0, dead_letter: 0, blocked: 0, skipped: 0,
  };

  for (const order of orders) {
    const orderId = String(order.id);
    // Phase marker for THIS attempt: flips true the instant before the request
    // leaves. Read in the catch to tell proven-not-sent from may-have-sent.
    let posAttempted = false;
    try {
      // ---- Duplicate-send guard --------------------------------------------
      // If this order already carries a Lazywait ref, the Create Order already
      // succeeded on a prior run (e.g. the worker crashed after the POS created
      // it but before finalizing, and the reaper hadn't run yet). Create Order
      // has NO idempotency key, so re-POSTing would duplicate the POS ticket.
      // Finalize as 'synced' WITHOUT re-sending.
      if (!shouldResendCreateOrder(order as { lazywait_ref?: string | null })) {
        summary.synced++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'synced',
            sync_last_error: null,
            synced_at: order.synced_at ?? new Date().toISOString(),
          },
          p_log_status: 'skipped',
          p_error: 'already_created_no_resend',
          // If a prior failure was already surfaced, close it with "confirmed".
          // Every success tells the customer, not just one that follows a
          // failure. See the note on dispatchPendingPosSync below.
          p_notify_status: 'pos_confirmed',
        });
        continue;
      }

      // ---- Load branch mapping + items (server-trusted) --------------------
      // The item select carries everything the confirmed Create Order body can
      // use: the bilingual snapshot names, the per-item note, the catalog
      // mappings (item / price / category) and the selected modifiers joined to
      // their `modifiers.lazywait_addon_id`. Before the 2026-08-24 contract this
      // query fetched only name/qty/price/lazywait_item_id, so the add-on and
      // category mappings were unreachable from here at all.
      //
      // Issued CONCURRENTLY, including the profile read below: the three are
      // independent (branch -> branchId, items -> mappedItems, profile -> the
      // CRM fallback) and were costing ~0.69 s serially for no reason. All three
      // run before the pre-send gate, so a rejection still lands on the
      // proven-not-sent path.
      const [{ data: branch }, { data: items }, profileRow] = await Promise.all([
        admin.from('branches').select('lazywait_branch_id').eq('id', order.branch_id).maybeSingle(),
        admin.from('order_items').select(ORDER_ITEM_SELECT).eq('order_id', orderId),
        order.customer_id
          ? admin.from('profiles').select('lazywait_customer_id').eq('id', order.customer_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      // `ORDER_ITEM_SELECT` is a plain string, so supabase-js cannot parse the
      // select at the type level and infers its GenericStringError fallback.
      // The runtime shape is exactly what `mapOrderItemRows` reads, and that
      // mapping is unit-tested against this select in `lazywait.test.ts`.
      const mappedItems = mapOrderItemRows((items ?? []) as unknown as Array<Record<string, unknown>>);

      // ---- CRM customer link (best-effort, never blocks) -------------------
      // Read the stored link first so a CRM outage does not drop `customer_id`
      // from the ticket; a fresh match supersedes it.
      let crmCustomerId: string | null =
        (profileRow?.data as { lazywait_customer_id?: string | null } | null)?.lazywait_customer_id ?? null;
      const phone = normalizePhone(order.customer_phone as string | null);
      if (phone && order.customer_id) {
        try {
          // TIGHT budget on the kick path. This lookup measured 3.47 s on
          // SM-2026-000065 and 3.68 s on -000064 — larger than the POS call
          // itself — and returned nothing both times, because
          // profiles.lazywait_customer_id has never been populated for anybody
          // (0 of 10 rows). Its 8 s ceiling alone exceeded most of
          // order-intake's whole budget, so one slow CRM response could spend
          // the entire window and the customer would get no POS number for an
          // order that synced perfectly.
          //
          // It also sits BEFORE begin_lazywait_create_attempt, so every
          // millisecond it burns is deadline budget spent before the gate
          // re-checks pos_sync_deadline_at — capping it is safety-positive, not
          // just faster. The stored link is still read and used; only the
          // refresh is time-boxed, and the cron path keeps the full 8 s.
          const crm = await lazywaitFetch<Array<{ id?: string }>>(lw, {
            method: 'GET', path: '/crm/customers/search', query: { query: phone },
            timeoutMs: targeted ? CRM_SEARCH_TIMEOUT_MS_TARGETED : 8000,
          });
          const match = Array.isArray(crm.data) ? crm.data[0] : null;
          if (crm.ok && match?.id) {
            crmCustomerId = String(match.id);
            await admin.from('profiles').update({ lazywait_customer_id: match.id }).eq('id', order.customer_id);
          }
        } catch { /* CRM match is optional; ignore */ }
      }

      // ---- Build the confirmed Create Order payload ------------------------
      // `isPaid` is deliberately NOT passed: `is_paid` is a confirmed contract
      // field, but telling a cashier an order needs no cash is a financial
      // signal and payment work is frozen (CLAUDE.md §6). Wiring it is a
      // separate owner decision.
      //
      // Order TOTALS are passed as of 2026-08-27 (Q9). That is a different
      // thing from `is_paid`: it tells the branch what the order is worth, not
      // that it has been settled. Every value is a stored snapshot column,
      // copied verbatim — see the money note in `buildCreateOrderPayload`.
      const built = buildCreateOrderPayload({
        clientId: lw.clientId,
        branchId: (branch as { lazywait_branch_id?: string } | null)?.lazywait_branch_id ?? null,
        orderType: String(order.order_type),
        customerName: String(order.customer_name ?? 'Guest'),
        items: mappedItems,
        orderDetails: (order.notes as string | null) ?? null,
        // What tells the branch, in words, that this ticket is free. The lines
        // carry undiscounted menu prices, so the label is what explains why
        // nobody is paying; the totals sent below corroborate it with
        // `Total 0.00`. It is a note, not the `is_paid` contract flag — see
        // CreateOrderInput.
        isComped: Boolean(order.is_comped),
        customerId: crmCustomerId,
        customerPhone: (order.customer_phone as string | null) ?? null,
        // The destination, for a delivery order. Read from the SNAPSHOT rather
        // than joining `addresses`, because the customer may edit or delete the
        // address after ordering and the ticket must reflect where they asked
        // for it to go. The builder blocks a delivery order whose snapshot
        // yields nothing usable.
        deliveryAddress: (order.address_snapshot as {
          label?: string | null;
          description?: string | null;
          national_short_address?: string | null;
        } | null) ?? null,
        // Straight from the claimed row — `claim_lazywait_sync_batch` returns
        // `SETOF orders`, so these are the authoritative snapshot values and no
        // extra read is needed. Discounts are summed because the contract has
        // ONE `discount` field while we track coupon, loyalty and comp
        // separately; the sum is what came off this order's price.
        money: {
          subtotal: Number(order.subtotal ?? 0),
          discount: Number(order.discount_amount ?? 0)
            + Number(order.loyalty_discount_amount ?? 0)
            + Number(order.comp_discount_amount ?? 0),
          tax: Number(order.vat_amount ?? 0),
          total: Number(order.total ?? 0),
          deliveryFee: Number(order.delivery_fee ?? 0),
        },
      });

      if (!built.ok) {
        summary.blocked++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: { lazywait_sync_state: 'blocked', sync_blocked_reason: built.blockedReason, sync_last_error: built.blockedReason },
          p_log_status: 'skipped',
          p_error: built.blockedReason,
        });
        continue;
      }

      // ---- Fenced pre-send gate (deadline re-check + DURABLE phase marker) --
      // ONE locked service-role RPC, immediately before the POST and AFTER all
      // preparatory work (branch/item load + optional CRM), re-validates the row
      // from authoritative state and — only when the send is allowed — durably
      // commits the phase marker + a unique attempt token in the same statement.
      //   * Finding 1: no Create Order may begin after pos_sync_deadline_at, no
      //     matter how long prep/CRM took (-> 'deadline_expired').
      //   * Finding 2: the marker is DURABLY confirmed (RPC committed) before we
      //     send, so a crash after the POST can never be misread as not-sent.
      // We inspect BOTH data and error; the POST leaves ONLY on 'ready_to_send'.
      const attemptToken = crypto.randomUUID();
      const { data: gate, error: gateErr } = await admin.rpc('begin_lazywait_create_attempt', {
        p_order_id: orderId, p_attempt_token: attemptToken,
      });
      if (gateErr) {
        // The marker was NOT durably confirmed for this attempt -> DO NOT send.
        // Leave the row 'syncing'; the stale reaper is the backstop (marker null
        // -> safe requeue within the deadline; if the RPC actually committed but
        // the reply was lost, marker set -> confirmation_required). Never resend.
        summary.skipped++;
        console.error('begin_lazywait_create_attempt failed (no send):', safeErr(gateErr.message));
        continue;
      }
      const gateStatus = String(gate ?? '');
      let priorFailureGate = (order.first_pos_sync_failure_at as string | null) ?? null;

      // The gate evaluated a freshly LOCKED order row; the claimed `order` object
      // may be stale. For the ref-present branches, read the authoritative
      // first-failure marker so the confirm/verify decision is not based on stale
      // data (do not trust only the claimed object over the gate's newer row).
      if (gateStatus === 'already_synced' || gateStatus === 'ref_present_unverified') {
        const { data: authRow } = await admin
          .from('orders')
          .select('first_pos_sync_failure_at')
          .eq('id', orderId)
          .maybeSingle();
        if (authRow) priorFailureGate = (authRow.first_pos_sync_failure_at as string | null) ?? null;
      }

      if (gateStatus === 'already_synced') {
        // A USABLE ref exists (gate proved it) — Create Order already succeeded.
        // Finalize synced WITHOUT resending; close any prior failure with
        // "confirmed". The producer guard in record_lazywait_sync re-checks
        // synced + usable ref before enqueuing pos_confirmed.
        summary.synced++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: { lazywait_sync_state: 'synced', sync_last_error: null,
            synced_at: order.synced_at ?? new Date().toISOString() },
          p_log_status: 'skipped', p_error: 'already_created_no_resend',
          p_notify_status: 'pos_confirmed',
        });
        continue;
      }
      if (gateStatus === 'ref_present_unverified') {
        // A ref MARKER is stored (or the row is 'synced') but it is NOT usable —
        // Create Order MAY have produced a ticket, so NEVER resend, but we cannot
        // prove confirmation. Route to manual verification: keep the suspicious
        // ref as evidence (omit lazywait_ref from the patch so it is preserved),
        // record confirmation_required, and tell the customer "verifying" — never
        // "confirmed". Not auto-retried (confirmation_required is not claimable).
        summary.confirmation_required++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'confirmation_required',
            first_pos_sync_failure_at: priorFailureGate ?? new Date().toISOString(),
            pos_confirmation_reason: 'missing_ref',
            sync_last_error: 'ref_present_unverified_no_usable_ref',
          },
          p_log_status: 'failed', p_error: 'ref_present_unverified',
          p_notify_status: 'pos_confirmation_required',
        });
        continue;
      }
      if (gateStatus === 'deadline_expired') {
        // Hard 10-minute bound: never POST past the absolute deadline. Final
        // known failure (nothing was sent this attempt).
        summary.dead_letter++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'dead_letter',
            sync_next_attempt_at: null,
            first_pos_sync_failure_at: priorFailureGate ?? new Date().toISOString(),
            sync_last_error: 'pos_sync_deadline_exceeded_before_send',
          },
          p_log_status: 'failed', p_error: 'deadline_expired_pre_send',
          p_notify_status: 'pos_failed',
        });
        continue;
      }
      if (gateStatus !== 'ready_to_send') {
        // 'invalid_state' / 'not_found' / anything unexpected -> DO NOT send.
        // Leave the row for the reaper/next tick; no blind resend, no state churn.
        summary.skipped++;
        console.warn('begin_lazywait_create_attempt not ready (no send):', gateStatus);
        continue;
      }

      // The marker + token are now DURABLY committed. Only from here may the
      // request leave — and if the worker dies past this point, the reaper reads
      // the marker and routes to confirmation_required (never a blind resend).
      posAttempted = true;

      // Defense-in-depth: a final LOCAL clock check the instant before fetch, in
      // case wall-clock crossed the deadline between the RPC and now.
      const deadlineMsGuard = order.pos_sync_deadline_at ? Date.parse(String(order.pos_sync_deadline_at)) : null;
      if (deadlineMsGuard != null && Date.now() >= deadlineMsGuard) {
        summary.dead_letter++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'dead_letter',
            sync_next_attempt_at: null,
            first_pos_sync_failure_at: priorFailureGate ?? new Date().toISOString(),
            sync_last_error: 'pos_sync_deadline_exceeded_local_guard',
          },
          p_log_status: 'failed', p_error: 'deadline_expired_local_guard',
          p_notify_status: 'pos_failed',
        });
        continue;
      }

      const res = await lazywaitFetch<{ success?: boolean; order?: Record<string, unknown> }>(lw, {
        method: 'POST', path: '/pos/orders/create', body: built.payload, timeoutMs: 15000,
      });

      const outcome = classifyCreateOrderResult({ status: res.status, data: res.data, error: res.error });
      const attempt = Number(order.sync_attempt_count ?? 0) + 1;
      const nowIso = new Date().toISOString();
      const priorFailureAt = (order.first_pos_sync_failure_at as string | null) ?? null;
      const trimmedResponse = { success: res.data?.success ?? res.ok, order_ref: outcome.orderRef };
      const reqMeta = { order_items_count: mappedItems.length, branch_id: built.payload.branch_id };

      // ---- OK: a usable order_ref -> the ONLY path that says "confirmed" ----
      if (outcome.kind === 'ok') {
        const ref = outcome.orderRef as string;
        const lwOrder = (res.data?.order ?? {}) as Record<string, unknown>;
        // Persist the ref first (crash-safe: the reaper recovers a ref-bearing
        // 'syncing' row to 'synced' rather than re-POSTing).
        await admin.from('orders').update({
          lazywait_ref: ref,
          lazywait_order_id: lwOrder.order_id != null ? String(lwOrder.order_id) : null,
          lazywait_order_number: lwOrder.order_number != null ? String(lwOrder.order_number) : null,
          lazywait_status: lwOrder.order_status_id != null ? String(lwOrder.order_status_id) : null,
        }).eq('id', orderId);

        summary.synced++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'synced',
            lazywait_ref: ref,
            lazywait_order_id: lwOrder.order_id != null ? String(lwOrder.order_id) : null,
            lazywait_order_number: lwOrder.order_number != null ? String(lwOrder.order_number) : null,
            lazywait_status: lwOrder.order_status_id != null ? String(lwOrder.order_status_id) : null,
            sync_last_error: null,
            synced_at: nowIso,
          },
          p_log_status: 'success',
          p_request: reqMeta,
          p_response: trimmedResponse,
          p_notify_status: 'pos_confirmed',
        });
        continue;
      }

      // ---- SAFE RETRY: explicit not-processed (429). Bounded auto-retry -----
      if (outcome.kind === 'safe_retry') {
        const startedMs = order.pos_sync_started_at ? Date.parse(String(order.pos_sync_started_at)) : Date.now();
        const deadlineMs = order.pos_sync_deadline_at ? Date.parse(String(order.pos_sync_deadline_at)) : null;
        const dec = computePosNextAttempt(startedMs, attempt, deadlineMs);
        if (dec.final) {
          summary.dead_letter++;
          await admin.rpc('record_lazywait_sync', {
            p_order_id: orderId,
            p_patch: {
              lazywait_sync_state: 'dead_letter',
              sync_attempt_count: attempt,
              sync_next_attempt_at: null,
              first_pos_sync_failure_at: priorFailureAt ?? nowIso,
              sync_last_error: safeErr(res.error) || outcome.reason,
            },
            p_log_status: 'failed', p_request: reqMeta, p_response: trimmedResponse,
            p_error: outcome.reason, p_notify_status: 'pos_failed',
          });
        } else {
          summary.retrying++;
          await admin.rpc('record_lazywait_sync', {
            p_order_id: orderId,
            p_patch: {
              lazywait_sync_state: 'failed',
              sync_attempt_count: attempt,
              sync_next_attempt_at: new Date(dec.nextAttemptAtMs as number).toISOString(),
              first_pos_sync_failure_at: priorFailureAt ?? nowIso,
              sync_last_error: safeErr(res.error) || outcome.reason,
            },
            p_log_status: 'failed', p_request: reqMeta, p_response: trimmedResponse,
            p_error: outcome.reason,
            // First safe retryable failure -> "we're retrying" (deduped once).
            p_notify_status: 'pos_retrying',
          });
        }
        continue;
      }

      // ---- AMBIGUOUS: may have been created. Never resend -> verify ---------
      if (outcome.kind === 'ambiguous') {
        summary.confirmation_required++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'confirmation_required',
            sync_attempt_count: attempt,
            sync_next_attempt_at: null,
            first_pos_sync_failure_at: priorFailureAt ?? nowIso,
            pos_confirmation_reason: outcome.confirmationReason ?? 'ambiguous_response',
            sync_last_error: `ambiguous_create_order (${outcome.reason})`,
          },
          p_log_status: 'failed', p_request: reqMeta, p_response: trimmedResponse,
          p_error: outcome.reason, p_notify_status: 'pos_confirmation_required',
        });
        continue;
      }

      // ---- TERMINAL: definitively rejected (auth/license/payload) -----------
      summary.blocked++;
      await admin.rpc('record_lazywait_sync', {
        p_order_id: orderId,
        p_patch: {
          lazywait_sync_state: 'blocked',
          sync_blocked_reason: outcome.reason,
          sync_attempt_count: attempt,
          first_pos_sync_failure_at: priorFailureAt ?? nowIso,
          sync_last_error: safeErr(res.error) || outcome.reason,
        },
        p_log_status: 'failed', p_error: outcome.reason, p_notify_status: 'pos_failed',
      });
    } catch (e) {
      // Unexpected error. If the request may already have left (marker set),
      // this is AMBIGUOUS -> confirmation_required (never blind-resend).
      // Otherwise it is proven-not-sent -> safe retry within the same budget.
      const attempt = Number(order.sync_attempt_count ?? 0) + 1;
      const nowIso = new Date().toISOString();
      const priorFailureAt = (order.first_pos_sync_failure_at as string | null) ?? null;
      if (posAttempted) {
        summary.confirmation_required++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'confirmation_required',
            sync_attempt_count: attempt,
            sync_next_attempt_at: null,
            first_pos_sync_failure_at: priorFailureAt ?? nowIso,
            pos_confirmation_reason: 'connection',
            sync_last_error: safeErr(e instanceof Error ? e.message : String(e)),
          },
          p_log_status: 'failed', p_error: 'worker_exception_after_send',
          p_notify_status: 'pos_confirmation_required',
        }).then(() => {}, () => {});
      } else {
        const startedMs = order.pos_sync_started_at ? Date.parse(String(order.pos_sync_started_at)) : Date.now();
        const deadlineMs = order.pos_sync_deadline_at ? Date.parse(String(order.pos_sync_deadline_at)) : null;
        const dec = computePosNextAttempt(startedMs, attempt, deadlineMs);
        if (dec.final) summary.dead_letter++; else summary.retrying++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: dec.final ? 'dead_letter' : 'failed',
            sync_attempt_count: attempt,
            sync_next_attempt_at: dec.final ? null : new Date(dec.nextAttemptAtMs as number).toISOString(),
            first_pos_sync_failure_at: priorFailureAt ?? nowIso,
            sync_last_error: safeErr(e instanceof Error ? e.message : String(e)),
          },
          p_log_status: 'failed', p_error: 'worker_exception_before_send',
          p_notify_status: dec.final ? 'pos_failed' : 'pos_retrying',
        }).then(() => {}, () => {});
      }
    }
  }

  // Drain the POS-lifecycle notifications this run (and any earlier one) queued.
  // Rows enqueued moments ago by record_lazywait_sync are already committed, so
  // the fast path — order-intake kicks this worker, an order syncs, its
  // 'pos_confirmed' event goes out — still completes inside this invocation.
  //
  // DEFERRED in targeted mode: push delivery cannot change the POS number the
  // customer's checkout is blocked on, yet it was a THIRD of the awaited time
  // (measured 3.36 s on SM-2026-000065, 5.05 s on -000064) and is what pushed
  // that request to within 253 ms of the 11 s abort. The push still goes out
  // moments later, from the same invocation — the customer is simply no longer
  // waiting on it before their receipt renders.
  //
  // Safe because delivery is at-most-once regardless of who drains:
  // claim_pos_sync_notification flips pending -> processing under a fenced
  // claim, so a deferred drain racing the cron's cannot double-send. And if the
  // isolate is torn down before the claim commits, the row is still 'pending'
  // and the next cron tick takes it — delayed, never dropped.
  let notified: unknown = { found: 0, dispatched: 0 };
  await runOffPath(async () => { notified = await dispatchPendingPosSync(admin); });

  return json({ status: 'ok', ...summary, reaped, notified, targeted }, 200);
});

/**
 * How many queued POS-lifecycle events one run will dispatch. Bounded so a
 * backlog cannot turn a sync tick into an unbounded fan-out; the next tick
 * takes the rest.
 */
const POS_NOTIFY_DRAIN_LIMIT = 20;

/**
 * CRM customer-search budget on the TARGETED (checkout kick) path only.
 *
 * The cron path keeps the original 8 s: nothing is waiting on it there, and a
 * slow CRM should still get its chance to establish the link. On the kick path
 * a customer is watching a spinner, and the lookup is best-effort enrichment —
 * the ticket is complete without it.
 */
const CRM_SEARCH_TIMEOUT_MS_TARGETED = 1500;

/**
 * Send the queued customer messages about what happened at the POS.
 *
 * WHY THIS EXISTS. `record_lazywait_sync` and `reap_stale_lazywait_syncs`
 * enqueue deduplicated `notification_log` rows (kind='pos_sync', send_status
 * 'pending') for the four lifecycle transitions, and `push-dispatch` has a
 * complete `pos_sync` action that renders and sends one. Until 2026-08-27
 * **nothing connected the two**: no cron, no trigger, no caller. Rows would have
 * sat 'pending' for ever.
 *
 * It had never shown, and the reason is worth stating: no sync has ever failed,
 * and `pos_confirmed` used to be gated behind a prior failure — so not one
 * pos_sync row had ever been written. The first genuine POS failure would have
 * been met with silence, exactly when a customer most needs to be told "we are
 * retrying, please do not order again".
 *
 * This worker is the right home. It already runs every minute, it is already the
 * thing that produces most of these events, and `order-intake` already invokes
 * it synchronously on checkout — so the confirmation push rides the same
 * invocation that created it instead of waiting for a tick.
 *
 * SAFETY. This is a pure CONSUMER: it never invents an event, it only forwards
 * rows a producer already committed. `push-dispatch` re-validates every one
 * against the order's CURRENT state (`pos_sync_status_matches`) and marks a
 * stale event 'superseded' rather than sending it, and its fenced claim makes
 * delivery at-most-once under concurrent dispatchers. So a slow or duplicated
 * drain cannot double-send and cannot send something no longer true.
 *
 * Entirely best-effort: a push problem must never affect an order. Every failure
 * is swallowed and the row is simply retried on a later tick.
 */
async function dispatchPendingPosSync(
  admin: ReturnType<typeof adminClient>,
): Promise<{ found: number; dispatched: number }> {
  const out = { found: 0, dispatched: 0 };
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return out;

    // Oldest first: a customer waiting on a failure message should not be
    // overtaken by a fresher confirmation.
    const { data: pending } = await admin
      .from('notification_log')
      .select('order_id, status')
      .eq('kind', 'pos_sync')
      .eq('send_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(POS_NOTIFY_DRAIN_LIMIT);

    const rows = (pending ?? []) as Array<{ order_id: string | null; status: string | null }>;
    out.found = rows.length;

    for (const row of rows) {
      if (!row.order_id || !row.status) continue;
      try {
        const res = await fetch(`${url}/functions/v1/push-dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ action: 'pos_sync', orderId: row.order_id, status: row.status }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) out.dispatched++;
      } catch { /* transient; the row stays 'pending' for the next tick */ }
    }
  } catch (e) {
    console.error('pos_sync drain failed (non-fatal):', safeErr(e instanceof Error ? e.message : String(e)));
  }
  return out;
}

/** Truncate + strip anything token-shaped from an error string before storing. */
function safeErr(msg: string | null | undefined): string {
  if (!msg) return 'unknown';
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***').slice(0, 500);
}
