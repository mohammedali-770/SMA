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
  | 'may_have_sent'
  | 'attempt_limit_reached'
  | 'not_retryable';

/** Maximum POS Create Order attempts (matches MAX_POS_ATTEMPTS / the SQL rule). */
export const POS_MAX_ATTEMPTS = 5;

export interface RequeueRow {
  lazywait_sync_state?: string | null;
  lazywait_ref?: string | null;
  pos_sync_deadline_at?: string | null;
  sync_attempt_count?: number | null;
  pos_create_attempted_at?: string | null;
  order_type?: string | null;
}

/**
 * Mirrors `public.lazywait_requeue_eligibility(state, ref, deadline_at,
 * attempt_count, marker_at, order_type)` exactly. Returns 'requeued' only for a
 * proven-safe failure still inside its original budget.
 */
export function lazywaitRequeueEligibility(row: RequeueRow, now: number = Date.now()): RequeueEligibility {
  const state = row.lazywait_sync_state ?? '';
  const ref = typeof row.lazywait_ref === 'string' ? row.lazywait_ref.trim() : '';
  if (row.order_type === 'delivery') return 'not_retryable';
  if (ref !== '' || state === 'synced') return 'already_synced';
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
    case 'already_synced': return 'Already has a POS reference / synced; never resend.';
    case 'may_have_sent': return 'Create Order may already have been sent; verify manually.';
    case 'attempt_limit_reached': return 'Maximum POS retry attempts reached. Verify manually.';
    case 'not_retryable': return 'Not in a safe, retryable state.';
  }
}
