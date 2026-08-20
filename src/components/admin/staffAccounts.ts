/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpsAccount, OpsAccountRole } from '../../lib/staffAccountsApi';

/**
 * Pure helpers for the branch / call-centre accounts UI, kept out of the
 * component so they can be tested directly — the same split as
 * `src/components/admin/branchDeletion.ts`.
 *
 * These are convenience checks only. The Edge Function re-validates every one
 * of them server-side, and the database is the real boundary; failing to reject
 * here produces a clear server error, not a privilege escalation.
 */

/** Mirrors MIN_PASSWORD in supabase/functions/staff-accounts/guards.ts. */
export const MIN_OPS_PASSWORD = 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewOpsAccountDraft {
  email: string;
  password: string;
  role: OpsAccountRole;
  branchId: string;
}

/**
 * Returns a human-readable problem with the draft, or null when it is worth
 * sending. Bilingual because this panel renders in whichever language the
 * admin console is set to.
 */
export function validateNewOpsAccount(draft: NewOpsAccountDraft, isRTL: boolean): string | null {
  if (!EMAIL_RE.test(draft.email.trim())) {
    return isRTL ? 'أدخل بريداً إلكترونياً صحيحاً.' : 'Enter a valid email address.';
  }
  if (draft.password.length < MIN_OPS_PASSWORD) {
    return isRTL
      ? `كلمة المرور يجب ألا تقل عن ${MIN_OPS_PASSWORD} حرفاً.`
      : `Password must be at least ${MIN_OPS_PASSWORD} characters.`;
  }
  // A branch account with no branch can sign in and see nothing, which reads as
  // a broken login rather than a misconfiguration. Refuse to create one.
  if (draft.role === 'branch_staff' && !draft.branchId.trim()) {
    return isRTL ? 'اختر الفرع لحساب الفرع.' : 'Select a branch for a branch account.';
  }
  return null;
}

/**
 * Branches that no branch operator is pinned to.
 *
 * Call-centre accounts are deliberately not counted: they are not pinned to a
 * branch and staffing one does not give a branch anyone who can close its
 * items. This is what drives the "branches with no operator account" warning,
 * which in the old system was the most-used thing on the accounts screen.
 */
export function branchesWithoutOperator<T extends { id: string }>(
  branches: T[],
  accounts: Pick<OpsAccount, 'role' | 'branchId'>[],
): T[] {
  const staffed = new Set(
    accounts
      .filter((a) => a.role === 'branch_staff' && a.branchId)
      .map((a) => a.branchId as string),
  );
  return branches.filter((b) => !staffed.has(b.id));
}
