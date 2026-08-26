/**
 * The grouped navigation model.
 *
 * Grouping is presentation, but it is presentation that can HIDE things, which
 * makes it worth pinning: a tab dropped from the group table disappears from
 * the console entirely while every route, panel and permission behind it still
 * exists and still works. Nothing else in the app would fail.
 *
 * So the suite asserts three separate properties:
 *   - the grouping matches the agreed structure, exactly;
 *   - grouping is TOTAL — every tab appears once, no tab is invented;
 *   - gating still decides visibility, and a group emptied by gating is
 *     dropped rather than rendered as a header opening onto nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  ADMIN_NAV, ADMIN_NAV_GROUPS, groupIdForTab, initialExpandedGroups, resolveNavGroups,
  visibleNav, withActiveGroupExpanded,
  type AdminNavGroup, type AdminNavGroupId, type AdminTab, type GatedVisibility,
  parseTabFromHash, tabToHash,
} from './adminNav';

const ALL_VISIBLE: GatedVisibility = { health: true, alerts: true, integrity: true };
const NONE_VISIBLE: GatedVisibility = { health: false, alerts: false, integrity: false };

const tabsOf = (id: AdminNavGroupId, visibility = ALL_VISIBLE): AdminTab[] =>
  resolveNavGroups(visibility).find((g) => g.id === id)?.items.map((i) => i.tab) ?? [];

describe('grouping is total', () => {
  it('places every navigation tab in exactly one group', () => {
    const grouped = ADMIN_NAV_GROUPS.flatMap((g) => g.tabs);
    const seen = new Set(grouped);

    expect(seen.size).toBe(grouped.length);                       // no tab twice
    expect(seen).toEqual(new Set(ADMIN_NAV.map((i) => i.tab)));   // none missing, none invented
  });

  it('names no tab that does not exist in ADMIN_NAV', () => {
    // Guards the direction the other assertion cannot: a typo'd tab id in the
    // group table would otherwise render as a blank, unclickable button.
    const known = new Set(ADMIN_NAV.map((i) => i.tab));
    for (const group of ADMIN_NAV_GROUPS) {
      for (const tab of group.tabs) expect(known.has(tab)).toBe(true);
    }
  });

  it('shows every tab that the flat navigation would have shown', () => {
    // The grouped sidebar must not quietly drop a destination the old flat one
    // rendered — same visibility inputs, same set of tabs.
    for (const visibility of [ALL_VISIBLE, NONE_VISIBLE]) {
      const flat = new Set(visibleNav(visibility).map((i) => i.tab));
      const grouped = new Set(resolveNavGroups(visibility).flatMap((g) => g.items.map((i) => i.tab)));
      expect(grouped).toEqual(flat);
    }
  });
});

describe('the agreed structure', () => {
  it('orders the groups Overview, Operations, Catalog, Branches, Finance, System', () => {
    expect(resolveNavGroups(ALL_VISIBLE).map((g) => g.id)).toEqual([
      'overview', 'operations', 'catalog', 'branches', 'finance', 'system',
    ]);
  });

  it('puts each tab under its agreed group', () => {
    expect(tabsOf('overview')).toEqual(['stats']);
    expect(tabsOf('operations')).toEqual(['orders', 'health', 'alerts', 'integrity']);
    expect(tabsOf('catalog')).toEqual(['menu', 'banners']);
    expect(tabsOf('branches')).toEqual(['branches']);
    expect(tabsOf('finance')).toEqual(['reports', 'comps']);
    expect(tabsOf('system')).toEqual(['integrations', 'settings', 'legal']);
  });

  it('keeps Sales Overview directly accessible — Overview never collapses', () => {
    // It is the landing tab AND the tab the shell falls back to when a gated
    // tab vanishes. Behind a collapse, the console could return you to a page
    // the sidebar is hiding.
    const overview = resolveNavGroups(ALL_VISIBLE).find((g) => g.id === 'overview');
    expect(overview?.collapsible).toBe(false);
  });

  it('makes the other five groups collapsible', () => {
    const others = resolveNavGroups(ALL_VISIBLE).filter((g) => g.id !== 'overview');
    expect(others).toHaveLength(5);
    for (const group of others) expect(group.collapsible).toBe(true);
  });

  it('labels every group in both languages', () => {
    for (const group of ADMIN_NAV_GROUPS) {
      expect(group.en.length).toBeGreaterThan(0);
      expect(group.ar.length).toBeGreaterThan(0);
      expect(group.ar).not.toBe(group.en);
      expect(/[؀-ۿ]/.test(group.ar)).toBe(true);
    }
  });
});

describe('permission and capability gating', () => {
  it('drops a gated tab whose probe says its RPC is missing', () => {
    expect(tabsOf('operations', NONE_VISIBLE)).toEqual(['orders']);
  });

  it('gates each capability independently', () => {
    expect(tabsOf('operations', { health: true, alerts: false, integrity: false }))
      .toEqual(['orders', 'health']);
    expect(tabsOf('operations', { health: false, alerts: true, integrity: false }))
      .toEqual(['orders', 'alerts']);
    expect(tabsOf('operations', { health: false, alerts: false, integrity: true }))
      .toEqual(['orders', 'integrity']);
  });

  it('never gates an ungated tab', () => {
    const ungated = ADMIN_NAV.filter((i) => !i.gated).map((i) => i.tab);
    const shown = resolveNavGroups(NONE_VISIBLE).flatMap((g) => g.items.map((i) => i.tab));
    for (const tab of ungated) expect(shown).toContain(tab);
  });

  it('hides a group entirely when the operator can reach nothing inside it', () => {
    // No real group can empty out today — each holds at least one ungated tab
    // — so this drives the rule with a synthetic table rather than asserting
    // it vacuously against the live one.
    const groups: AdminNavGroup[] = [
      { ...ADMIN_NAV_GROUPS[0] },
      {
        id: 'operations', icon: ADMIN_NAV_GROUPS[1].icon, en: 'Gated', ar: 'محجوب',
        tabs: ['health', 'alerts', 'integrity'], collapsible: true,
      },
    ];

    expect(resolveNavGroups(ALL_VISIBLE, groups).map((g) => g.id)).toEqual(['overview', 'operations']);
    expect(resolveNavGroups(NONE_VISIBLE, groups).map((g) => g.id)).toEqual(['overview']);
  });

  it('skips a tab a group names but ADMIN_NAV does not define', () => {
    const groups: AdminNavGroup[] = [{
      id: 'system', icon: ADMIN_NAV_GROUPS[5].icon, en: 'System', ar: 'النظام',
      tabs: ['settings', 'ghost' as AdminTab], collapsible: true,
    }];
    expect(resolveNavGroups(ALL_VISIBLE, groups)[0].items.map((i) => i.tab)).toEqual(['settings']);
  });
});

describe('the active tab is never hidden', () => {
  it('finds the group holding a tab', () => {
    expect(groupIdForTab('stats')).toBe('overview');
    expect(groupIdForTab('integrity')).toBe('operations');
    expect(groupIdForTab('legal')).toBe('system');
    expect(groupIdForTab('nope' as AdminTab)).toBeNull();
  });

  it('opens the active tab\'s group on first render', () => {
    expect([...initialExpandedGroups('reports')]).toEqual(['finance']);
    expect([...initialExpandedGroups('banners')]).toEqual(['catalog']);
  });

  it('opens the group the shell moves you into', () => {
    // The shell resets the active tab to Overview when a gated tab's probe
    // comes back missing. Whatever group receives you must open.
    const collapsed = new Set<AdminNavGroupId>();
    expect([...withActiveGroupExpanded(collapsed, 'settings')]).toEqual(['system']);
  });

  it('leaves other groups exactly as the operator left them', () => {
    const expanded = new Set<AdminNavGroupId>(['catalog']);
    expect([...withActiveGroupExpanded(expanded, 'reports')].sort()).toEqual(['catalog', 'finance']);
  });

  it('returns the SAME set when the active group is already open', () => {
    // Identity, not equality: a new Set every render would loop the effect
    // that calls this.
    const expanded = new Set<AdminNavGroupId>(['finance']);
    expect(withActiveGroupExpanded(expanded, 'reports')).toBe(expanded);
  });
});

/**
 * The console kept the active tab in component state only, so a refresh, a
 * crash-recovery remount, or signing back in always landed on Stats — even if
 * the operator had been watching Live Orders during a rush.
 *
 * The hash is user-editable and can be a stale bookmark, so parsing must never
 * produce a tab that does not exist.
 */
describe('parseTabFromHash', () => {
  it('reads a real tab, with or without the leading #', () => {
    expect(parseTabFromHash('#orders')).toBe('orders');
    expect(parseTabFromHash('orders')).toBe('orders');
  });

  it('is case- and whitespace-tolerant', () => {
    expect(parseTabFromHash('#Orders')).toBe('orders');
    expect(parseTabFromHash('#  REPORTS  ')).toBe('reports');
  });

  it('returns null for anything that is not a real tab', () => {
    // The caller decides the fallback; a removed tab in an old bookmark must not
    // render a blank console.
    expect(parseTabFromHash('#nope')).toBeNull();
    expect(parseTabFromHash('#')).toBeNull();
    expect(parseTabFromHash('')).toBeNull();
    expect(parseTabFromHash(undefined)).toBeNull();
    expect(parseTabFromHash(null)).toBeNull();
  });

  it('cannot be tricked into returning a non-tab value', () => {
    expect(parseTabFromHash('#__proto__')).toBeNull();
    expect(parseTabFromHash('#constructor')).toBeNull();
    expect(parseTabFromHash('#toString')).toBeNull();
  });

  it('round-trips every tab in the nav', () => {
    for (const item of ADMIN_NAV) {
      expect(parseTabFromHash(tabToHash(item.tab))).toBe(item.tab);
    }
  });
});
