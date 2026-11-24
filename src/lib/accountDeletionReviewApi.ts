/**
 * Account-deletion requests held in `manual_review` — the console's side of
 * `public.resolve_account_deletion_request` (F-X11-001).
 *
 * A request enters `manual_review` in three ways (`account-delete-process`): a
 * staff account asked to be deleted (`staff_account_requires_admin`), an active
 * order or payment still blocked it past the SLA (`blocked_*_over_sla`), or it
 * failed persistently (a stage code). While it sits there it counts as in
 * flight, so `enforce_account_deletion_lock` refuses the customer's new unpaid
 * orders, checkout sessions, addresses and push devices. The only exit is the
 * RPC below, and until this module nothing in the tree called it.
 *
 * Reads go through the table's existing `account_deletion_requests_staff_read`
 * policy (`is_staff()`); NO policy or grant was added for this screen. Writes go
 * ONLY through the RPC, which is SECURITY DEFINER and gated on `is_admin()`
 * (role AND AAL2) and writes an admin-only audit row. This module has no other
 * write path and the table has no client write grant, so it cannot bypass it.
 *
 * Only the columns the screen needs are selected. `user_id` and
 * `identity_verified_at` are read solely to mirror the RPC's own retry
 * eligibility and are NOT returned to the caller.
 */
import { supabase } from './supabase';

export type DeletionResolveAction = 'retry' | 'fail';

export interface DeletionReviewRequest {
  id: string;
  requested_at: string;
  /** Server-generated safe code, never PII. Null only for a malformed row. */
  reason: string | null;
  /**
   * Mirrors the RPC's retry guard: the Auth user still exists and the request
   * was identity-verified. When false the server refuses a retry (22023), so the
   * screen does not offer one.
   */
  canRetry: boolean;
}

/** The reason a staff account is held; a retry only re-holds it. */
export const STAFF_HOLD_REASON = 'staff_account_requires_admin';

interface RawRow {
  id: string;
  requested_at: string;
  manual_review_reason: string | null;
  user_id: string | null;
  identity_verified_at: string | null;
}

export const accountDeletionReview = {
  /** Oldest first: the request that has locked an account longest comes first. */
  async list(): Promise<DeletionReviewRequest[]> {
    const { data, error } = await supabase
      .from('account_deletion_requests')
      .select('id, requested_at, manual_review_reason, user_id, identity_verified_at')
      .eq('status', 'manual_review')
      .order('requested_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as RawRow[]).map((r) => ({
      id: r.id,
      requested_at: r.requested_at,
      reason: r.manual_review_reason,
      canRetry: r.user_id !== null && r.identity_verified_at !== null,
    }));
  },

  async resolve(id: string, action: DeletionResolveAction, note: string): Promise<void> {
    const { error } = await supabase.rpc('resolve_account_deletion_request', {
      p_request_id: id,
      p_action: action,
      p_note: note.trim() === '' ? null : note.trim(),
    });
    if (error) throw new Error(error.message);
  },
};
