/**
 * Admin "Retry" (manual Lazywait requeue) eligibility — a PURE mirror of the
 * authoritative SQL predicate `public.lazywait_requeue_eligibility`. The database
 * function is the source of truth (it rejects an ineligible requeue under a row
 * lock); this mirror only lets the dashboard HIDE the Retry action and show a
 * clear internal message, so an admin is never offered a retry that would falsely
 * report success. Keep the two in lock-step.
 *
 * A POS order that has passed its absolute 10-minute deadline (or is otherwise
 * not proven safe to resend) must NOT be requeued into the automatic Create Order
 * pipeline.
 */
export type RequeueEligibility =
  | 'requeued'
  | 'deadline_expired'
  | 'confirmation_required'
  | 'already_synced'
  | 'ref_present_unverified'
  | 'may_have_sent'
  | 'attempt_limit_reached'
  | 'not_retryable';

/** Maximum POS Create Order attempts (matches MAX_POS_ATTEMPTS / the SQL rule). */
export const POS_MAX_ATTEMPTS = 5;

/**
 * USABLE POS ref — a genuinely non-empty reference (JS String.prototype.trim()).
 * Mirrors the SQL `lazywait_pos_ref_is_usable` and the mobile `hasUsablePosRef`.
 * This proves confirmation; it is DIFFERENT from "a ref marker is stored" (any
 * non-null value), which is what blocks an automatic resend below.
 */
export function isUsablePosRef(ref: unknown): boolean {
  return typeof ref === 'string' && ref.trim().length > 0;
}

export interface RequeueRow {
  lazywait_sync_state?: string | null;
  lazywait_ref?: string | null;
  pos_sync_deadline_at?: string | null;
  sync_attempt_count?: number | null;
  pos_create_attempted_at?: string | null;
  order_type?: string | null;
  sync_blocked_reason?: string | null;
}

/**
 * Mirrors `public.lazywait_requeue_eligibility(state, ref, deadline_at,
 * attempt_count, marker_at, order_type, blocked_reason)` exactly. Returns 'requeued' only for a
 * proven-safe failure still inside its original budget.
 */
export function lazywaitRequeueEligibility(row: RequeueRow, now: number = Date.now()): RequeueEligibility {
  const state = row.lazywait_sync_state ?? '';
  // Delivery used to be refused here outright, because it was never sent and so
  // never had anything to retry. It syncs as of 20260827120000, so it retries on
  // the same terms as pickup — every resend rail below applies to it unchanged.
  //
  // The rows blocked under the RETIRED reason are the exception: they were never
  // attempted and are up to a month old, with no deadline to stop them, so a
  // Retry click would print a stale ticket in a live kitchen.
  if (row.sync_blocked_reason === 'delivery_schema_unconfirmed') return 'not_retryable';
  // RESEND SAFETY: ANY stored ref marker (even blank/malformed) blocks an
  // automatic resend — do NOT trim here. A USABLE ref proves creation
  // (already_synced); a merely-present marker (or 'synced' without a usable ref)
  // needs manual verification (ref_present_unverified). Mirrors the SQL rule.
  if (isUsablePosRef(row.lazywait_ref)) return 'already_synced';
  if (row.lazywait_ref != null) return 'ref_present_unverified';
  if (state === 'synced') return 'ref_present_unverified';
  if (state === 'confirmation_required') return 'confirmation_required';
  if (row.pos_create_attempted_at != null) return 'may_have_sent';
  if (!['failed', 'blocked', 'dead_letter', 'skipped'].includes(state)) return 'not_retryable';
  if ((row.sync_attempt_count ?? 0) >= POS_MAX_ATTEMPTS) return 'attempt_limit_reached';
  if (row.pos_sync_deadline_at != null && now >= Date.parse(row.pos_sync_deadline_at)) return 'deadline_expired';
  return 'requeued';
}

/** Short internal (admin-facing) message for an ineligible requeue; null when requeuable. */
export function requeueEligibilityMessage(e: RequeueEligibility): string | null {
  switch (e) {
    case 'requeued': return null;
    case 'deadline_expired': return 'Automatic POS retry window has expired. Verify the order manually.';
    case 'confirmation_required': return 'Needs manual verification; automatic retry is disabled.';
    case 'already_synced': return 'Already has a usable POS reference / synced; never resend.';
    case 'ref_present_unverified': return 'An existing POS reference marker requires manual verification; automatic resend is disabled.';
    case 'may_have_sent': return 'Create Order may already have been sent; verify manually.';
    case 'attempt_limit_reached': return 'Maximum POS retry attempts reached. Verify manually.';
    case 'not_retryable': return 'Not in a safe, retryable state.';
  }
}
