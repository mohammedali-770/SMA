/**
 * Branch-deletion guard logic (framework-free, no supabase/React imports).
 *
 * Deleting a branch is destructive. The rule that stays true as tables are
 * added: EVERYTHING that references `branches` cascades, except
 *   - `orders.branch_id`            → ON DELETE RESTRICT (blocks the delete)
 *   - `checkout_sessions.branch_id` → NO ACTION          (blocks the delete)
 *   - `admin_push_outbox.branch_id` → ON DELETE SET NULL (kept, detached)
 * so a branch with order history cannot be deleted and any other branch takes
 * every table in {@link BRANCH_CASCADE_TABLES} with it, audit tables included.
 * Those constraints (plus the admin-only RLS `for all ... using is_admin()`) are
 * the real, non-bypassable guarantees. This module adds UX on top of them: an
 * advisory pre-delete count and a friendly, bilingual "deactivate instead"
 * message so admins never see the raw Postgres FK-violation string.
 *
 * What the foreign keys do NOT cover: `branch_reference_entries` rows point at
 * Supabase Vault secrets, and the only code that deletes such a secret is the
 * entry-delete RPC. Deleting the branch cascades the entries away and leaves
 * their secrets in Vault, unreferenced (audit F-WAD-01-005, which is open: a
 * trigger or a changed key is a migration).
 */

/**
 * The tables whose rows are deleted with a branch, read from the migrations
 * (`references public.branches(id) on delete cascade`). The delete prompt
 * names them; `branchDeletion.test.ts` fails if a migration adds or drops one
 * without this list moving with it.
 */
export const BRANCH_CASCADE_TABLES = [
  'branch_product_availability',
  'branch_delivery_zones',
  'campaigns',
  'staff_branch_assignments',
  'branch_availability_events',
  'branch_delivery_areas',
  'branch_working_hours',
  'branch_delivery_events',
  'branch_modifier_availability',
  'loyalty_multipliers',
  'branch_delivery_requests',
  'branch_reference_entries',
  'branch_reference_reveals',
  'branch_variant_availability',
] as const;

/**
 * The label of the card toggle that deactivates a branch, quoted by both
 * messages that point at it so the words cannot drift from the button.
 */
export const BRANCH_CLOSE_LABEL = {
  close: { en: 'Close Branch Maintenance', ar: 'إغلاق الفرع للصيانة' },
  open: { en: 'Open Branch Operational', ar: 'فتح الفرع للتشغيل' },
} as const;

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
 * Note: the cascade tables ({@link BRANCH_CASCADE_TABLES}) are intentionally NOT
 * counted here — a branch with only those is deletable. That includes three
 * append-only audit tables; the prompt says so rather than this check refusing.
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
 * (`branches.is_active` — the card's "Close Branch Maintenance" button) so the
 * order history is preserved, instead of surfacing the raw FK-violation string.
 */
export function branchDeletionBlockedMessage(isRTL: boolean): string {
  return isRTL
    ? `لا يمكن حذف هذا الفرع لوجود طلبات مرتبطة به. أوقِف تفعيله بدلاً من ذلك (استخدم زر «${BRANCH_CLOSE_LABEL.close.ar}») للحفاظ على سجل الطلبات.`
    : `This branch has existing orders and can’t be deleted. Deactivate it instead (use the “${BRANCH_CLOSE_LABEL.close.en}” button) so its order history stays intact.`;
}
