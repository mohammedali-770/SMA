/**
 * The Moyasar webhook-verification code, for as long as it can still be used.
 *
 * When a webhook is registered in the Moyasar dashboard, Moyasar may POST one
 * `webhook_verification` event carrying a six-digit code. It is sent once and
 * never retried, it has to be entered back in Moyasar → Settings → Webhooks
 * within 30 minutes, and Moyasar delivers no payment events to the webhook
 * until it is. payment-webhook records the event in `integration_sync_logs`
 * (request `{type: 'webhook_verification', webhook_id}`, response
 * `{verification_code}`) so the console can show the code to the operator.
 *
 * Pure + framework-free so it's unit-tested directly.
 */

/** Moyasar accepts the code for 30 minutes after it is sent. */
export const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;

export interface WebhookVerificationRow {
  created_at: string;
  verification_code: string | null;
}

export interface WebhookVerificationNotice {
  code: string;
  /** When the code arrived (the row's `created_at`). */
  receivedAt: string;
  /** When Moyasar stops accepting it. */
  expiresAtMs: number;
}

/**
 * The notice to show, or null when there is nothing worth showing: no row, a
 * value that is not a six-digit code, an unreadable time, or a window that has
 * closed. A stale code only misleads, since Moyasar refuses it.
 */
export function webhookVerificationNotice(
  row: WebhookVerificationRow | null | undefined,
  nowMs: number,
): WebhookVerificationNotice | null {
  if (!row) return null;
  const code = String(row.verification_code ?? '').trim();
  if (!/^\d{6}$/.test(code)) return null;
  const receivedMs = Date.parse(row.created_at);
  if (Number.isNaN(receivedMs)) return null;
  const expiresAtMs = receivedMs + VERIFICATION_WINDOW_MS;
  if (nowMs >= expiresAtMs) return null;
  return { code, receivedAt: row.created_at, expiresAtMs };
}
