/**
 * Branch-deletion guard logic (framework-free, no supabase/React imports).
 *
 * Deleting a branch is destructive: the FK graph CASCADES a branch's delivery
 * zone (`branch_delivery_zones`) and its product-availability rows
 * (`branch_product_availability`), but it is HARD-BLOCKED for any branch that
 * still owns order history:
 *   - `orders.branch_id`            → ON DELETE RESTRICT
 *   - `checkout_sessions.branch_id` → NO ACTION
 * Those constraints (plus the admin-only RLS `for all ... using is_admin()`) are
 * the real, non-bypassable guarantees. This module adds UX on top of them: an
 * advisory pre-delete count and a friendly, bilingual "deactivate instead"
 * message so admins never see the raw Postgres FK-violation string.
 */

/** Postgres SQLSTATE for a foreign-key violation (raised by the RESTRICT/NO
 *  ACTION constraints above when a branch with order history is deleted). */
export const FK_VIOLATION_CODE = '23503';

/** Counts of the FK-protected dependents that block a branch delete. */
export interface BranchDependencyCounts {
  orders: number;
  checkoutSessions: number;
}

/**
 * True when the branch still owns order history that the FK constraints protect,
 * i.e. the delete must be blocked and the admin steered to deactivation instead.
 * Note: cascade-only tables (delivery zones, product availability) are
 * intentionally NOT counted here — they are allowed to be removed with a branch.
 */
export function branchHasBlockingDependencies(counts: BranchDependencyCounts): boolean {
  return counts.orders > 0 || counts.checkoutSessions > 0;
}

/**
 * Thrown (in place of the raw Postgres FK string) when a branch can't be deleted
 * because it still owns orders / checkout sessions. Carries the counts (when
 * known from the advisory pre-check) so callers can explain the block and point
 * to the deactivation path. Extends Error so it flows through the existing
 * `e instanceof Error ? e.message` write-error funnel unchanged.
 */
export class BranchHasDependenciesError extends Error {
  readonly code = 'BRANCH_HAS_DEPENDENCIES';
  readonly counts?: BranchDependencyCounts;
  constructor(counts?: BranchDependencyCounts) {
    super('BRANCH_HAS_DEPENDENCIES');
    this.name = 'BranchHasDependenciesError';
    this.counts = counts;
  }
}

/** Duck-typed read of a Postgres/PostgREST error `code` (no supabase import). */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * True for our typed dependency error OR a raw Postgres FK violation (23503),
 * so the advisory pre-check and the hard FK backstop map to the same friendly
 * message. Unrelated errors (RLS `42501`, network, etc.) are NOT masked.
 */
export function isBranchDependencyError(error: unknown): boolean {
  if (error instanceof BranchHasDependenciesError) return true;
  return errorCode(error) === FK_VIOLATION_CODE;
}

/**
 * Friendly, localized message shown when a branch can't be deleted because it
 * still owns order history. Steers the admin to the deactivation path
 * (`branches.is_active` — the panel's "Close Branch" toggle) so the order
 * history is preserved, instead of surfacing the raw FK-violation string.
 */
export function branchDeletionBlockedMessage(isRTL: boolean): string {
  return isRTL
    ? 'لا يمكن حذف هذا الفرع لوجود طلبات مرتبطة به. أوقِف تفعيله بدلاً من ذلك (استخدم زر «إغلاق الفرع») للحفاظ على سجل الطلبات.'
    : 'This branch has existing orders and can’t be deleted. Deactivate it instead (use the “Close Branch” toggle) so its order history stays intact.';
}
