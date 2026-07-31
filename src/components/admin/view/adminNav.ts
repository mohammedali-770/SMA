/**
 * The console's navigation model, as DATA.
 *
 * The sidebar was twelve hand-written buttons, each repeating the same eleven
 * Tailwind classes and its own active-state ternary. That is how one tab ends
 * up a pixel different from the rest, and why adding a tab meant copying a
 * block. The list below is the whole navigation; the component renders it.
 *
 * Visibility is NOT decided here. Three tabs are capability-gated behind
 * probes that may legitimately fail (the UI can deploy before a migration is
 * applied), and that logic stays in AdminDashboard where the probes live —
 * this module only describes what a tab IS.
 */
import {
  BarChart3, BellRing, ClipboardList, FileSpreadsheet, HeartPulse, Images,
  Layers, Plug, Scale, Settings, ShieldAlert, Store,
  type LucideIcon,
} from 'lucide-react';

export type AdminTab =
  | 'stats' | 'orders' | 'menu' | 'banners' | 'branches' | 'reports'
  | 'integrations' | 'health' | 'alerts' | 'integrity' | 'settings' | 'legal';

export interface AdminNavItem {
  tab: AdminTab;
  icon: LucideIcon;
  en: string;
  ar: string;
  /**
   * Tabs whose visibility depends on a runtime capability probe. The shell
   * supplies the answer; an item without this is always shown.
   */
  gated?: 'health' | 'alerts' | 'integrity';
}

/** Order is the displayed order. Labels are inline because they are nav-only. */
export const ADMIN_NAV: AdminNavItem[] = [
  { tab: 'stats', icon: BarChart3, en: 'Sales Overview', ar: 'الملخص اليومي' },
  { tab: 'orders', icon: ClipboardList, en: 'Live Orders', ar: 'الطلبات المباشرة' },
  { tab: 'menu', icon: Layers, en: 'Menu Management', ar: 'إدارة المنيو والأسعار' },
  { tab: 'banners', icon: Images, en: 'Banners', ar: 'بانرات الرئيسية' },
  { tab: 'branches', icon: Store, en: 'Branch Management', ar: 'إدارة الفروع' },
  { tab: 'reports', icon: FileSpreadsheet, en: 'Financial Reports', ar: 'التقارير والتحليلات المالية' },
  { tab: 'integrations', icon: Plug, en: 'Integrations', ar: 'الربط والتكاملات' },
  { tab: 'health', icon: HeartPulse, en: 'Operations Health', ar: 'صحة العمليات', gated: 'health' },
  { tab: 'alerts', icon: BellRing, en: 'Operations Alerts', ar: 'التنبيهات والملخص', gated: 'alerts' },
  { tab: 'integrity', icon: ShieldAlert, en: 'Order Integrity', ar: 'سلامة الطلبات', gated: 'integrity' },
  { tab: 'settings', icon: Settings, en: 'Settings', ar: 'الإعدادات' },
  { tab: 'legal', icon: Scale, en: 'Legal Documents', ar: 'المستندات القانونية' },
];

/** Which gated tabs are currently visible. Computed by the shell from probes. */
export interface GatedVisibility {
  health: boolean;
  alerts: boolean;
  integrity: boolean;
}

/** The nav items to render, in order. */
export function visibleNav(visibility: GatedVisibility): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => !item.gated || visibility[item.gated]);
}
