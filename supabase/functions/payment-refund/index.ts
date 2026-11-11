import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { basicAuthHeader, resolveMoyasarConfig, timingSafeEqual, toMinorUnits } from '../_shared/moyasar.ts';
import {
  buildMoyasarRefundBody, classifyMoyasarRefundResponse, decideAfterReconcile, decideRefundLogging,
  moyasarPaymentUrl, moyasarRefundUrl, mustReconcileBeforePost, needsHumanReview, refundFinalStatus,
  refundRequestIsValid, resolveRefundFromPayment, type RefundClassification,
} from '../_shared/moyasarRefund.ts';

/**
 * payment-refund — the automatic refund worker for orders that were PAID but
 * provably never reached the branch (Issue #94, step 7).
 *
 * It is a pure CONSUMER: it never decides that a refund is owed. Enrollment is
 * done in Postgres by the order_refund_due() predicate + trigger, which fires
 * only for a paid order with NO stored POS reference, NO may-have-been-sent
 * marker, in a proven-not-sent terminal state, whose customer resend budget is
 * spent. That is what makes "never refund an order Lazywait actually accepted"
 * true: an ambiguous order is never enrolled and goes to human verification.
 *
 * Concurrency + idempotency:
 *   * claim_order_refund() leases ONE pending refund with FOR UPDATE SKIP LOCKED,
 *     so parallel invocations can never work the same refund.
 *   * The lease carries a token; finalize_order_refund() is token-fenced, so a
 *     slow worker whose lease was taken over cannot overwrite the new outcome.
 *   * The refund row's idempotency key is deterministic per order and unique, and
 *     a partial unique index allows at most one live-or-succeeded refund per
 *     order — a customer can never be refunded twice.
 *   * A 'pending' classification RELEASES the claim for a later attempt rather
 *     than resolving it, so an unknown/timeout outcome is retried, never guessed.
 *
 * verify_jwt = false (config.toml): the caller is a scheduler/server, gated by
 * the same shared-secret pattern as lazywait-sync and failing CLOSED.
 */
const REFUND_TIMEOUT_MS = 15_000;
/** Bounded per invocation so one run cannot fan out unboundedly against Moyasar. */
const MAX_PER_RUN = 5;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'disabled', reason: 'payment provider not configured' }, 200);
  }
  const configuredProvider = (cfg.providerName ?? '').toLowerCase();
  if (configuredProvider !== 'moyasar') {
    return json({ status: 'ignored', reason: `provider is '${cfg.providerName}'` }, 200);
  }

  // Shared-secret gate — REQUIRED and constant-time, matching lazywait-sync. This
  // function moves money, so it refuses to run rather than run unauthenticated.
  const triggerSecret = String((cfg.secretConfig as Record<string, unknown>).refund_trigger_secret ?? '');
  if (!triggerSecret) return json({ error: 'refund trigger secret not configured' }, 503);
  if (!timingSafeEqual(req.headers.get('x-refund-secret') ?? '', triggerSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let limit = MAX_PER_RUN;
  try {
    const b = await req.json();
    if (b && typeof b.limit === 'number') limit = Math.max(1, Math.min(MAX_PER_RUN, b.limit));
  } catch { /* no body — use the default */ }

  const processed: Array<Record<string, unknown>> = [];

  for (let i = 0; i < limit; i++) {
    // A fresh token per attempt: the lease we finalize is provably the one we took.
    const claimToken = crypto.randomUUID();
    const { data: claimed, error: claimErr } = await admin.rpc('claim_order_refund', {
      p_claim_token: claimToken,
    });
    if (claimErr) {
      console.error('claim_order_refund failed', String(claimErr.message ?? '').slice(0, 200));
      break;
    }
    const row = (Array.isArray(claimed) ? claimed[0] : claimed) as {
      refund_id: string; order_id: string; provider: string; charge_ref: string | null;
      idempotency_key: string; amount: number; currency: string; attempt_count: number;
    } | undefined;
    if (!row) break; // queue drained

    // ONLY A MOYASAR REFUND CAN BE EXECUTED HERE. order_refunds.provider records
    // which gateway actually took the money, and Moyasar is the only gateway
    // this code can talk to. A row naming any other provider (order_refunds held
    // no rows at all when Tap was removed on 2026-11-11) can never be refunded by
    // this worker, so it is FINALIZED rather than released. Releasing it as
    // 'pending' would re-claim and release it on every run, for ever, where
    // nobody would see it; 'failed' frees the one-live-refund slot and puts it in
    // front of a person via list_failed_order_refunds(). Nothing is sent to
    // Moyasar for it: a foreign charge id there would 404, which
    // classifyMoyasarRefundResponse treats as definitive anyway.
    const rowProvider = String(row.provider ?? '').toLowerCase();
    if (rowProvider !== 'moyasar') {
      console.warn('refund queued for an unsupported provider; parked for review', JSON.stringify({
        refund: String(row.refund_id).slice(0, 36), row_provider: rowProvider || 'unknown',
      }));
      await admin.rpc('finalize_order_refund', {
        p_refund_id: row.refund_id, p_claim_token: claimToken, p_status: 'failed',
        p_provider_ref: null, p_failure_code: 'unsupported_provider',
        p_error_safe: 'Queued for a payment provider that is no longer supported. Refund it manually.',
      });
      processed.push({ refund: row.refund_id, outcome: 'failed', reason: 'unsupported_provider' });
      continue;
    }

    // Moyasar refunds POST to /payments/:id/refund, so the provider reference we
    // need IS the payment id — which is exactly what provider_ref holds for a
    // confirmed Moyasar attempt and therefore what order_refunds.charge_ref was
    // populated from. Same field, same meaning, no translation.
    const moyasarRequest = {
      paymentId: String(row.charge_ref ?? ''),
      amount: Number(row.amount),
      currency: String(row.currency ?? 'SAR'),
    };

    // No captured payment reference recorded → nothing can be refunded through
    // the provider. This is a definitive operational failure needing a human,
    // not a retry loop, so it is finalized as failed and surfaces in the admin
    // feed. (This, the provider check above and the key-unavailable path below
    // finalize IMMEDIATELY after the claim with no external call in between, so
    // there is no window in which the lease could have been lost — unlike the
    // provider path further down.)
    if (!refundRequestIsValid(moyasarRequest)) {
      await admin.rpc('finalize_order_refund', {
        p_refund_id: row.refund_id, p_claim_token: claimToken, p_status: 'failed',
        p_provider_ref: null, p_failure_code: 'missing_charge_reference',
        p_error_safe: 'No captured payment reference is recorded for this order.',
      });
      processed.push({ refund: row.refund_id, outcome: 'failed', reason: 'missing_charge_reference' });
      continue;
    }

    // The secret key is chosen by the ATTEMPT's stored mode via the payment
    // record, mirroring payment-verify: flipping Admin test↔live must never
    // break a refund for an older payment.
    const { data: pay } = await admin.from('payment_records')
      .select('mode').eq('order_id', row.order_id).eq('provider', 'moyasar').eq('status', 'paid')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const attemptMode = (pay?.mode as 'test' | 'live' | undefined) ?? undefined;

    // Gate on `.ok`, not on `.secretKey`. resolveMoyasarConfig() reads the key
    // slot before it decides, so `.secretKey` can be non-empty for a key filed
    // under the wrong mode or a payment row missing its webhook secret. A refund
    // moves money, so it is attempted only on a configuration that resolves
    // cleanly, and released untouched for a later run otherwise.
    const resolved = resolveMoyasarConfig(
      cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig, attemptMode,
    );
    const secretKey = resolved.ok ? resolved.secretKey : '';
    if (!secretKey) {
      // Cannot authenticate to Moyasar for this refund → release for a later run.
      // Never resolve a money movement we could not even attempt.
      await admin.rpc('finalize_order_refund', {
        p_refund_id: row.refund_id, p_claim_token: claimToken, p_status: 'pending',
        p_provider_ref: null, p_failure_code: null, p_error_safe: null,
      });
      processed.push({ refund: row.refund_id, outcome: 'pending', reason: 'key_unavailable' });
      continue;
    }

    let verdict: RefundClassification;

    const expectedMinor = toMinorUnits(moyasarRequest.amount, moyasarRequest.currency);

    /**
     * Ask Moyasar what actually happened to this refund, without sending one.
     * GET /v1/payments/:id carries `status`, the cumulative `refunded` amount
     * and `refunded_at`; resolveRefundFromPayment reads exactly those.
     * Returns null when the lookup itself could not be completed — which is
     * NOT the same as "nothing was refunded" and must never be treated as
     * permission to POST.
     */
    const reconcile = async (): Promise<RefundClassification | null> => {
      try {
        const lookup = await fetch(moyasarPaymentUrl(moyasarRequest.paymentId), {
          method: 'GET',
          headers: { Authorization: basicAuthHeader(secretKey), 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(REFUND_TIMEOUT_MS),
        });
        if (!lookup.ok) return null;
        const payment = await lookup.json().catch(() => ({})) as Record<string, unknown>;
        return resolveRefundFromPayment(payment, expectedMinor);
      } catch {
        return null;
      }
    };

    // ---------------------------------------------------------------------
    // RECONCILE BEFORE RE-POSTING. This ordering is the whole safety property.
    //
    // Moyasar documents no idempotency on POST /v1/payments/:id/refund, so a
    // second POST for the same refund is a second movement of money. A run
    // that timed out, or whose response was ambiguous, releases the row as
    // 'pending' — and the next run claims it. If that run POSTed first it
    // would double-refund exactly the customer whose first attempt actually
    // succeeded but reported badly.
    //
    // claim_order_refund increments attempt_count BEFORE returning it, so the
    // first ever attempt arrives as 1 and anything greater means this refund
    // has been sent to Moyasar at least once already. On those runs we ask
    // before we act, and POST only when Moyasar positively reports that
    // nothing has been refunded.
    // ---------------------------------------------------------------------
    let settledWithoutPosting: RefundClassification | null = null;
    if (mustReconcileBeforePost(row.attempt_count)) {
      const decision = decideAfterReconcile(await reconcile());
      if (decision.action === 'release') {
        // We could not establish what the earlier attempt did. Sending another
        // refund now is the one action that could pay the customer twice, so
        // release the row untouched and let a later run ask again.
        await admin.rpc('finalize_order_refund', {
          p_refund_id: row.refund_id, p_claim_token: claimToken, p_status: 'pending',
          p_provider_ref: null, p_failure_code: null, p_error_safe: null,
        });
        processed.push({ refund: row.refund_id, outcome: 'pending', reason: decision.reason });
        continue;
      }
      // 'settle' means already refunded, definitively failed, or
      // unreconcilable — all three are answers, and none of them is
      // "send it again". 'post' means Moyasar positively reports nothing
      // refunded, so the earlier attempt did not land.
      if (decision.action === 'settle') settledWithoutPosting = decision.verdict;
    }

    if (settledWithoutPosting) {
      verdict = settledWithoutPosting;
    } else {
      let ok = false; let httpStatus = 0; let body: Record<string, unknown> = {};
      try {
        const res = await fetch(moyasarRefundUrl(moyasarRequest.paymentId), {
          method: 'POST',
          headers: {
            Authorization: basicAuthHeader(secretKey),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildMoyasarRefundBody(moyasarRequest)),
          signal: AbortSignal.timeout(REFUND_TIMEOUT_MS),
        });
        ok = res.ok;
        httpStatus = res.status;
        body = await res.json().catch(() => ({}));
      } catch {
        // Timeout / network: the refund MAY have been accepted. Treat it as
        // ambiguous, never as failed or succeeded.
        ok = false; httpStatus = 0; body = {};
      }

      verdict = classifyMoyasarRefundResponse(ok, httpStatus, body);

      // An ambiguous response is resolved immediately where we can, which
      // often settles it in this same run. When it cannot be resolved the row
      // stays 'pending' and the guard above re-asks before the next POST.
      if (verdict.outcome === 'pending') {
        const resolvedNow = await reconcile();
        if (resolvedNow) verdict = resolvedNow;
      }
    }

    if (needsHumanReview(verdict)) {
      // Moyasar reports a refund timestamp but no amount we can reconcile
      // against. Retrying is the one action that could double-refund, and
      // releasing as 'pending' would just loop — so refundFinalStatus() below
      // writes 'failed' with this code, which frees the one-live-refund slot
      // and puts the row in front of a person via list_failed_order_refunds().
      console.warn('moyasar refund unresolvable; parked for review', JSON.stringify({
        refund: String(row.refund_id).slice(0, 36),
      }));
    }
    const { data: finalized } = await admin.rpc('finalize_order_refund', {
      p_refund_id: row.refund_id,
      p_claim_token: claimToken,
      p_status: refundFinalStatus(verdict),
      p_provider_ref: verdict.providerRef,
      p_failure_code: verdict.failureCode,
      p_error_safe: verdict.errorSafe,
    });

    // Token-fenced: a non-`true` result means this run no longer owns the lease
    // and wrote NOTHING, so it must not persist an outcome record (see
    // decideRefundLogging). A warning is enough — a misleading durable record is
    // not acceptable.
    const decision = decideRefundLogging(finalized, verdict.outcome);
    if (!decision.record) {
      console.warn('refund lease lost; outcome not recorded', JSON.stringify({
        refund: String(row.refund_id).slice(0, 36), outcome: verdict.outcome,
      }));
      processed.push({ refund: row.refund_id, outcome: 'lost_lease' });
      continue;
    }

    // Operational trail only — no provider payload, no card data, no full charge id.
    await admin.from('integration_sync_logs').insert({
      provider: rowProvider, order_id: row.order_id, direction: 'push',
      status: decision.logStatus,
      request: { action: 'refund', attempt: row.attempt_count },
      error: verdict.failureCode,
    }).then(() => {}, () => {});

    processed.push({ refund: row.refund_id, outcome: verdict.outcome });
  }

  return json({ status: 'ok', processed: processed.length, results: processed }, 200);
});
