/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Copy for the branch-operations consoles.
 *
 * This follows the customer app's pattern (`apps/mobile/src/i18n/strings.ts`):
 * one typed table, keys grouped by area, looked up through a function. It does
 * NOT follow the admin console's `isRTL ? '…' : '…'` inline ternaries, which
 * are unreviewable at volume and have already left several admin surfaces
 * English-only.
 *
 * Arabic is written first in each pair because Arabic is the default for these
 * consoles — the people using them work the counter and the phones.
 */
export type OpsLang = 'ar' | 'en';

export const OPS_STRINGS = {
  ar: {
    // shell
    branchConsole: 'لوحة الفرع',
    callCentreConsole: 'لوحة مركز الاتصال',
    signOut: 'تسجيل الخروج',
    language: 'English',
    refresh: 'تحديث',
    loading: 'جارٍ التحميل…',
    retry: 'إعادة المحاولة',
    noBranchTitle: 'لم يتم ربط حسابك بفرع',
    noBranchBody: 'تواصل مع المسؤول لربط حسابك بالفرع الذي تعمل فيه.',
    loadFailed: 'تعذّر تحميل البيانات',
    branchClosed: 'الفرع مغلق حالياً',
    callCentreScope: 'حسابك يتابع إغلاقات جميع الفروع.',

    // sections
    closedNow: 'الأصناف الموقوفة',
    closedNoneTitle: 'كل الأصناف متاحة',
    closedNoneBody: 'لا يوجد أي صنف موقوف في فرعك الآن.',
    allItems: 'كل الأصناف',
    searchPlaceholder: 'ابحث عن صنف…',
    noResults: 'لا توجد نتائج مطابقة.',
    uncategorized: 'بدون تصنيف',

    // actions
    close: 'إيقاف',
    reopen: 'إتاحة',
    cancel: 'إلغاء',
    confirmClose: 'تأكيد الإيقاف',
    working: 'جارٍ التنفيذ…',

    // close dialog
    closeTitle: 'إيقاف الصنف مؤقتاً',
    durationLabel: 'المدة',
    reasonLabel: 'السبب',
    noteLabel: 'ملاحظة (اختياري)',
    notePlaceholder: 'تفاصيل إضافية…',
    autoReopenHint: 'سيعود الصنف تلقائياً عند انتهاء المدة.',

    // durations
    dur30m: '30 دقيقة',
    dur1h: 'ساعة',
    dur3h: '3 ساعات',
    dur6h: '6 ساعات',
    dur12h: '12 ساعة',

    // reasons
    reason_out_of_stock: 'نفد المخزون',
    reason_supplier_delay: 'تأخر المورد',
    reason_equipment_down: 'عطل في المعدات',
    reason_quality_hold: 'إيقاف للجودة',
    reason_other: 'سبب آخر',

    // options (modifiers — Lazywait calls them Prices)
    optionsLabel: 'الخيارات',
    showOptions: 'عرض الخيارات',
    hideOptions: 'إخفاء الخيارات',
    noOptions: 'لا توجد خيارات لهذا الصنف.',
    closedOptions: 'الخيارات الموقوفة',
    closeOptionTitle: 'إيقاف الخيار مؤقتاً',
    optionAutoReopenHint: 'سيعود الخيار تلقائياً عند انتهاء المدة.',
    requiredGroup: 'إلزامي',
    optionalGroup: 'اختياري',
    blockedByOptions: 'الصنف غير قابل للطلب: مجموعة إلزامية لا تحتوي على خيار متاح.',

    // countdown
    backIn: 'يعود خلال',
    reopeningNow: 'يعود الآن',
    untimed: 'موقوف بدون مدة',

    blockedItemsLabel: 'أصناف لا يمكن طلبها',
    blockedCausesLabel: 'سبب التعذّر',
    blockedReasonPill: 'خيار إلزامي موقوف',
    blockedByGroup: 'مجموعة إلزامية نفدت خياراتها',
    blockedCountLabel: 'أصناف متعذّرة',
    itemsUnavailableCount: 'أصناف غير متاحة',
    returnLapsed: 'يعود الآن',
    optionsClosedCount: 'خيارات موقوفة',
    affectedCount: 'صنف متأثر',
    earliestReturn: 'أقرب عودة',
    returnUnknown: 'وقت العودة غير محدد',
    viewOnlyOptionsNote: 'إعادة فتح الخيار من صلاحية الفرع وحده.',
    optionOnlyTitle: 'فروع بخيارات موقوفة فقط',
    optionOnlyBody: 'كل الأصناف ما زالت قابلة للطلب في هذه الفروع.',

    // call-centre board
    boardAllClearTitle: 'كل الفروع تعمل بشكل طبيعي',
    boardAllClearBody: 'لا يوجد أي صنف موقوف أو توصيل متوقف الآن.',
    boardNeedsAttention: 'فروع تحتاج متابعة',
    itemsClosedCount: 'أصناف موقوفة',
    areasDisabledCount: 'مناطق موقوفة',
    deliveryPausedLabel: 'التوصيل متوقف',
    deliveryRunningLabel: 'التوصيل يعمل',
    resumeDelivery: 'استئناف التوصيل',
    openBranch: 'عرض التفاصيل',
    closePanel: 'إغلاق',
    contactLabel: 'التواصل',
    workingHoursLabel: 'ساعات العمل',
    areasLabel: 'مناطق التوصيل',
    closedItemsLabel: 'الأصناف الموقوفة',
    enableArea: 'تفعيل',
    disableArea: 'إيقاف',
    soundOn: 'التنبيه الصوتي مفعّل',
    soundOff: 'التنبيه الصوتي مكتوم',
    newClosure: 'إغلاق جديد',
    advisoryAreasNote: 'أسماء المناطق مرجع لمركز الاتصال فقط ولا تتحكم في التطبيق.',

    // delivery pause
    pauseDeliveryTitle: 'إيقاف التوصيل مؤقتاً',
    pauseDelivery: 'إيقاف التوصيل لمدة…',
    confirmPause: 'تأكيد الإيقاف',
    deliveryAutoResumeHint: 'سيعود التوصيل تلقائياً عند انتهاء المدة. الاستلام من الفرع لا يتأثر.',
    dreason_no_driver: 'لا يوجد سائق',
    dreason_weather: 'الطقس',
    dreason_kitchen_overload: 'ضغط على المطبخ',
    dreason_area_incident: 'ظرف في المنطقة',
    dreason_other: 'سبب آخر',

    // sign-in
    authSignInTitle: 'تسجيل الدخول إلى حسابك',
    authSignUpTitle: 'إنشاء حساب جديد',
    authSignIn: 'تسجيل الدخول',
    authSignUp: 'إنشاء حساب',
    authFullName: 'الاسم الكامل',
    authPhone: 'رقم الجوال (اختياري)',
    authEmail: 'البريد الإلكتروني',
    authPassword: 'كلمة المرور',
    authWorking: 'جارٍ المتابعة…',
    authFailed: 'تعذّر تسجيل الدخول',
  },
  en: {
    branchConsole: 'Branch Console',
    callCentreConsole: 'Call Centre Console',
    signOut: 'Sign out',
    language: 'العربية',
    refresh: 'Refresh',
    loading: 'Loading…',
    retry: 'Retry',
    noBranchTitle: 'Your account is not linked to a branch',
    noBranchBody: 'Ask an administrator to link your account to the branch you work in.',
    loadFailed: 'Could not load data',
    branchClosed: 'This branch is currently closed',
    callCentreScope: 'Your account monitors closures across every branch.',

    closedNow: 'Closed items',
    closedNoneTitle: 'Everything is available',
    closedNoneBody: 'No item is closed at your branch right now.',
    allItems: 'All items',
    searchPlaceholder: 'Search for an item…',
    noResults: 'No matching items.',
    uncategorized: 'Uncategorized',

    close: 'Close',
    reopen: 'Reopen',
    cancel: 'Cancel',
    confirmClose: 'Confirm closure',
    working: 'Working…',

    closeTitle: 'Close this item temporarily',
    durationLabel: 'Duration',
    reasonLabel: 'Reason',
    noteLabel: 'Note (optional)',
    notePlaceholder: 'Anything worth recording…',
    autoReopenHint: 'The item reopens by itself when the timer runs out.',

    dur30m: '30 minutes',
    dur1h: '1 hour',
    dur3h: '3 hours',
    dur6h: '6 hours',
    dur12h: '12 hours',

    reason_out_of_stock: 'Out of stock',
    reason_supplier_delay: 'Supplier delay',
    reason_equipment_down: 'Equipment down',
    reason_quality_hold: 'Quality hold',
    reason_other: 'Other',

    backIn: 'Back in',
    reopeningNow: 'Reopening now',
    untimed: 'Closed with no timer',

    boardAllClearTitle: 'Every branch is running normally',
    boardAllClearBody: 'Nothing is closed and no delivery is paused right now.',
    boardNeedsAttention: 'Branches needing attention',
    itemsClosedCount: 'items closed',
    areasDisabledCount: 'areas disabled',
    deliveryPausedLabel: 'Delivery paused',
    deliveryRunningLabel: 'Delivery running',
    resumeDelivery: 'Resume delivery',
    openBranch: 'View details',
    closePanel: 'Close',
    contactLabel: 'Contact',
    workingHoursLabel: 'Working hours',
    areasLabel: 'Delivery areas',
    closedItemsLabel: 'Closed items',
    enableArea: 'Enable',
    disableArea: 'Disable',
    soundOn: 'Alert sound on',
    soundOff: 'Alert sound muted',
    newClosure: 'New closure',
    advisoryAreasNote: 'Area names are call-centre reference only and do not control the app.',

    pauseDeliveryTitle: 'Pause delivery temporarily',
    pauseDelivery: 'Pause delivery for…',
    confirmPause: 'Confirm pause',
    deliveryAutoResumeHint: 'Delivery resumes by itself when the timer runs out. Pickup is unaffected.',
    dreason_no_driver: 'No driver',
    dreason_weather: 'Weather',
    dreason_kitchen_overload: 'Kitchen overloaded',
    dreason_area_incident: 'Incident in the area',
    dreason_other: 'Other',

    optionsLabel: 'Options',
    showOptions: 'Show options',
    hideOptions: 'Hide options',
    noOptions: 'This item has no options.',
    closedOptions: 'Closed options',
    closeOptionTitle: 'Close this option',
    optionAutoReopenHint: 'The option reopens by itself when the timer ends.',
    requiredGroup: 'Required',
    optionalGroup: 'Optional',
    blockedByOptions: 'Not orderable: a required group has no available option left.',

    blockedItemsLabel: 'Items customers cannot order',
    blockedCausesLabel: 'What is causing it',
    blockedReasonPill: 'Required option closed',
    blockedByGroup: 'a required group has run out',
    blockedCountLabel: 'items blocked',
    itemsUnavailableCount: 'items unavailable',
    returnLapsed: 'Returning now',
    optionsClosedCount: 'options closed',
    affectedCount: 'items affected',
    earliestReturn: 'Earliest return',
    returnUnknown: 'No return time',
    viewOnlyOptionsNote: 'Only the branch can reopen an option.',
    optionOnlyTitle: 'Branches with closed options only',
    optionOnlyBody: 'Every item is still orderable at these branches.',

    authSignInTitle: 'Sign in to your account',
    authSignUpTitle: 'Create your account',
    authSignIn: 'Sign In',
    authSignUp: 'Sign Up',
    authFullName: 'Full Name',
    authPhone: 'Phone (optional)',
    authEmail: 'Email',
    authPassword: 'Password',
    authWorking: 'Working…',
    authFailed: 'Authentication failed',
  },
} as const;

export type OpsStringKey = keyof typeof OPS_STRINGS['en'];

/** Look up copy, falling back to English so a missing Arabic key shows text rather than a key. */
export function opsT(lang: OpsLang, key: OpsStringKey): string {
  return OPS_STRINGS[lang][key] ?? OPS_STRINGS.en[key] ?? key;
}
