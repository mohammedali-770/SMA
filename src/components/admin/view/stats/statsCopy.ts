/**
 * Sales Overview copy, both languages, in one place.
 *
 * Kept beside the branch-sales view rather than in `adminLocales` because none
 * of it is shared with another panel, and a string that lives next to its only
 * caller is a string that gets updated when the caller changes.
 *
 * Two deliberate omissions:
 *
 *   Nothing says "today", "yesterday" or "this period". The panel has no date
 *   control — it renders whatever orders the console currently holds — so a
 *   period in the copy would be a claim the numbers do not support. The old
 *   header made exactly that claim ("Daily … compared to yesterday") next to a
 *   chart that compared nothing.
 *
 *   A closed branch's reason is derived from the two flags the branch model
 *   actually has (`isActive`, `deliveryTemporarilyClosed`). There is no
 *   free-text reason column, so none is invented.
 */
export type StatsLang = 'en' | 'ar';

export const STATS_COPY = {
  en: {
    branchSales: 'Branch Sales',
    ranked: 'Ranked by sales',
    top5: 'Top 5',
    top8: 'Top 8',
    allActive: 'All active branches',
    searchLabel: 'Search branch',
    searchPlaceholder: 'Branch name',
    viewAll: 'View all branches',
    hideAll: 'Hide table',
    noMatch: 'No branch matches that search.',
    noSalesAtAll: 'No branch has recorded sales yet.',
    showNames: 'Show names',
    hideNames: 'Hide names',
    colBranch: 'Branch',
    colSales: 'Sales',
    colOrders: 'Orders',
    colAvgTicket: 'Avg ticket',
    colStatus: 'Status',
    statusOpen: 'Open',
    statusTemporary: 'Temporarily unavailable',
    statusClosed: 'Closed',
    reasonTemporary: 'Delivery paused',
    reasonClosed: 'Closed for maintenance',
    breakdownTitle: 'Branch availability',
    showBreakdown: 'Show branch availability',
    hideBreakdown: 'Hide branch availability',
    none: 'None',
    zeroSales: (n: number) => `${n} ${n === 1 ? 'branch has' : 'branches have'} no sales`,
  },
  ar: {
    branchSales: 'مبيعات الفروع',
    ranked: 'مرتّبة حسب المبيعات',
    top5: 'أعلى ٥',
    top8: 'أعلى ٨',
    allActive: 'كل الفروع النشطة',
    searchLabel: 'ابحث عن فرع',
    searchPlaceholder: 'اسم الفرع',
    viewAll: 'عرض كل الفروع',
    hideAll: 'إخفاء الجدول',
    noMatch: 'لا يوجد فرع مطابق لبحثك.',
    noSalesAtAll: 'لا توجد مبيعات مسجلة لأي فرع حتى الآن.',
    showNames: 'عرض الأسماء',
    hideNames: 'إخفاء الأسماء',
    colBranch: 'الفرع',
    colSales: 'المبيعات',
    colOrders: 'الطلبات',
    colAvgTicket: 'متوسط الفاتورة',
    colStatus: 'الحالة',
    statusOpen: 'مفتوح',
    statusTemporary: 'متوقف مؤقتاً',
    statusClosed: 'مغلق',
    reasonTemporary: 'التوصيل موقوف مؤقتاً',
    reasonClosed: 'مغلق للصيانة',
    breakdownTitle: 'حالة الفروع',
    showBreakdown: 'عرض حالة الفروع',
    hideBreakdown: 'إخفاء حالة الفروع',
    none: 'لا يوجد',
    zeroSales: (n: number) => `${n} من الفروع بلا مبيعات`,
  },
} as const;

export type StatsCopy = typeof STATS_COPY[StatsLang];
