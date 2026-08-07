// @vitest-environment jsdom
/**
 * Reports + Stats — focused regression tests for the two high-risk contracts in
 * the final Admin migration.
 *
 *   1. The CSV column headers are a MACHINE interface. Whoever imports
 *      `spicymeal_sales_by_day_….csv` into a spreadsheet or an accounting tool
 *      matches on those exact names, so a "tidy" rename during a restyle breaks
 *      a downstream nobody in this repo can see. The restyle deliberately left
 *      them alone — including their "(SAR)" suffixes — while dropping the
 *      suffix from the on-screen headers, where <Price> renders the glyph.
 *
 *   2. The stats derivations. Active orders EXCLUDE cancelled ones; revenue
 *      counts delivered ones only. Both are one operator away from being wrong
 *      in a way nobody notices until a number is quoted in a meeting.
 *
 * The app context is mocked (no Supabase, no realtime, no provider tree).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { riyadhMonthRange } from '../../utils/calculations';
import type { AdminOrderStats, DbReportOrder } from '../../lib/api';
import type { Branch, Order } from '../../types';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

// Neither panel reads `useApp().orders` any more. ReportsPanel fetches the
// window it is showing and StatsPanel reads a server-side aggregate, so the
// console no longer holds every order ever placed. Both feeds are mocked here.
const listForRangeMock = vi.fn();
const statsMock = vi.fn();
vi.mock('../../lib/api', async (importOriginal) => ({
  // Only the two feeds are stubbed. `isMissingFunctionError` is kept REAL,
  // because one of the cases below asserts on how it classifies a PostgREST
  // "function not found" message — stubbing it would test the stub.
  ...(await importOriginal<typeof import('../../lib/api')>()),
  orders: {
    listForRange: (from: string, to: string, branchId: string | null) =>
      listForRangeMock(from, to, branchId),
    stats: () => statsMock(),
  },
}));

import { ReportsPanel } from './ReportsPanel';
import { StatsPanel } from './StatsPanel';

const branch = { id: 'b1', nameEn: 'Olaya', nameAr: 'العليا', isActive: true } as Branch;

// Inside the panel's DEFAULT range (the current Riyadh month), so the fixture
// does not silently fall outside the filter and make every assertion vacuous.
const IN_RANGE_DATE = riyadhMonthRange().start;

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', orderNumber: 'SM-1', customerId: 'c1',
    customerName: 'Nora', customerPhone: '0551234567',
    branchId: 'b1', branchNameEn: 'Olaya', branchNameAr: 'العليا',
    orderType: 'delivery', status: 'delivered',
    paymentStatus: 'paid', paymentMethod: 'online',
    items: [], subtotal: 100, deliveryFee: 10, total: 110,
    orderSyncStatus: 'synced',
    createdAt: `${IN_RANGE_DATE}T09:00:00.000Z`,
    ...over,
  } as Order;
}

/** The fixture order in the shape `admin_list_orders_for_range` returns. */
function toDbReportOrder(o: Order): DbReportOrder {
  return {
    id: o.id, order_number: o.orderNumber,
    branch_id: o.branchId, branch_name_en: o.branchNameEn, branch_name_ar: o.branchNameAr,
    status: o.status, order_type: o.orderType,
    subtotal: o.subtotal, delivery_fee: o.deliveryFee,
    discount_amount: o.discountAmount ?? 0, loyalty_discount_amount: 0,
    vat_amount: 0, total: o.total,
    coupon_code: o.couponCode ?? null, created_at: o.createdAt,
    sync_status: 'synced', lazywait_ref: null, lazywait_order_number: null,
    sync_last_error: null, sync_blocked_reason: null,
    order_items: [],
  };
}

/** The same aggregate definitions `admin_order_stats` uses. */
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
  const orders = (over.orders as Order[] | undefined) ?? [makeOrder()];
  useApp.mockReturnValue({
    orders,
    branches: [branch],
    products: [],
    categories: [],
    brandSettings: { vatPercentage: 15 },
    adminLang: 'en',
    ordersLastUpdated: 1,
    ...over,
  });
  // Applies the SAME half-open window and branch predicate the server applies,
  // so a test asserting that an out-of-range order is absent still asserts
  // something — that the panel asks for the right window and renders only what
  // came back, rather than filtering a list it already held.
  listForRangeMock.mockImplementation(async (from: string, to: string, branchId: string | null) => {
    const rows = orders.filter(o =>
      o.createdAt >= from && o.createdAt < to
      && (branchId === null || o.branchId === branchId));
    return {
      row_count: rows.length, max_rows: 10000, limit_exceeded: false,
      orders: rows.map(toDbReportOrder),
    };
  });
  statsMock.mockResolvedValue(statsFrom(orders));
}

/** Render Reports and wait for its window to land. */
async function renderReports() {
  render(<ReportsPanel />);
  await waitFor(() => expect(listForRangeMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/Loading orders for this range/)).toBeNull());
}

/** Render Stats and wait for the aggregate to land. */
async function renderStats() {
  render(<StatsPanel />);
  await waitFor(() => expect(statsMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/Could not load order statistics/)).toBeNull());
}

/** Capture the CSV text handed to the Blob, without touching the filesystem. */
function captureCsv(): () => string {
  let captured = '';
  const RealBlob = globalThis.Blob;
  vi.stubGlobal('Blob', class extends RealBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      captured = String(parts[0]);
    }
  });
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:test', revokeObjectURL: () => {} });
  return () => captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CSV export — the machine contract', () => {
  const exportNow = () =>
    fireEvent.click(screen.getByRole('button', { name: /Export Active Audit CSV/i }));

  it('keeps the sales-by-day CSV column names EXACTLY', async () => {
    const csv = captureCsv();
    await renderReports();
    exportNow();
    expect(csv().split('\n')[0]).toBe(
      'Date,Orders Count,Subtotal (SAR),Delivery Fees (SAR),Discounts (SAR),Net Sales (SAR),VAT Amount (SAR)');
  });

  it('keeps the sales-by-branch CSV column names EXACTLY', async () => {
    const csv = captureCsv();
    await renderReports();
    fireEvent.change(screen.getByLabelText('Reporting Metric'), { target: { value: 'sales_by_branch' } });
    exportNow();
    expect(csv().split('\n')[0]).toBe(
      'Branch,Orders Count,Total Revenue (SAR),Delivery Fees (SAR),Average Ticket (SAR),Discounts (SAR)');
  });

  it('keeps the Lazywait audit CSV column names EXACTLY', async () => {
    const csv = captureCsv();
    await renderReports();
    fireEvent.change(screen.getByLabelText('Reporting Metric'), { target: { value: 'lazywait_report' } });
    exportNow();
    expect(csv().split('\n')[0]).toBe(
      'Order Number,Date,Branch,Total (SAR),Sync Status,Lazywait Reference,Error Log');
  });

  it('exports the row values, not just headers', async () => {
    const csv = captureCsv();
    await renderReports();
    exportNow();
    // One delivered order: total 110.00, subtotal 100.00, fee 10.00, no discount.
    expect(csv()).toContain(`${IN_RANGE_DATE},1,100.00,10.00,0.00,110.00,`);
  });
});

describe('report filtering', () => {
  it('does not render an order outside the requested window', async () => {
    const csv = captureCsv();
    mockContext({ orders: [makeOrder({ createdAt: '2020-01-01T09:00:00.000Z' })] });
    await renderReports();
    fireEvent.click(screen.getByRole('button', { name: /Export Active Audit CSV/i }));
    // Header only — the 2020 order is outside the current-month default range.
    expect(csv().split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('counts only DELIVERED orders in the revenue summary', async () => {
    // A cancelled order still sits in the date range; it must not be revenue.
    mockContext({ orders: [makeOrder(), makeOrder({ id: 'o2', status: 'cancelled', total: 999 })] });
    await renderReports();
    expect(screen.getByText('Filtered Sales Revenue')).toBeTruthy();
    expect(screen.queryByText(/999/)).toBeNull();
  });
});

describe('stats derivations', () => {
  it('active orders exclude delivered AND cancelled', async () => {
    mockContext({
      orders: [
        makeOrder({ id: 'a', status: 'preparing' }),
        makeOrder({ id: 'b', status: 'delivered' }),
        makeOrder({ id: 'c', status: 'cancelled' }),
      ],
    });
    await renderStats();
    expect(screen.getByText('Active')).toBeTruthy();
    // Anchored to the orders tile rather than matched as "some element whose
    // text is exactly 1". The panel legitimately renders other bare digits —
    // rank positions in the branch chart, counts in the availability
    // breakdown — and a global /^1$/ silently asserts whichever of them the
    // query happens to reach first.
    const ordersTile = screen.getByText('Total Active Orders').parentElement;
    expect(ordersTile?.textContent).toContain('1 Active');
    expect(screen.getByText('2 delivered or cancelled')).toBeTruthy();
  });

  it('no longer claims a hardcoded trend', async () => {
    // The revenue tile used to read "↑ 12.5% vs yesterday" — a literal, not a
    // calculation. A fabricated trend on the first tile is worse than none.
    await renderStats();
    expect(screen.queryByText(/12\.5%/)).toBeNull();
    expect(screen.queryByText(/vs yesterday/)).toBeNull();
  });

  it('counts only ACTIVE branches as operational', async () => {
    mockContext({
      branches: [branch, { ...branch, id: 'b2', nameEn: 'Malaz', isActive: false } as Branch],
    });
    await renderStats();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('1 branches closed')).toBeTruthy();
  });
});

describe('the migration this depends on', () => {
  // Merging the console half before the migration is applied is a real state:
  // the migration needs its own owner approval and does not ship with the
  // merge. PostgREST answers a missing RPC with "Could not find the function
  // … in the schema cache", which reads to an operator as a bug rather than as
  // a pending deployment step.
  it('says an unapplied migration is an unapplied migration', async () => {
    listForRangeMock.mockRejectedValue(new Error(
      'Could not find the function public.admin_list_orders_for_range(p_branch, p_from, p_to) in the schema cache'));
    render(<ReportsPanel />);
    expect(await screen.findByText(/migration that has not been applied/i)).toBeTruthy();
    expect(screen.queryByText(/schema cache/i)).toBeNull();
  });

  it('shows a genuine fault verbatim rather than blaming a migration', async () => {
    listForRangeMock.mockRejectedValue(new Error('connection timed out'));
    render(<ReportsPanel />);
    expect(await screen.findByText(/connection timed out/)).toBeTruthy();
    expect(screen.queryByText(/migration that has not been applied/i)).toBeNull();
  });

  it('refuses an over-large window instead of reporting on part of it', async () => {
    // The server returns NO orders above its ceiling. The panel must say why,
    // because every figure below it is about to render as zero.
    listForRangeMock.mockResolvedValue({
      row_count: 12345, max_rows: 10000, limit_exceeded: true, orders: [],
    });
    render(<ReportsPanel />);
    expect(await screen.findByText(/12345 orders, more than the 10000-order limit/)).toBeTruthy();
    expect(screen.getByText(/a truncated report looks correct/i)).toBeTruthy();
  });
});

describe('an incomplete date range', () => {
  const clearStart = () => {
    const input = screen.getByLabelText(/Start Date/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
  };

  it('does not crash the panel when the start date is cleared', async () => {
    // The bug: '' fails `reportEndDate < reportStartDate` when it is the START
    // that was cleared, so the value reached riyadhRangeToUtc and threw
    // `RangeError: Invalid time value` SYNCHRONOUSLY inside the effect — past
    // any .catch() — taking the whole reports view down.
    await renderReports();
    expect(() => clearStart()).not.toThrow();
    expect(screen.getByText(/Choose a valid start and end date/i)).toBeTruthy();
  });

  it('does not query the server for a half-typed range', async () => {
    await renderReports();
    listForRangeMock.mockClear();
    clearStart();
    expect(listForRangeMock).not.toHaveBeenCalled();
  });

  it('disables the export, so no CSV can be produced from no range', async () => {
    await renderReports();
    clearStart();
    expect(screen.getByRole('button', { name: /Export Active Audit CSV/i })
      .hasAttribute('disabled')).toBe(true);
  });
});

describe('changing the range while a fetch is in flight', () => {
  it('never exports one period\'s money under another period\'s filename', async () => {
    // The CSV filename is built from the SELECTED dates while the rows came from
    // the PREVIOUS fetch. On a slow connection that produced an audit export
    // whose name and contents disagreed — and it looked entirely valid.
    await renderReports();

    let release: (v: unknown) => void = () => {};
    listForRangeMock.mockImplementation(() => new Promise((res) => { release = res; }));

    fireEvent.change(screen.getByLabelText(/End Date/i) as HTMLInputElement,
      { target: { value: riyadhMonthRange().end } });
    fireEvent.change(screen.getByLabelText(/Start Date/i) as HTMLInputElement,
      { target: { value: '2026-01-01' } });

    // Mid-flight: the export is unavailable and the stale rows are gone.
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Export Active Audit CSV/i }).hasAttribute('disabled'),
    ).toBe(true));
    expect(screen.getByText(/Loading orders for this range/i)).toBeTruthy();

    release({ row_count: 0, max_rows: 10000, limit_exceeded: false, orders: [] });
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Export Active Audit CSV/i }).hasAttribute('disabled'),
    ).toBe(false));
  });

  it('disables the export when the range overflowed the server ceiling', async () => {
    // Every figure below renders zero in this state. Exporting it would produce
    // a CSV of zeros that looks like a real, empty period.
    listForRangeMock.mockResolvedValue({
      row_count: 12345, max_rows: 10000, limit_exceeded: true, orders: [],
    });
    render(<ReportsPanel />);
    await screen.findByText(/12345 orders, more than the 10000-order limit/);
    expect(screen.getByRole('button', { name: /Export Active Audit CSV/i })
      .hasAttribute('disabled')).toBe(true);
  });
});
