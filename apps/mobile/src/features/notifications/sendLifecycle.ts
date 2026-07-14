/**
 * Order-status notification SEND LIFECYCLE CONTRACT — a pure, framework-free
 * model of push-dispatch's claim/retry semantics over notification_log
 * (unique(order_id,status) + send_status). The Edge Function is the runtime
 * implementation; this module is the executable specification exercised by
 * sendLifecycle.test.ts, and both MUST encode the same rules:
 *
 *  states: processing → sent | failed | no_targets
 *  - claim: a fresh (order,status) inserts as 'processing'; a concurrent
 *    caller finds the row and backs off (never double-sends).
 *  - 'sent' and 'no_targets' are TERMINAL and idempotent.
 *  - 'failed' means a TOTAL failure (zero devices reached) and may be
 *    reclaimed atomically for a controlled retry (attempt_count++) — but
 *    only up to MAX_SEND_ATTEMPTS; after that the failure is TERMINAL
 *    (exhausted) so a dead provider is never hammered forever.
 *  - PARTIAL sends resolve to 'sent' (with counts + a safe error note) and
 *    are NOT retryable — a device that already received the push can never
 *    receive it again.
 */

export const MAX_SEND_ATTEMPTS = 5;

export type SendStatus = 'processing' | 'sent' | 'failed' | 'no_targets';

export interface SendRecord {
  key: string;               // `${orderId}|${status}` — the unique index
  sendStatus: SendStatus;
  attemptCount: number;
  lastErrorSafe: string | null;
  sent: number;
  failed: number;
  targeted: number;
}

export type ClaimOutcome =
  | { action: 'proceed'; registry: SendRecord[] }        // caller owns the send
  | { action: 'duplicate' }                              // terminal — idempotent no-op
  | { action: 'in_progress' }                            // someone else owns it
  | { action: 'exhausted' };                             // retry budget spent — terminal

/** Attempt to claim (order,status) — mirrors insert-first + bounded reclaim. */
export function claim(registry: SendRecord[], key: string): ClaimOutcome {
  const existing = registry.find((r) => r.key === key);
  if (!existing) {
    return {
      action: 'proceed',
      registry: [...registry, { key, sendStatus: 'processing', attemptCount: 1, lastErrorSafe: null, sent: 0, failed: 0, targeted: 0 }],
    };
  }
  if (existing.sendStatus === 'sent' || existing.sendStatus === 'no_targets') return { action: 'duplicate' };
  if (existing.sendStatus === 'processing') return { action: 'in_progress' };
  // failed → BOUNDED atomic reclaim (exactly one racer can flip
  // failed→processing, and never beyond the attempt budget).
  if (existing.attemptCount >= MAX_SEND_ATTEMPTS) return { action: 'exhausted' };
  return {
    action: 'proceed',
    registry: registry.map((r) =>
      r.key === key ? { ...r, sendStatus: 'processing', attemptCount: r.attemptCount + 1 } : r),
  };
}

/** Resolve a claimed send with the delivery result — mirrors the EF outcome rules. */
export function complete(
  registry: SendRecord[],
  key: string,
  result: { targeted: number; sent: number; failed: number },
): SendRecord[] {
  return registry.map((r) => {
    if (r.key !== key) return r;
    if (result.targeted === 0) {
      return { ...r, sendStatus: 'no_targets', targeted: 0, sent: 0, failed: 0, lastErrorSafe: null };
    }
    const sendStatus: SendStatus = result.sent > 0 ? 'sent' : 'failed';
    const lastErrorSafe =
      sendStatus === 'failed' ? 'total send failure (transient?)'
      : result.failed > 0 ? `partial: ${result.failed}/${result.targeted} failed (not retryable)`
      : null;
    return { ...r, sendStatus, lastErrorSafe, ...result };
  });
}
