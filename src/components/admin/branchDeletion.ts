import type { Branch } from '../../types';

/**
 * Builds the irreversible-action prompt shown before an admin deletes a branch.
 * Kept pure so the bilingual safety copy can be tested without rendering the dashboard.
 */
export function branchDeletionConfirmation(branch: Branch, isRTL: boolean): string {
  const branchName = isRTL ? branch.nameAr : branch.nameEn;
  return isRTL
    ? `هل أنت متأكد من حذف فرع «${branchName}» نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`
    : `Permanently delete “${branchName}”? This action cannot be undone.`;
}
