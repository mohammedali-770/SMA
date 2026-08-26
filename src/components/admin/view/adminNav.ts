/**
 * The console's navigation model, as DATA.
 *
 * The sidebar was twelve hand-written buttons, each repeating the same eleven
 * Tailwind classes and its own active-state ternary. That is how one tab ends
 * up a pixel different from the rest, and why adding a tab meant copying a
 * block. The list below is the whole navigation; the component renders it.
 *
 * Twelve flat items is also more than a person scans — so the same items are
 * additionally described as GROUPS. Grouping is presentation only: the tab
 * identifiers, their routes and their panels are untouched, and `ADMIN_NAV`
 * remains the single source of truth for what a tab IS. A group is a view over
 * that list, not a second copy of it — `resolveNavGroups` looks every tab up in
 * `ADMIN_NAV`, so a tab that exists in one and not the other cannot silently
 * render a half-defined button.
 *
 * Visibility is NOT decided here. Three tabs are capability-gated behind
 * probes that may legitimately fail (the UI can deploy before a migration is
 * applied), and that logic stays in AdminDashboard where the probes live —
 * this module only describes what a tab IS and which group it sits in.
 */
import {
  Activity, BarChart3, BellRing, Building2, ClipboardList, FileSpreadsheet,
  Gift, HeartPulse, Images, Layers, Plug, Scale, Settings, ShieldAlert,
  SlidersHorizontal, Store, Wallet,
  type LucideIcon,
} from 'lucide-react';

export type AdminTab =
  | 'stats' | 'orders' | 'menu' | 'banners' | 'branches' | 'reports' | 'comps'
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
  // Finance rather than Settings: a comp is a money decision, and it belongs
  // next to the reports that show what it cost.
  { tab: 'comps', icon: Gift, en: 'Comped Customers', ar: 'عملاء الضيافة' },
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

export type AdminNavGroupId =
  | 'overview' | 'operations' | 'catalog' | 'branches' | 'finance' | 'system';

export interface AdminNavGroup {
  id: AdminNavGroupId;
  icon: LucideIcon;
  en: string;
  ar: string;
  /** Member tabs, in displayed order. Each must exist in `ADMIN_NAV`. */
  tabs: AdminTab[];
  /**
   * `false` pins the group open and renders it without a disclosure header.
   *
   * Overview is the console's landing tab and the destination the shell falls
   * back to when a gated tab disappears. Putting it behind a collapse would
   * mean the most-visited page — and the place you are silently returned to —
   * can be hidden one click away, so it stays a plain top-level item.
   */
  collapsible: boolean;
}

/**
 * The grouped navigation. Every tab in `ADMIN_NAV` appears exactly once; the
 * `adminNav.test.ts` suite asserts that, so a tab added to one list and
 * forgotten in the other fails the build rather than vanishing from the
 * sidebar.
 */
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'overview', icon: BarChart3, en: 'Overview', ar: 'نظرة عامة',
    tabs: ['stats'], collapsible: false,
  },
  {
    id: 'operations', icon: Activity, en: 'Operations', ar: 'العمليات',
    tabs: ['orders', 'health', 'alerts', 'integrity'], collapsible: true,
  },
  {
    id: 'catalog', icon: Layers, en: 'Catalog', ar: 'المنيو والمحتوى',
    tabs: ['menu', 'banners'], collapsible: true,
  },
  {
    id: 'branches', icon: Building2, en: 'Branches', ar: 'الفروع',
    tabs: ['branches'], collapsible: true,
  },
  {
    id: 'finance', icon: Wallet, en: 'Finance', ar: 'المالية',
    tabs: ['reports', 'comps'], collapsible: true,
  },
  {
    id: 'system', icon: SlidersHorizontal, en: 'System', ar: 'النظام',
    tabs: ['integrations', 'settings', 'legal'], collapsible: true,
  },
];

export interface ResolvedNavGroup extends Omit<AdminNavGroup, 'tabs'> {
  items: AdminNavItem[];
}

/**
 * The groups to render, each carrying only the items the operator can actually
 * reach.
 *
 * A group whose every member is gated away is DROPPED rather than rendered
 * empty — an expandable header that opens onto nothing reads as a permission
 * bug and invites the operator to keep clicking it. Today no group can empty
 * out (each contains at least one ungated tab), but the rule is enforced here
 * rather than assumed, because gating is runtime state and the group table is
 * edited by hand.
 *
 * `groups` and `items` are parameters so the suite can prove the empty-group
 * rule with a synthetic table instead of waiting for a future tab arrangement
 * to make it reachable.
 */
export function resolveNavGroups(
  visibility: GatedVisibility,
  groups: AdminNavGroup[] = ADMIN_NAV_GROUPS,
  items: AdminNavItem[] = ADMIN_NAV,
): ResolvedNavGroup[] {
  const byTab = new Map(items.map((item) => [item.tab, item]));

  return groups
    .map(({ tabs, ...group }) => ({
      ...group,
      items: tabs
        .map((tab) => byTab.get(tab))
        // A tab named by a group but absent from ADMIN_NAV is skipped rather
        // than rendered as a blank button. The suite forbids the mismatch.
        .filter((item): item is AdminNavItem => Boolean(item))
        .filter((item) => !item.gated || visibility[item.gated]),
    }))
    .filter((group) => group.items.length > 0);
}

/** The group a tab belongs to, or null when no group claims it. */
export function groupIdForTab(
  tab: AdminTab,
  groups: AdminNavGroup[] = ADMIN_NAV_GROUPS,
): AdminNavGroupId | null {
  return groups.find((group) => group.tabs.includes(tab))?.id ?? null;
}

/**
 * The expanded set, guaranteed to contain the active tab's group.
 *
 * The sidebar must never hide where you currently are: if the shell moves you
 * to a tab inside a collapsed group — which it does when a gated tab
 * disappears and the active tab resets — that group opens. Returns the SAME set
 * when nothing changes, so React state does not churn on every render.
 */
export function withActiveGroupExpanded(
  expanded: ReadonlySet<AdminNavGroupId>,
  activeTab: AdminTab,
  groups: AdminNavGroup[] = ADMIN_NAV_GROUPS,
): ReadonlySet<AdminNavGroupId> {
  const id = groupIdForTab(activeTab, groups);
  if (!id || expanded.has(id)) return expanded;
  return new Set([...expanded, id]);
}

/** The groups a console starts with open: whichever holds the active tab. */
export function initialExpandedGroups(
  activeTab: AdminTab,
  groups: AdminNavGroup[] = ADMIN_NAV_GROUPS,
): ReadonlySet<AdminNavGroupId> {
  return withActiveGroupExpanded(new Set<AdminNavGroupId>(), activeTab, groups);
}

// ---------------------------------------------------------------------------
// Tab <-> URL hash
//
// The console kept the active tab in component state only, so a refresh, a
// crash-recovery remount, or signing back in always landed on Stats — even if
// the operator had been watching Live Orders during a rush. It also meant a tab
// could not be linked to or bookmarked, and the browser Back button walked out
// of the console entirely instead of to the previous tab.
//
// The hash is used rather than a path so this never interacts with the SPA
// rewrites in vercel.json (which also route `/app`), and needs no router.
// ---------------------------------------------------------------------------

/** Every tab that exists, derived from the nav so the two cannot drift. */
const KNOWN_TABS: ReadonlySet<string> = new Set(ADMIN_NAV.map((i) => i.tab));

/**
 * The tab named by a URL hash, or null when it names nothing real.
 *
 * Returns null — rather than a default — so the caller decides the fallback.
 * Anything unrecognised is null: a hash is user-editable, and a stale bookmark
 * pointing at a removed tab must not render a blank console.
 */
export function parseTabFromHash(hash: string | undefined | null): AdminTab | null {
  if (typeof hash !== 'string') return null;
  const raw = hash.replace(/^#/, '').trim().toLowerCase();
  return KNOWN_TABS.has(raw) ? (raw as AdminTab) : null;
}

/** The hash for a tab, including the leading '#'. */
export function tabToHash(tab: AdminTab): string {
  return `#${tab}`;
}
