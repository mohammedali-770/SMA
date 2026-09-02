/** Framework-free validation helpers for customer-editable profile fields. */
export type EmailProblem = 'invalid' | null;
export function normalizeCustomerEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}
export function checkCustomerEmail(raw: string | null | undefined): {
  valid: boolean;
  value: string;
  problem: EmailProblem;
} {
  const value = normalizeCustomerEmail(raw);
  if (!value) return { valid: true, value: '', problem: null };
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
  return { valid, value, problem: valid ? null : 'invalid' };
}
export const profileEditCopy = {
  en: {
    edit: 'Edit profile',
    email: 'Email',
    emailPlaceholder: 'name@example.com',
    phone: 'Mobile number',
    phoneHint: 'Your login number cannot be changed here.',
    save: 'Save changes',
    cancel: 'Cancel',
    saved: 'Profile updated',
    failed: "That didn't save. Please try again.",
    invalidEmail: 'Enter a valid email address',
  },
  ar: {
    edit: 'تعديل الملف الشخصي',
    email: 'البريد الإلكتروني',
    emailPlaceholder: 'name@example.com',
    phone: 'رقم الجوال',
    phoneHint: 'رقم تسجيل الدخول لا يمكن تغييره من هنا.',
    save: 'حفظ التعديلات',
    cancel: 'إلغاء',
    saved: 'تم تحديث الملف الشخصي',
    failed: 'لم يتم الحفظ. حاول مرة أخرى.',
    invalidEmail: 'أدخل بريداً إلكترونياً صحيحاً',
  },
} as const;
