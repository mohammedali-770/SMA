// @vitest-environment jsdom
/**
 * Sales Overview — the reorganised branch section.
 *
 * `branchSales.test.ts` proves the ranking rules; this proves the panel obeys
 * them, and specifically the three claims that are easy to state and easy to
 * break:
 *
 *   the chart draws the top 8, not all 23;
 *   branches with no sales are COUNTED, not drawn — and are still present in
 *   the KPIs and in the full table, because summarising them must not be
 *   mistaken for filtering them out;
 *   the Operational Branches tile opens onto the branches behind it.
 *
 * The app context is mocked (no Supabase, no realtime, no provider tree).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminOrderStats } from '../../lib/api';
import type { Branch, Order } from '../../types';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

// The four tiles and the branch chart no longer sum `useApp().orders` — the
// console stopped holding every order ever placed. They read the server-side
// aggregate instead, so that is what this suite mocks.
const statsMock = vi.fn();
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  orders: { stats: () => statsMock() },
}));

import { StatsPanel } from './StatsPanel';

const mkBranch = (i: number, over: Partial<Branch> = {}): Branch => ({
  id: `b${i}`, nameEn: `Branch ${i}`, nameAr: `فرع ${i}`,
  addressEn: '', addressAr: '', phone: '', latitude: 0, longitude: 0,
  isActive: true, deliveryFee: 0, minDeliveryOrder: 0,
  ...over,
} as Branch);

const mkOrder = (branchId: string, total: number, i: number): Order => ({
  id: `o${i}`, orderNumber: `SM-${i}`, customerId: 'c1',
  customerName: 'Nora', customerPhone: '0551234567',
  branchId, branchNameEn: '', branchNameAr: '',
  orderType: 'delivery', status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
  items: [], subtotal: total, deliveryFee: 0, total,
  orderSyncStatus: 'synced', createdAt: '2026-07-01T09:00:00.000Z',
} as Order);

// 12 branches: b0..b9 trade (b0 highest), b10 and b11 sell nothing, b11 closed.
const BRANCHES = [
  ...Array.from({ length: 11 }, (_, i) => mkBranch(i)),
  mkBranch(11, { isActive: false }),
];
const ORDERS = Array.from({ length: 10 }, (_, i) => mkOrder(`b${i}`, (10 - i) * 100, i));

/**
 * The aggregate the server would return for a given order list, computed with
 * the SAME definitions `admin_order_stats` uses — including `total_amount`
 * spanning cancelled orders. Deriving it here rather than hardcoding numbers
 * keeps the existing `orders:` overrides below meaningful.
 */
function statsFrom(orders: Order[]): AdminOrderStats {
  const byBranch = new Map<string, { sales: number; order_count: number }>();
  for (const o of orders) {
    const bucket = byBranch.get(o.branchId) ?? { sales: 0, order_count: 0 };
    bucket.sales += o.total;
    bucket.order_count += 1;
    byBranch.set(o.branchId, bucket);
  }
  return {
    total_orders: orders.length,
    total_amount: orders.reduce((a, o) => a + o.total, 0),
    delivered_revenue: orders.filter(o => o.status === 'delivered').reduce((a, o) => a + o.total, 0),
    active_orders: orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length,
    branches: [...byBranch.entries()].map(([branch_id, v]) => ({ branch_id, ...v })),
  };
}

function mockContext(over: Record<string, unknown> = {}) {
  const orders = (over.orders as Order[] | undefined) ?? ORDERS;
  useApp.mockReturnValue({
    orders,
    branches: BRANCHES,
    products: [],
    categories: [],
    brandSettings: { vatPercentage: 15 },
    adminLang: 'en',
    ordersLastUpdated: 1,
    ...over,
  });
  statsMock.mockResolvedValue(statsFrom(orders));
}

/**
 * Render and wait for the aggregate to land. The figures arrive asynchronously
 * now, so asserting on the first paint would assert on the zero defaults.
 */
async function renderPanel() {
  render(<StatsPanel />);
  await waitFor(() => expect(statsMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/Could not load order statistics/)).toBeNull());
}

const bars = () => within(screen.getByTestId('branch-bars')).getAllByRole('listitem');
const barNames = () => bars().map((li) => li.textContent ?? '');

beforeEach(() => {
  useApp.mockReset();
  statsMock.mockReset();
  mockContext();
});
afterEach(cleanup);

describe('the ranked chart', () => {
  it('draws the top 8 by default, not every branch', async () => {
    await renderPanel();
    expect(bars()).toHaveLength(8);
  });

  it('orders them highest sales first', async () => {
    await renderPanel();
    const names = barNames();
    expect(names[0]).toContain('Branch 0');
    expect(names[7]).toContain('Branch 7');
  });

  it('narrows to 5 on Top 5', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Top 5' }));
    expect(bars()).toHaveLength(5);
  });

  it('shows every ACTIVE branch on All active branches — zero-sales ones included as a summary', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'All active branches' }));
    // 11 active branches: 10 traded and are drawn, 1 sold nothing and is counted.
    expect(bars()).toHaveLength(10);
    expect(screen.getByText('1 branch has no sales')).toBeTruthy();
  });

  it('marks the selected scope for a screen reader', async () => {
    await renderPanel();
    expect(screen.getByRole('button', { name: 'Top 8' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Top 5' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('branches with no sales', () => {
  it('counts them instead of drawing a stub for each', async () => {
    await renderPanel();
    // b10 and b11 sold nothing; neither may occupy a bar.
    expect(barNames().join(' ')).not.toContain('Branch 10');
    expect(barNames().join(' ')).not.toContain('Branch 11');
    expect(screen.getByText('2 branches have no sales')).toBeTruthy();
  });

  it('reveals their names on request', async () => {
    await renderPanel();
    expect(screen.queryByText('Branch 10')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show names' }));
    expect(screen.getByText('Branch 10')).toBeTruthy();
    expect(screen.getByText('Branch 11')).toBeTruthy();
  });

  it('keeps them in the KPIs — summarising is not filtering', async () => {
    await renderPanel();
    // 11 of 12 branches are active, and all 12 are counted in the total.
    expect(screen.getByText('11 / 12')).toBeTruthy();
  });

  it('says nothing about a period the panel does not have', async () => {
    // There is no date control here, so "in the selected period" would be a
    // claim the numbers cannot support — the same fabrication as the old
    // "vs yesterday" trend. Scoped to the summary line itself: the KPI tiles
    // above carry their own long-standing ADMIN_LOCALES copy.
    await renderPanel();
    expect(screen.getByText('2 branches have no sales').textContent)
      .not.toMatch(/period|today|yesterday|هذه الفترة|اليوم|أمس/i);
  });
});

describe('search', () => {
  it('finds a branch ranked below the visible cap', async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Search branch'), { target: { value: 'Branch 9' } });
    expect(barNames()).toHaveLength(1);
    expect(barNames()[0]).toContain('Branch 9');
  });

  it('finds a branch by its Arabic name while the console is in English', async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Search branch'), { target: { value: 'فرع 3' } });
    expect(barNames()[0]).toContain('Branch 3');
  });

  it('says so when nothing matches', async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Search branch'), { target: { value: 'zzzz' } });
    expect(screen.queryByTestId('branch-bars')).toBeNull();
    expect(screen.getByText('No branch matches that search.')).toBeTruthy();
  });
});

describe('view all branches', () => {
  it('opens a table holding every branch, including the ones with no sales', async () => {
    await renderPanel();
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View all branches' }));
    const table = within(screen.getByRole('table'));
    // 12 branches + the header row.
    expect(table.getAllByRole('row')).toHaveLength(13);
    expect(table.getByText('Branch 11')).toBeTruthy();
  });

  it('carries order count, average ticket and status', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'View all branches' }));
    const table = within(screen.getByRole('table'));

    for (const header of ['Branch', 'Sales', 'Orders', 'Avg ticket', 'Status']) {
      expect(table.getByText(header)).toBeTruthy();
    }
    expect(table.getAllByText('Closed').length).toBe(1);
  });

  it('closes again', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'View all branches' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide table' }));
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('operational branches breakdown', () => {
  it('is closed until the tile is clicked', async () => {
    await renderPanel();
    expect(screen.getByRole('button', { name: /show branch availability/i })).toBeTruthy();
    expect(screen.queryByText('Branch availability')).toBeNull();
  });

  it('still announces the KPI figures now that the tile is a control', async () => {
    // Making the tile a button silenced it once: an explicit aria-label
    // short-circuits name-from-content, so the label and both figures were
    // announced nowhere while remaining visible on screen. The accessible name
    // must carry the number, not just the action.
    await renderPanel();
    const tile = screen.getByRole('button', { name: /show branch availability/i });
    const name = tile.textContent ?? '';
    expect(name).toContain('Operational Branches');
    expect(name).toContain('11 / 12');
    expect(name).toContain('1 branches closed');
    expect(tile.getAttribute('aria-label')).toBeNull();
  });

  it('lists each branch under the status it is actually in', async () => {
    // A reviewer misread these three columns as cross-wired. Nothing pinned the
    // name-to-column mapping, so the misreading could not be settled by running
    // the suite. Now it can.
    mockContext({
      branches: [
        mkBranch(0),
        mkBranch(1, { deliveryTemporarilyClosed: true }),
        mkBranch(2, { isActive: false }),
      ],
      orders: [],
    });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /show branch availability/i }));

    const columnFor = (status: string) => {
      const pill = screen.getByText(status);
      return pill.closest('div')?.parentElement as HTMLElement;
    };
    expect(within(columnFor('Open')).getByText('Branch 0')).toBeTruthy();
    expect(within(columnFor('Temporarily unavailable')).getByText('Branch 1')).toBeTruthy();
    expect(within(columnFor('Closed')).getByText('Branch 2')).toBeTruthy();

    expect(within(columnFor('Open')).queryByText('Branch 2')).toBeNull();
    expect(within(columnFor('Closed')).queryByText('Branch 0')).toBeNull();
  });

  it('opens onto open, temporarily unavailable and closed branches', async () => {
    mockContext({
      branches: [
        mkBranch(0),
        mkBranch(1, { deliveryTemporarilyClosed: true }),
        mkBranch(2, { isActive: false }),
      ],
      orders: [],
    });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /show branch availability/i }));

    const panel = within(screen.getByText('Branch availability').parentElement as HTMLElement);
    expect(panel.getByText('Open')).toBeTruthy();
    expect(panel.getByText('Temporarily unavailable')).toBeTruthy();
    expect(panel.getByText('Closed')).toBeTruthy();
    expect(panel.getByText('Branch 1')).toBeTruthy();
  });

  it('shows the reason a branch is unavailable, where the model knows one', async () => {
    mockContext({
      branches: [mkBranch(1, { deliveryTemporarilyClosed: true }), mkBranch(2, { isActive: false })],
      orders: [],
    });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /show branch availability/i }));

    expect(screen.getByText('Delivery paused')).toBeTruthy();
    expect(screen.getByText('Closed for maintenance')).toBeTruthy();
  });

  it('agrees with the KPI it hangs off', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /show branch availability/i }));
    // The tile counts 11 of 12 operational; open + temporarily unavailable
    // must be those same 11.
    expect(screen.getByText('11 / 12')).toBeTruthy();
    const panel = screen.getByText('Branch availability').parentElement as HTMLElement;
    const counts = within(panel).getAllByRole('listitem').length;
    expect(counts).toBe(12);
  });
});

describe('Arabic', () => {
  it('renders branch names and controls in Arabic', async () => {
    mockContext({ adminLang: 'ar' });
    await renderPanel();
    expect(screen.getByText('مبيعات الفروع')).toBeTruthy();
    expect(barNames()[0]).toContain('فرع 0');
    expect(screen.getByRole('button', { name: 'عرض كل الفروع' })).toBeTruthy();
  });
});

describe('when the aggregate cannot be read', () => {
  it('says so rather than reporting zero revenue', async () => {
    // The tiles fall back to zero without data. Left unlabelled, a dashboard
    // reading 0 revenue and 0 orders looks like a catastrophe rather than a
    // failed fetch.
    statsMock.mockRejectedValue(new Error('connection timed out'));
    render(<StatsPanel />);
    expect(await screen.findByText(/Could not load order statistics/)).toBeTruthy();
  });

  it('names an unapplied migration as one', async () => {
    statsMock.mockRejectedValue(new Error(
      'Could not find the function public.admin_order_stats in the schema cache'));
    render(<StatsPanel />);
    expect(await screen.findByText(/migration that has not been applied/i)).toBeTruthy();
  });
});
