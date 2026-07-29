import type { Branch } from '../../types';

/**
 * Builds the irreversible-action prompt shown before an admin deletes a branch.
 *
 * The copy names the branch, spells out that the delete also CASCADES the
 * branch's delivery area + product-availability settings, warns it can't be
 * undone, points order-owning branches at deactivation instead, and asks the
 * admin to type the branch name to confirm (validated by
 * {@link branchDeletionConfirmed}). Kept pure so the bilingual safety copy is
 * testable without rendering the dashboard.
 */
export function branchDeletionConfirmation(branch: Branch, isRTL: boolean): string {
  const branchName = isRTL ? branch.nameAr : branch.nameEn;
  return isRTL
    ? `حذف فرع «${branchName}» نهائياً؟\n\n`
      + 'سيؤدي هذا أيضاً إلى حذف منطقة التوصيل وجميع إعدادات توفر المنتجات، ولا يمكن التراجع عنه. '
      + 'لا يمكن حذف فرع لديه طلبات سابقة — أوقِف تفعيله (زر «إغلاق الفرع») بدلاً من ذلك.\n\n'
      + 'اكتب اسم الفرع للتأكيد.'
    : `Permanently delete the branch “${branchName}”?\n\n`
      + 'This also deletes its delivery area and all product-availability settings, and cannot be undone. '
      + 'A branch with existing orders can’t be deleted — deactivate it (the “Close Branch” toggle) instead.\n\n'
      + 'Type the branch name to confirm.';
}

/**
 * Validates the name an admin typed into the delete prompt. Accepts a match
 * against either the English or Arabic branch name, tolerant of surrounding
 * whitespace and latin letter-case; rejects null (cancelled), empty and
 * mismatched input so the destructive delete only proceeds on an exact,
 * deliberate confirmation.
 */
export function branchDeletionConfirmed(branch: Branch, typed: string | null): boolean {
  if (typed == null) return false;
  const norm = (s: string) => s.trim().toLocaleLowerCase();
  const input = norm(typed);
  if (input.length === 0) return false;
  return input === norm(branch.nameEn) || input === norm(branch.nameAr);
}
