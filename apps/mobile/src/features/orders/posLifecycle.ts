/**
 * Customer-facing Lazywait POS confirmation lifecycle (PURE, framework-free).
 *
 * A customer is NEVER told the restaurant confirmed their order unless Lazywait
 * POS actually returned a usable order reference. This maps the authoritative
 * technical sync state (+ a couple of timestamps) to ONE of five customer
 * lifecycle phases. The screens translate the returned key into the exact
 * localized message; this module holds no copy and no React so it is unit-tested
 * under Vitest/Node like the other pure order helpers.
 *
 * POS sync is pickup-only (delivery Create Order is unconfirmed and never sent),
 * so delivery / pre-integration / not-yet-paid orders return null — the UI shows
 * no POS confirmation line for them.
 */
export type CustomerPosLifecycle =
  | 'submitting_to_restaurant'    // A — first submission in progress, no failure yet
  | 'retrying_pos_sync'           // C — a safe failure occurred; auto-retrying
  | 'confirmed_by_restaurant'     // B — POS returned a usable order_ref
  | 'pos_confirmation_required'   // D — ambiguous outcome; human verification
  | 'pos_sync_failed';            // E — final known failure, never confirmed

export interface PosLifecycleInput {
  orderType: string | null | undefined;
  /** orders.lazywait_sync_state — the authoritative technical state. */
  syncState: string | null | undefined;
  /** orders.lazywait_ref — the POS order reference; REQUIRED to say "confirmed". */
  ref?: unknown;
  /** orders.first_pos_sync_failure_at — set the first time a send did not confirm. */
  firstFailureAt?: string | null;
  /** orders.sync_next_attempt_at — a future value means a retry is still queued. */
  nextAttemptAt?: string | null;
}

/**
 * A Lazywait order_ref is "usable" only when it is a trimmed, non-empty string.
 * Anything else (non-string, null, empty, whitespace-only) is treated as ABSENT
 * — a customer must never be told the restaurant confirmed the order without one.
 */
export function hasUsablePosRef(ref: unknown): boolean {
  return typeof ref === 'string' && ref.trim().length > 0;
}

export function deriveCustomerPosLifecycle(o: PosLifecycleInput): CustomerPosLifecycle | null {
  // POS Create Order is confirmed for pickup only; nothing is ever sent for
  // delivery, so there is no confirmation lifecycle to show.
  if (o.orderType !== 'pickup') return null;

  switch (o.syncState) {
    case 'synced':
      // CORE INVARIANT: "confirmed by the restaurant" requires a usable POS ref.
      // A 'synced' row without one is an inconsistent DB state and confirmation
      // cannot be proven — fall back to the safe "verifying" phase (NOT a final
      // failure, since we are not certain the order was never created).
      return hasUsablePosRef(o.ref) ? 'confirmed_by_restaurant' : 'pos_confirmation_required';
    case 'confirmation_required':
      return 'pos_confirmation_required';
    case 'dead_letter':
    case 'blocked':
      // dead_letter = budget/attempts exhausted (proven not created);
      // blocked = definitively rejected (bad auth/license/mapping). Both are
      // known non-deliveries — never "confirmed".
      return 'pos_sync_failed';
    case 'failed':
      // A safe (429/proven-not-sent) failure: still retrying while a next
      // attempt is queued; otherwise the budget is spent -> final failure.
      return o.nextAttemptAt ? 'retrying_pos_sync' : 'pos_sync_failed';
    case 'pending':
    case 'syncing':
      // Before the first failure this is the initial submission; after it, the
      // customer is in the automatic-retry window.
      return o.firstFailureAt ? 'retrying_pos_sync' : 'submitting_to_restaurant';
    // 'awaiting_payment' (not paid yet) and 'skipped' (pre-integration) and any
    // unknown value: show no POS confirmation line.
    default:
      return null;
  }
}

/** Visual tone for the lifecycle banner/chip (mapped to theme colors by the UI). */
export type PosLifecycleTone = 'info' | 'success' | 'warning' | 'danger';

export interface PosLifecyclePresentation {
  /** Short label i18n key (chip / My Orders). */
  labelKey: 'pos_lc_submitting' | 'pos_lc_retrying' | 'pos_lc_confirmed' | 'pos_lc_verify' | 'pos_lc_failed';
  /** Full message i18n key (receipt banner). */
  bodyKey: 'pos_lc_submitting_body' | 'pos_lc_retrying_body' | 'pos_lc_confirmed_body' | 'pos_lc_verify_body' | 'pos_lc_failed_body';
  tone: PosLifecycleTone;
}

const PRESENTATION: Record<CustomerPosLifecycle, PosLifecyclePresentation> = {
  submitting_to_restaurant:  { labelKey: 'pos_lc_submitting', bodyKey: 'pos_lc_submitting_body', tone: 'info' },
  retrying_pos_sync:         { labelKey: 'pos_lc_retrying',   bodyKey: 'pos_lc_retrying_body',   tone: 'warning' },
  confirmed_by_restaurant:   { labelKey: 'pos_lc_confirmed',  bodyKey: 'pos_lc_confirmed_body',  tone: 'success' },
  pos_confirmation_required: { labelKey: 'pos_lc_verify',     bodyKey: 'pos_lc_verify_body',     tone: 'warning' },
  pos_sync_failed:           { labelKey: 'pos_lc_failed',     bodyKey: 'pos_lc_failed_body',     tone: 'danger' },
};

export function posLifecyclePresentation(lc: CustomerPosLifecycle): PosLifecyclePresentation {
  return PRESENTATION[lc];
}
