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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { riyadhMonthRange } from '../../utils/calculations';
import type { Branch, Order } from '../../types';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
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

function mockContext(over: Record<string, unknown> = {}) {
  useApp.mockReturnValue({
    orders: [makeOrder()],
    branches: [branch],
    products: [],
    categories: [],
    brandSettings: { vatPercentage: 15 },
    adminLang: 'en',
    ...over,
  });
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

  it('keeps the sales-by-day CSV column names EXACTLY', () => {
    const csv = captureCsv();
    render(<ReportsPanel />);
    exportNow();
    expect(csv().split('\n')[0]).toBe(
      'Date,Orders Count,Subtotal (SAR),Delivery Fees (SAR),Discounts (SAR),Net Sales (SAR),VAT Amount (SAR)');
  });

  it('keeps the sales-by-branch CSV column names EXACTLY', () => {
    const csv = captureCsv();
    render(<ReportsPanel />);
    fireEvent.change(screen.getByLabelText('Reporting Metric'), { target: { value: 'sales_by_branch' } });
    exportNow();
    expect(csv().split('\n')[0]).toBe(
      'Branch,Orders Count,Total Revenue (SAR),Delivery Fees (SAR),Average Ticket (SAR),Discounts (SAR)');
  });

  it('keeps the Lazywait audit CSV column names EXACTLY', () => {
    const csv = captureCsv();
    render(<ReportsPanel />);
    fireEvent.change(screen.getByLabelText('Reporting Metric'), { target: { value: 'lazywait_report' } });
    exportNow();
    expect(csv().split('\n')[0]).toBe(
      'Order Number,Date,Branch,Total (SAR),Sync Status,Lazywait Reference,Error Log');
  });

  it('exports the row values, not just headers', () => {
    const csv = captureCsv();
    render(<ReportsPanel />);
    exportNow();
    // One delivered order: total 110.00, subtotal 100.00, fee 10.00, no discount.
    expect(csv()).toContain(`${IN_RANGE_DATE},1,100.00,10.00,0.00,110.00,`);
  });
});

describe('report filtering', () => {
  it('excludes orders outside the date range', () => {
    const csv = captureCsv();
    mockContext({ orders: [makeOrder({ createdAt: '2020-01-01T09:00:00.000Z' })] });
    render(<ReportsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Export Active Audit CSV/i }));
    // Header only — the 2020 order is outside the current-month default range.
    expect(csv().split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('counts only DELIVERED orders in the revenue summary', () => {
    // A cancelled order still sits in the date range; it must not be revenue.
    mockContext({ orders: [makeOrder(), makeOrder({ id: 'o2', status: 'cancelled', total: 999 })] });
    render(<ReportsPanel />);
    expect(screen.getByText('Filtered Sales Revenue')).toBeTruthy();
    expect(screen.queryByText(/999/)).toBeNull();
  });
});

describe('stats derivations', () => {
  it('active orders exclude delivered AND cancelled', () => {
    mockContext({
      orders: [
        makeOrder({ id: 'a', status: 'preparing' }),
        makeOrder({ id: 'b', status: 'delivered' }),
        makeOrder({ id: 'c', status: 'cancelled' }),
      ],
    });
    render(<StatsPanel />);
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText(/^1$/)).toBeTruthy();
    expect(screen.getByText('2 delivered or cancelled')).toBeTruthy();
  });

  it('no longer claims a hardcoded trend', () => {
    // The revenue tile used to read "↑ 12.5% vs yesterday" — a literal, not a
    // calculation. A fabricated trend on the first tile is worse than none.
    render(<StatsPanel />);
    expect(screen.queryByText(/12\.5%/)).toBeNull();
    expect(screen.queryByText(/vs yesterday/)).toBeNull();
  });

  it('counts only ACTIVE branches as operational', () => {
    mockContext({
      branches: [branch, { ...branch, id: 'b2', nameEn: 'Malaz', isActive: false } as Branch],
    });
    render(<StatsPanel />);
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('1 branches closed')).toBeTruthy();
  });
});
