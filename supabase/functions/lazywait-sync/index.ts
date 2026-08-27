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

  let limit = 5;
  try { const b = await req.json(); if (b && typeof b.limit === 'number') limit = b.limit; } catch { /* no body */ }

  // Reap stale 'syncing' claims BEFORE claiming a fresh batch. If a previous run
  // crashed/timed-out after claim_lazywait_sync_batch flipped a row to 'syncing'
  // but before record_lazywait_sync ran, that row is stuck outside the queue
  // predicate. reap_stale_lazywait_syncs recovers rows already carrying a POS
  // ref to 'synced' (never re-POST — Create Order has no idempotency key) and
  // requeues ref-less rows to 'failed' with backoff (or dead-letters at max
  // attempts). Non-fatal: a reaper hiccup must not stop the sync run.
  let reaped: Record<string, unknown> = {
    recovered_synced: 0, requeued: 0, dead_lettered: 0, confirmation_required: 0, deadline_failed: 0,
  };
  const { data: reapData, error: reapErr } = await admin.rpc('reap_stale_lazywait_syncs', {
    p_timeout_minutes: STALE_SYNC_TIMEOUT_MINUTES,
    p_max_attempts: MAX_POS_ATTEMPTS,
  });
  if (reapErr) {
    console.error('reap_stale_lazywait_syncs failed (non-fatal):', safeErr(reapErr.message));
  } else if (reapData && typeof reapData === 'object') {
    reaped = reapData as Record<string, unknown>;
    const n = Number(reaped.recovered_synced ?? 0) + Number(reaped.requeued ?? 0)
      + Number(reaped.dead_lettered ?? 0) + Number(reaped.confirmation_required ?? 0)
      + Number(reaped.deadline_failed ?? 0);
    if (n > 0) console.log('reaped stale lazywait syncing rows:', JSON.stringify(reaped));
  }

  // Claim a batch (flips them to 'syncing').
  const { data: claimed, error: claimErr } =
    await admin.rpc('claim_lazywait_sync_batch', { p_limit: limit });
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
          p_notify_status: order.first_pos_sync_failure_at != null ? 'pos_confirmed' : null,
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
      const { data: branch } = await admin
        .from('branches').select('lazywait_branch_id').eq('id', order.branch_id).maybeSingle();
      const { data: items } = await admin
        .from('order_items').select(ORDER_ITEM_SELECT).eq('order_id', orderId);

      // `ORDER_ITEM_SELECT` is a plain string, so supabase-js cannot parse the
      // select at the type level and infers its GenericStringError fallback.
      // The runtime shape is exactly what `mapOrderItemRows` reads, and that
      // mapping is unit-tested against this select in `lazywait.test.ts`.
      const mappedItems = mapOrderItemRows((items ?? []) as unknown as Array<Record<string, unknown>>);

      // ---- CRM customer link (best-effort, never blocks) -------------------
      // Read the stored link first so a CRM outage does not drop `customer_id`
      // from the ticket; a fresh match supersedes it.
      let crmCustomerId: string | null = null;
      if (order.customer_id) {
        const { data: profile } = await admin
          .from('profiles').select('lazywait_customer_id').eq('id', order.customer_id).maybeSingle();
        crmCustomerId = (profile as { lazywait_customer_id?: string | null } | null)?.lazywait_customer_id ?? null;
      }
      const phone = normalizePhone(order.customer_phone as string | null);
      if (phone && order.customer_id) {
        try {
          const crm = await lazywaitFetch<Array<{ id?: string }>>(lw, {
            method: 'GET', path: '/crm/customers/search', query: { query: phone }, timeoutMs: 8000,
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
        // The ONLY thing that tells the branch this ticket is free. No
        // order-level money is sent and the lines carry menu prices, so
        // without the label a comped ticket looks exactly like a paid one.
        // It is a note, not the `is_paid` contract flag - see CreateOrderInput.
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
          p_notify_status: priorFailureGate ? 'pos_confirmed' : null,
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
          // Only announce "confirmed" if the customer previously saw a failure.
          p_notify_status: priorFailureAt ? 'pos_confirmed' : null,
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

  return json({ status: 'ok', ...summary, reaped }, 200);
});

/** Truncate + strip anything token-shaped from an error string before storing. */
function safeErr(msg: string | null | undefined): string {
  if (!msg) return 'unknown';
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***').slice(0, 500);
}
