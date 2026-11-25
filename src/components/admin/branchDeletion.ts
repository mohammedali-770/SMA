import type { Branch } from '../../types';
import { BRANCH_CLOSE_LABEL } from '../../lib/branchDeletion';

/**
 * Builds the irreversible-action prompt shown before an admin deletes a branch.
 *
 * The copy names the branch, lists what is deleted WITH it (the cascade set in
 * {@link BRANCH_CASCADE_TABLES}, including the history records), says that
 * stored credentials are left behind in Vault, warns it can't be undone, points
 * order-owning branches at deactivation by the button's real label, and asks the
 * admin to type the branch name to confirm (validated by
 * {@link branchDeletionConfirmed}). Kept pure so the bilingual safety copy is
 * testable without rendering the dashboard.
 *
 * The Arabic is engineering-drafted and has not had a native read
 * (docs/OWNER_ACTIONS.md section 35).
 */
export function branchDeletionConfirmation(branch: Branch, isRTL: boolean): string {
  const branchName = isRTL ? branch.nameAr : branch.nameEn;
  return isRTL
    ? `حذف فرع «${branchName}» نهائياً؟\n\n`
      + 'لا يمكن التراجع عن ذلك. سيُحذف معه كل ما يخصه: ساعات العمل، ومناطق التوصيل، وتوفر المنتجات والإضافات والأحجام، '
      + 'وتعيينات الموظفين، والحملات والخصومات الخاصة بالفرع (مع سجلات استخدامها)، وحملات مضاعفة النقاط الخاصة به، وطلبات التوصيل، '
      + 'وورقة مرجع الفرع (الروابط والأرقام والملاحظات وبيانات الدخول)، '
      + 'وسجلات الأحداث: أحداث إيقاف التوصيل، وأحداث إغلاق التوفر، وسجل من كشف بيانات دخول محفوظة. '
      + 'الأسرار المحفوظة في الخزنة لا تُحذف مع الفرع وتبقى دون جهة ترتبط بها.\n\n'
      + `لا يمكن حذف فرع لديه طلبات سابقة — أوقِف تفعيله (زر «${BRANCH_CLOSE_LABEL.close.ar}») بدلاً من ذلك.\n\n`
      + 'اكتب اسم الفرع للتأكيد.'
    : `Permanently delete the branch “${branchName}”?\n\n`
      + 'This cannot be undone. It also permanently deletes everything that belongs to the branch: '
      + 'its working hours, delivery zone and delivery areas, product, add-on and size availability, '
      + 'staff assignments, branch-scoped discount campaigns (with their redemption records), branch-scoped points campaigns, delivery requests, '
      + 'and its reference sheet (links, numbers, notes and credentials), '
      + 'plus its history records: delivery pause events, availability closure events, '
      + 'and the log of who revealed a stored credential. '
      + 'Credential secrets held in the vault are NOT deleted with it; they stay behind with nothing pointing at them.\n\n'
      + `A branch with existing orders can’t be deleted — deactivate it (the “${BRANCH_CLOSE_LABEL.close.en}” button) instead.\n\n`
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
