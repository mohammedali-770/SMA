// @vitest-environment jsdom
/**
 * The grouped sidebar, as rendered.
 *
 * `adminNav.test.ts` proves the model; this proves the three things only the
 * component can get wrong, and each of them hides a working page from the
 * operator rather than breaking anything loudly:
 *
 *   collapsing must never hide WHERE YOU ARE, or WHAT IS WAITING (the Live
 *   Orders count has to survive its group being shut);
 *   a gated tab must not appear;
 *   the compact drawer must actually close after you pick something.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminSidebar } from './AdminSidebar';
import type { AdminTab, GatedVisibility } from './adminNav';

const ALL: GatedVisibility = { health: true, alerts: true, integrity: true };
const NONE: GatedVisibility = { health: false, alerts: false, integrity: false };

function setup(over: {
  active?: AdminTab;
  visibility?: GatedVisibility;
  lang?: 'en' | 'ar';
  liveOrderCount?: number;
} = {}) {
  const onSelect = vi.fn();
  render(
    <AdminSidebar
      active={over.active ?? 'stats'}
      onSelect={onSelect}
      visibility={over.visibility ?? ALL}
      lang={over.lang ?? 'en'}
      liveOrderCount={over.liveOrderCount ?? 0}
    />,
  );
  return { onSelect };
}

/** The persistent column. With the drawer closed it is the only nav landmark. */
const navColumn = () => screen.getByRole('navigation');
const column = () => within(navColumn());

/**
 * Group headers are found by the panel they control, not by name: "Branches"
 * the group and "Branch Management" the item both match a name regex, and the
 * header's accessible name additionally absorbs its count badge.
 */
function groupHeader(id: string): HTMLElement {
  const el = navColumn().querySelector<HTMLElement>(`[aria-controls="admin-nav-column-group-${id}"]`);
  if (!el) throw new Error(`no disclosure header for group "${id}"`);
  return el;
}

afterEach(cleanup);

describe('structure', () => {
  it('renders Sales Overview as a direct item, not behind a disclosure', () => {
    setup();
    const item = column().getByRole('button', { name: /sales overview/i });
    expect(item.getAttribute('aria-expanded')).toBeNull();
  });

  it('renders the five collapsible groups as disclosures', () => {
    setup();
    for (const id of ['operations', 'catalog', 'branches', 'finance', 'system']) {
      expect(groupHeader(id).getAttribute('aria-expanded')).toBeTruthy();
    }
  });

  it('shows Arabic labels and Arabic group names', () => {
    setup({ lang: 'ar' });
    expect(column().getByRole('button', { name: /الملخص اليومي/ })).toBeTruthy();
    expect(column().getByRole('button', { name: /العمليات/ })).toBeTruthy();
  });
});

describe('the active page is always visible', () => {
  it('marks the active item with aria-current', () => {
    setup({ active: 'stats' });
    expect(column().getByRole('button', { name: /sales overview/i }).getAttribute('aria-current'))
      .toBe('page');
  });

  it('opens the group holding the active tab', () => {
    setup({ active: 'reports' });
    expect(groupHeader('finance').getAttribute('aria-expanded')).toBe('true');
    expect(column().getByRole('button', { name: /financial reports/i })).toBeTruthy();
  });

  it('leaves groups that do not hold the active tab closed', () => {
    setup({ active: 'stats' });
    expect(groupHeader('system').getAttribute('aria-expanded')).toBe('false');
    expect(column().queryByRole('button', { name: /legal documents/i })).toBeNull();
  });

  it('re-opens the group when the shell moves the active tab', () => {
    // The shell resets the active tab to Overview when a gated probe comes
    // back missing — and can move it back. The sidebar must follow.
    const { rerender } = render(
      <AdminSidebar active="stats" onSelect={vi.fn()} visibility={ALL} lang="en" liveOrderCount={0} />,
    );
    expect(groupHeader('system').getAttribute('aria-expanded')).toBe('false');

    rerender(
      <AdminSidebar active="settings" onSelect={vi.fn()} visibility={ALL} lang="en" liveOrderCount={0} />,
    );
    expect(groupHeader('system').getAttribute('aria-expanded')).toBe('true');
    expect(column().getByRole('button', { name: /^settings$/i })).toBeTruthy();
  });
});

describe('collapsing never hides the Live Orders count', () => {
  it('shows the count on the collapsed group header', () => {
    // Operations is collapsed while Sales Overview is active, so the count has
    // nowhere else to appear — this is the case that would silently lose it.
    setup({ active: 'stats', liveOrderCount: 7 });
    expect(groupHeader('operations').getAttribute('aria-expanded')).toBe('false');
    expect(within(groupHeader('operations')).getByText('7')).toBeTruthy();
  });

  it('shows the count on the item once the group is open', () => {
    setup({ active: 'orders', liveOrderCount: 7 });
    const item = column().getByRole('button', { name: /live orders/i });
    expect(within(item).getByText('7')).toBeTruthy();
  });

  it('renders no badge at zero', () => {
    setup({ active: 'stats', liveOrderCount: 0 });
    expect(within(groupHeader('operations')).queryByText('0')).toBeNull();
  });
});

describe('capability gating', () => {
  it('hides gated tabs whose probes report a missing RPC', () => {
    setup({ active: 'orders', visibility: NONE });
    expect(column().getByRole('button', { name: /live orders/i })).toBeTruthy();
    for (const name of [/operations health/i, /operations alerts/i, /order integrity/i]) {
      expect(column().queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows them when the probes succeed', () => {
    setup({ active: 'orders', visibility: ALL });
    for (const name of [/operations health/i, /operations alerts/i, /order integrity/i]) {
      expect(column().getByRole('button', { name })).toBeTruthy();
    }
  });
});

describe('interaction', () => {
  it('reports the clicked tab', () => {
    const { onSelect } = setup({ active: 'stats' });
    fireEvent.click(column().getByRole('button', { name: /sales overview/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('stats');
  });

  it('toggles a group open and shut', () => {
    setup({ active: 'stats' });
    expect(column().queryByRole('button', { name: /banners/i })).toBeNull();

    fireEvent.click(groupHeader('catalog'));
    expect(column().getByRole('button', { name: /banners/i })).toBeTruthy();

    fireEvent.click(groupHeader('catalog'));
    expect(column().queryByRole('button', { name: /banners/i })).toBeNull();
  });

  it('will not collapse the group you are standing in back shut', () => {
    // Toggling it closed is allowed, but the effect that guarantees the active
    // group is open must not fight the user on every unrelated render either.
    setup({ active: 'banners' });
    expect(groupHeader('catalog').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(groupHeader('catalog'));
    expect(groupHeader('catalog').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('compact drawer', () => {
  it('is closed until asked for', () => {
    setup();
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('opens a second navigation over the content', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getAllByRole('navigation')).toHaveLength(2);
  });

  it('closes after picking a destination', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const drawer = within(screen.getAllByRole('navigation')[0]);
    fireEvent.click(drawer.getByRole('button', { name: /sales overview/i }));

    expect(onSelect).toHaveBeenCalledWith('stats');
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('closes on Escape', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getAllByRole('navigation')).toHaveLength(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('names the current page on the trigger, so the drawer is not the only way to tell', () => {
    setup({ active: 'reports' });
    expect(screen.getByTestId('admin-nav-current').textContent).toBe('Financial Reports');
  });
});

describe('the drawer and the column are two copies of one tree', () => {
  it('does not duplicate a disclosure panel id while both are mounted', () => {
    // The column is only HIDDEN below `lg`, never unmounted, so with the
    // drawer open every group is rendered twice. Sharing one id would make
    // each aria-controls ambiguous and the document invalid.
    setup();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const ids = Array.from(document.querySelectorAll('[id^="admin-nav-"]')).map((el) => el.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('points every aria-controls at exactly one element', () => {
    setup({ active: 'reports' });
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    for (const el of Array.from(document.querySelectorAll('[aria-controls]'))) {
      const target = el.getAttribute('aria-controls') as string;
      if (el.getAttribute('aria-expanded') !== 'true') continue;
      expect(document.querySelectorAll(`[id="${target}"]`)).toHaveLength(1);
    }
  });
});
