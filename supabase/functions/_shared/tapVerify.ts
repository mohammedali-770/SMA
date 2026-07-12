/**
 * Server-side Tap charge retrieval + validate-and-confirm, shared by the webhook
 * and the customer verify endpoint. A charge is confirmed paid ONLY here, and
 * ONLY when Tap's own Retrieve-Charge response says CAPTURED and every bound
 * field matches the stored attempt. Confirmation goes through the existing
 * service-role confirm_order_payment RPC, which is idempotent on
 * (provider, provider_ref) — so a webhook + a verify + retries can all run and
 * the order is paid, enqueued and rewarded exactly once.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  mapTapStatus, formatTapAmount, sanitizeTapResponse, type TapOutcome,
} from './tap.ts';
import { triggerLazywaitSyncOnce, pushLazywaitOnlinePayment } from './paymentSync.ts';

const TAP_BASE = 'https://api.tap.company/v2/charges';

export interface RetrievedCharge { ok: boolean; status: number; charge: Record<string, unknown>; }

/** GET the charge from Tap using the mode-appropriate secret key (server-to-server). */
export async function retrieveTapCharge(secretKey: string, chargeId: string): Promise<RetrievedCharge> {
  const res = await fetch(`${TAP_BASE}/${encodeURIComponent(chargeId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  const charge = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, charge: charge as Record<string, unknown> };
}

export interface TapAttempt {
  id: string;
  order_id: string;
  provider_ref: string | null;
  reference_transaction: string | null;
  reference_order: string | null;
  amount: number;
  mode: string | null;
  status: string;
}

export interface ConfirmResult {
  outcome: TapOutcome | 'mismatch';
  paid: boolean;
  reason?: string;
}

/**
 * Validate a retrieved charge against the stored attempt and, if it is a clean
 * CAPTURED, confirm the order paid and hand it to the POS. Returns a coarse
 * outcome; never throws. `merchantId` is the configured merchant (checked when
 * Tap returns one).
 */
export async function validateAndConfirmTapCharge(
  admin: SupabaseClient,
  attempt: TapAttempt,
  charge: Record<string, unknown>,
  merchantId: string,
): Promise<ConfirmResult> {
  const { outcome } = mapTapStatus(charge.status);
  const reference = (charge.reference ?? {}) as Record<string, unknown>;
  const merchant = (charge.merchant ?? {}) as Record<string, unknown>;
  const card = (charge.card ?? {}) as Record<string, unknown>;
  const sanitized = sanitizeTapResponse(charge);

  const idMatch = String(charge.id ?? '') === String(attempt.provider_ref ?? '');
  const amountMatch = formatTapAmount(Number(charge.amount ?? -1), 'SAR') === formatTapAmount(Number(attempt.amount), 'SAR');
  const currencyMatch = String(charge.currency ?? '').toUpperCase() === 'SAR';
  const refOrderMatch = String(reference.order ?? '') === String(attempt.reference_order ?? '');
  const refTxnMatch = String(reference.transaction ?? '') === String(attempt.reference_transaction ?? '');
  const modeMatch = Boolean(charge.live_mode) === (attempt.mode === 'live');
  const merchantMatch = !merchant.id || String(merchant.id) === String(merchantId);
  const allMatch = idMatch && amountMatch && currencyMatch && refOrderMatch && refTxnMatch && modeMatch && merchantMatch;

  // Always record that we verified (bounded, sanitized) — never overwrite a paid row.
  const touch = async (patch: Record<string, unknown>) => {
    await admin.from('payment_records').update({ last_verified_at: new Date().toISOString(), raw: sanitized, ...patch })
      .eq('id', attempt.id).neq('status', 'paid').then(() => {}, () => {});
  };

  if (outcome === 'paid' && allMatch) {
    const { data, error } = await admin.rpc('confirm_order_payment', {
      p_order_id: attempt.order_id,
      p_provider: 'tap',
      p_provider_ref: String(charge.id ?? ''),
      p_amount: Number(formatTapAmount(Number(charge.amount ?? 0), 'SAR')),
      p_raw: sanitized,
    });
    if (error) {
      // confirm_order_payment rejects on amount-mismatch etc. Never leak its message.
      await admin.from('integration_sync_logs').insert({
        provider: 'tap', order_id: attempt.order_id, direction: 'webhook', status: 'failed',
        request: { charge_id: String(charge.id ?? '').slice(0, 64) }, error: 'confirm_failed',
      }).then(() => {}, () => {});
      return { outcome: 'failed', paid: false, reason: 'confirm_failed' };
    }
    // Store safe card display fields + verification time on the (now paid) record.
    await admin.from('payment_records').update({
      card_scheme: card.scheme != null ? String(card.scheme) : null,
      card_last_four: card.last_four != null ? String(card.last_four) : null,
      last_verified_at: new Date().toISOString(),
    }).eq('order_id', attempt.order_id).eq('provider', 'tap').eq('provider_ref', String(charge.id ?? ''))
      .then(() => {}, () => {});

    // Paid → create the order in the POS, then attach the online payment. Best-effort.
    await triggerLazywaitSyncOnce(admin);
    const { data: fresh } = await admin.from('orders').select('*').eq('id', attempt.order_id).maybeSingle();
    await pushLazywaitOnlinePayment(admin, (fresh ?? data) as Record<string, unknown> | null, String(charge.id ?? '')).catch(() => {});
    return { outcome: 'paid', paid: true };
  }

  // CAPTURED but a bound field does not match → possible tampering. Never confirm.
  if (outcome === 'paid' && !allMatch) {
    await admin.from('integration_sync_logs').insert({
      provider: 'tap', order_id: attempt.order_id, direction: 'webhook', status: 'failed',
      request: {
        charge_id: String(charge.id ?? '').slice(0, 64),
        mismatch: { idMatch, amountMatch, currencyMatch, refOrderMatch, refTxnMatch, modeMatch, merchantMatch },
      },
      error: 'verification_mismatch',
    }).then(() => {}, () => {});
    await touch({ status: 'failed', failure_code: 'verification_mismatch', failure_message_safe: 'Payment could not be verified.' });
    return { outcome: 'mismatch', paid: false, reason: 'verification_mismatch' };
  }

  // Terminal non-success → mark the attempt failed so a fresh attempt is allowed.
  if (outcome === 'failed' || outcome === 'cancelled' || outcome === 'expired') {
    await touch({ status: 'failed', failure_code: String(charge.status ?? outcome).slice(0, 40), failure_message_safe: null });
    return { outcome, paid: false };
  }

  // INITIATED / UNKNOWN → still pending; keep the attempt open (never paid).
  await touch({});
  return { outcome, paid: false };
}
