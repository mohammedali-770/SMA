/**
 * Branch sales derivation and ranking.
 *
 * The arithmetic here was lifted OUT of the render loop, so the first thing
 * this suite proves is that lifting it changed no number: a branch's sales are
 * still the sum of `total` over its orders, across every status, exactly as the
 * old inline chart summed them. That figure is deliberately NOT the revenue
 * KPI's delivered-only total, and the two have never matched — a "tidy-up"
 * that quietly aligned them would move a number on the dashboard.
 *
 * The rest is the scoping behaviour a reader cannot verify by eye: what Top 8
 * means when a search is active, and what happens to branches that sold
 * nothing.
 */
import { describe, expect, it } from 'vitest';

import type { Branch, Order } from '../../../../types';
import {
  DEFAULT_BRANCH_SCOPE, barPercent, branchStatusOf, buildBranchSalesRows, filterBranchRows,
  groupByStatus, maxSales, scopeBranchRows, selectBranchView, splitZeroSales,
} from './branchSales';

const mkBranch = (over: Partial<Branch> & { id: string }): Branch => ({
  nameEn: `Branch ${over.id}`, nameAr: `فرع ${over.id}`,
  addressEn: '', addressAr: '', phone: '', latitude: 0, longitude: 0,
  isActive: true, deliveryFee: 0, minDeliveryOrder: 0,
  ...over,
} as Branch);

const mkOrder = (branchId: string, total: number, over: Partial<Order> = {}): Order => ({
  id: `o-${branchId}-${total}-${over.status ?? 'x'}`, orderNumber: 'SM-1',
  customerId: 'c1', customerName: 'Nora', customerPhone: '0551234567',
  branchId, branchNameEn: '', branchNameAr: '',
  orderType: 'delivery', status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
  items: [], subtotal: total, deliveryFee: 0, total,
  orderSyncStatus: 'synced', createdAt: '2026-07-01T09:00:00.000Z',
  ...over,
} as Order);

describe('buildBranchSalesRows', () => {
  it('sums every order status, matching what the chart always summed', () => {
    const rows = buildBranchSalesRows(
      [mkBranch({ id: 'a' })],
      [
        mkOrder('a', 100, { status: 'delivered' }),
        mkOrder('a', 50, { status: 'cancelled' }),
        mkOrder('a', 25, { status: 'preparing' }),
      ],
    );
    expect(rows[0].sales).toBe(175);
    expect(rows[0].orderCount).toBe(3);
  });

  it('ignores orders belonging to other branches', () => {
    const rows = buildBranchSalesRows(
      [mkBranch({ id: 'a' }), mkBranch({ id: 'b' })],
      [mkOrder('a', 100), mkOrder('b', 40)],
    );
    expect(rows.find((r) => r.id === 'a')?.sales).toBe(100);
    expect(rows.find((r) => r.id === 'b')?.sales).toBe(40);
  });

  it('ignores an order pointing at a branch that is not in the list', () => {
    const rows = buildBranchSalesRows([mkBranch({ id: 'a' })], [mkOrder('ghost', 999)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sales).toBe(0);
  });

  it('ranks highest sales first', () => {
    const rows = buildBranchSalesRows(
      [mkBranch({ id: 'a' }), mkBranch({ id: 'b' }), mkBranch({ id: 'c' })],
      [mkOrder('a', 10), mkOrder('b', 300), mkOrder('c', 50)],
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties by name so the order does not reshuffle between renders', () => {
    const rows = buildBranchSalesRows(
      [
        mkBranch({ id: 'z', nameEn: 'Zulfi' }),
        mkBranch({ id: 'm', nameEn: 'Malaz' }),
        mkBranch({ id: 'o', nameEn: 'Olaya' }),
      ],
      [],
    );
    expect(rows.map((r) => r.nameEn)).toEqual(['Malaz', 'Olaya', 'Zulfi']);
  });

  it('averages the ticket the same way the headline KPI does', () => {
    const rows = buildBranchSalesRows([mkBranch({ id: 'a' })], [mkOrder('a', 100), mkOrder('a', 25)]);
    expect(rows[0].averageTicket).toBe(62.5);
  });

  it('reports a zero average rather than NaN for a branch with no orders', () => {
    const rows = buildBranchSalesRows([mkBranch({ id: 'a' })], []);
    expect(rows[0].averageTicket).toBe(0);
    expect(Number.isNaN(rows[0].averageTicket)).toBe(false);
  });

  it('rounds the average to two decimals', () => {
    const rows = buildBranchSalesRows(
      [mkBranch({ id: 'a' })],
      [mkOrder('a', 10), mkOrder('a', 10), mkOrder('a', 11)],
    );
    expect(rows[0].averageTicket).toBe(10.33);
  });
});

describe('branchStatusOf', () => {
  it('reads the two flags the branch model already has', () => {
    expect(branchStatusOf({ isActive: true, deliveryTemporarilyClosed: false })).toBe('open');
    expect(branchStatusOf({ isActive: true, deliveryTemporarilyClosed: true }))
      .toBe('temporarily_unavailable');
    expect(branchStatusOf({ isActive: false, deliveryTemporarilyClosed: false })).toBe('closed');
  });

  it('treats an inactive branch as closed even while delivery is paused', () => {
    // Closed is the stronger statement; reporting "temporarily unavailable"
    // for a branch that is switched off would understate it.
    expect(branchStatusOf({ isActive: false, deliveryTemporarilyClosed: true })).toBe('closed');
  });

  it('defaults the optional flag to open rather than undefined', () => {
    expect(branchStatusOf({ isActive: true, deliveryTemporarilyClosed: undefined })).toBe('open');
  });
});

describe('selectBranchView', () => {
  const branches = Array.from({ length: 12 }, (_, i) =>
    mkBranch({ id: `b${i}`, nameEn: `Branch ${i}`, isActive: i !== 11 }));
  // b0 sells most, b9 least; b10 (active) and b11 (inactive) sell nothing.
  const orders = Array.from({ length: 10 }, (_, i) => mkOrder(`b${i}`, (10 - i) * 100));
  const rows = buildBranchSalesRows(branches, orders);

  it('defaults to the top 8', () => {
    expect(DEFAULT_BRANCH_SCOPE).toBe('top8');
    expect(selectBranchView(rows, 'top8').bars).toHaveLength(8);
  });

  it('caps at 5 for Top 5', () => {
    expect(selectBranchView(rows, 'top5').bars.map((r) => r.id))
      .toEqual(['b0', 'b1', 'b2', 'b3', 'b4']);
  });

  it('draws every trading ACTIVE branch for the active scope', () => {
    const view = selectBranchView(rows, 'active');
    expect(view.bars).toHaveLength(10);
    expect(view.bars.some((r) => r.id === 'b11')).toBe(false);
  });

  it('keeps the ranking in every scope', () => {
    for (const scope of ['top5', 'top8', 'active'] as const) {
      const sales = selectBranchView(rows, scope).bars.map((r) => r.sales);
      expect([...sales].sort((a, b) => b - a)).toEqual(sales);
    }
  });

  it('never gives a bar to a branch that sold nothing', () => {
    for (const scope of ['top5', 'top8', 'active'] as const) {
      for (const bar of selectBranchView(rows, scope).bars) expect(bar.sales).toBeGreaterThan(0);
    }
  });

  it('counts ALL idle branches in scope — the cap limits bars, not the tally', () => {
    // The bug this pins: capping the pool first and splitting afterwards would
    // report only the idle branches that happened to survive the cap.
    const idle = Array.from({ length: 20 }, (_, i) => mkBranch({ id: `z${i}`, nameEn: `Zed ${i}` }));
    const few = buildBranchSalesRows(
      [mkBranch({ id: 'a' }), mkBranch({ id: 'b' }), mkBranch({ id: 'c' }), ...idle],
      [mkOrder('a', 300), mkOrder('b', 200), mkOrder('c', 100)],
    );
    const view = selectBranchView(few, 'top8');
    expect(view.bars).toHaveLength(3);
    expect(view.zeroSales).toHaveLength(20);
  });

  it('excludes inactive idle branches from the tally in the active scope', () => {
    expect(selectBranchView(rows, 'active').zeroSales.map((r) => r.id)).toEqual(['b10']);
    expect(selectBranchView(rows, 'top8').zeroSales.map((r) => r.id).sort()).toEqual(['b10', 'b11']);
  });

  it('finds a branch ranked below the cap — search filters BEFORE Top N', () => {
    // Capping first would tell an operator who typed a real branch name that
    // it does not exist, purely because it ranks 9th and Top 5 is selected.
    expect(selectBranchView(rows, 'top5', 'Branch 9').bars.map((r) => r.id)).toEqual(['b9']);
  });

  it('still caps a broad search', () => {
    expect(selectBranchView(rows, 'top5', 'Branch').bars).toHaveLength(5);
  });

  it('searches an inactive branch out of the active scope', () => {
    // Scope is a filter too — "All active branches" plus a search for a closed
    // one must stay empty rather than quietly widening the scope.
    expect(scopeBranchRows(rows, 'active', 'Branch 11')).toHaveLength(0);
    expect(scopeBranchRows(rows, 'top8', 'Branch 11').map((r) => r.id)).toEqual(['b11']);
  });

  it('returns nothing at all for a query that matches nothing', () => {
    const view = selectBranchView(rows, 'top8', 'zzzz');
    expect(view.bars).toHaveLength(0);
    expect(view.zeroSales).toHaveLength(0);
  });
});

describe('filterBranchRows', () => {
  const rows = buildBranchSalesRows(
    [mkBranch({ id: 'a', nameEn: 'Olaya', nameAr: 'العليا' })], [],
  );

  it('matches either language regardless of which is displayed', () => {
    expect(filterBranchRows(rows, 'olaya')).toHaveLength(1);
    expect(filterBranchRows(rows, 'العليا')).toHaveLength(1);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(filterBranchRows(rows, '  OLAYA  ')).toHaveLength(1);
  });

  it('returns everything for an empty query', () => {
    expect(filterBranchRows(rows, '')).toHaveLength(1);
    expect(filterBranchRows(rows, '   ')).toHaveLength(1);
  });
});

describe('splitZeroSales', () => {
  const rows = buildBranchSalesRows(
    [mkBranch({ id: 'a' }), mkBranch({ id: 'b' }), mkBranch({ id: 'c' })],
    [mkOrder('a', 100)],
  );

  it('separates the branches that sold nothing from the ones that did', () => {
    const { withSales, zeroSales } = splitZeroSales(rows);
    expect(withSales.map((r) => r.id)).toEqual(['a']);
    expect(zeroSales.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('does not remove them from the data it was given', () => {
    // The summary is a DRAWING decision. Every KPI above still counts these
    // branches, and the caller still holds them.
    splitZeroSales(rows);
    expect(rows).toHaveLength(3);
  });
});

describe('bar scale', () => {
  it('never divides by zero when nothing has sold', () => {
    expect(maxSales([])).toBe(1);
    const rows = buildBranchSalesRows([mkBranch({ id: 'a' })], []);
    expect(maxSales(rows)).toBe(1);
  });

  it('draws the leader full width', () => {
    expect(barPercent(500, 500)).toBe(100);
  });

  it('keeps a small but real total visible', () => {
    expect(barPercent(1, 10_000)).toBe(2);
  });

  it('gives a zero-sales branch NO bar', () => {
    // The old chart floored every bar at 12px, which is why twenty branches
    // that sold nothing looked like twenty branches that sold a little.
    expect(barPercent(0, 500)).toBe(0);
  });

  it('never exceeds the track', () => {
    expect(barPercent(900, 500)).toBe(100);
  });
});

describe('groupByStatus', () => {
  it('buckets branches by the state they are already in', () => {
    const rows = buildBranchSalesRows(
      [
        mkBranch({ id: 'open' }),
        mkBranch({ id: 'paused', deliveryTemporarilyClosed: true }),
        mkBranch({ id: 'shut', isActive: false }),
      ],
      [],
    );
    const groups = groupByStatus(rows);
    expect(groups.open.map((r) => r.id)).toEqual(['open']);
    expect(groups.temporarily_unavailable.map((r) => r.id)).toEqual(['paused']);
    expect(groups.closed.map((r) => r.id)).toEqual(['shut']);
  });

  it('accounts for every branch exactly once', () => {
    const rows = buildBranchSalesRows(
      Array.from({ length: 6 }, (_, i) => mkBranch({
        id: `b${i}`, isActive: i % 3 !== 0, deliveryTemporarilyClosed: i % 2 === 0,
      })),
      [],
    );
    const g = groupByStatus(rows);
    expect(g.open.length + g.temporarily_unavailable.length + g.closed.length).toBe(rows.length);
  });

  it('agrees with the Operational Branches KPI', () => {
    // The KPI counts `isActive`. Open + temporarily unavailable must be that
    // same set, or the tile and the panel it opens would disagree.
    const branches = [
      mkBranch({ id: 'a' }),
      mkBranch({ id: 'b', deliveryTemporarilyClosed: true }),
      mkBranch({ id: 'c', isActive: false }),
    ];
    const g = groupByStatus(buildBranchSalesRows(branches, []));
    expect(g.open.length + g.temporarily_unavailable.length)
      .toBe(branches.filter((b) => b.isActive).length);
  });
});
