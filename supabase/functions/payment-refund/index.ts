import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { resolveTapConfig, timingSafeEqual } from '../_shared/tap.ts';
import {
  buildRefundBody, classifyRefundResponse, refundRequestIsValid,
} from '../_shared/tapRefund.ts';

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
const TAP_REFUNDS_URL = 'https://api.tap.company/v2/refunds';
const REFUND_TIMEOUT_MS = 15_000;
/** Bounded per invocation so one run cannot fan out unboundedly against Tap. */
const MAX_PER_RUN = 5;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'disabled', reason: 'payment provider not configured' }, 200);
  }
  if ((cfg.providerName ?? '').toLowerCase() !== 'tap') {
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

    const request = {
      chargeId: String(row.charge_ref ?? ''),
      amount: Number(row.amount),
      currency: String(row.currency ?? 'SAR'),
      reference: String(row.idempotency_key),
      reason: 'order_could_not_be_delivered_to_branch',
    };

    // No captured charge reference recorded → nothing can be refunded through the
    // provider. This is a definitive operational failure needing a human, not a
    // retry loop, so it is finalized as failed and surfaces in the admin feed.
    if (!refundRequestIsValid(request)) {
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
    // break a refund for an older charge.
    const { data: pay } = await admin.from('payment_records')
      .select('mode').eq('order_id', row.order_id).eq('status', 'paid')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const tap = resolveTapConfig(
      cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig,
      ((pay?.mode as 'test' | 'live' | undefined) ?? undefined),
    );
    if (!tap.secretKey) {
      // Cannot authenticate to the provider → release for a later run. Never
      // resolve a money movement we could not even attempt.
      await admin.rpc('finalize_order_refund', {
        p_refund_id: row.refund_id, p_claim_token: claimToken, p_status: 'pending',
        p_provider_ref: null, p_failure_code: null, p_error_safe: null,
      });
      processed.push({ refund: row.refund_id, outcome: 'pending', reason: 'key_unavailable' });
      continue;
    }

    let ok = false; let httpStatus = 0; let body: Record<string, unknown> = {};
    try {
      const res = await fetch(TAP_REFUNDS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tap.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildRefundBody(request)),
        signal: AbortSignal.timeout(REFUND_TIMEOUT_MS),
      });
      ok = res.ok;
      httpStatus = res.status;
      body = await res.json().catch(() => ({}));
    } catch {
      // Timeout / network: the refund MAY have been accepted by Tap. Treat it as
      // pending so the next run reconciles, never as failed or succeeded.
      ok = false; httpStatus = 0; body = {};
    }

    const verdict = classifyRefundResponse(ok, httpStatus, body);
    await admin.rpc('finalize_order_refund', {
      p_refund_id: row.refund_id,
      p_claim_token: claimToken,
      p_status: verdict.outcome === 'succeeded' ? 'succeeded'
              : verdict.outcome === 'failed' ? 'failed' : 'pending',
      p_provider_ref: verdict.providerRef,
      p_failure_code: verdict.failureCode,
      p_error_safe: verdict.errorSafe,
    });

    // Operational trail only — no provider payload, no card data, no full charge id.
    await admin.from('integration_sync_logs').insert({
      provider: 'tap', order_id: row.order_id, direction: 'push',
      status: verdict.outcome === 'succeeded' ? 'success'
            : verdict.outcome === 'failed' ? 'failed' : 'skipped',
      request: { action: 'refund', attempt: row.attempt_count },
      error: verdict.failureCode,
    }).then(() => {}, () => {});

    processed.push({ refund: row.refund_id, outcome: verdict.outcome });
  }

  return json({ status: 'ok', processed: processed.length, results: processed }, 200);
});
