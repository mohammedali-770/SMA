// @vitest-environment jsdom
/**
 * Live Orders — focused regression tests for the panel's high-risk contracts.
 *
 * Not a re-test of the derivations (those are unit-tested in
 * `view/orders/ordersView.test.ts`). These cover the three things that can only
 * go wrong once the pieces are wired together, and each of which has a real
 * cost:
 *
 *   1. An accountant must not be able to move an order. The RLS policy is the
 *      real enforcement, but a UI that appears to work and then silently fails
 *      server-side is worse than one that never offered the control.
 *   2. Declining the unpaid-order confirmation must not move the order.
 *      Advancing an unpaid online order to "delivered" hands over food nobody
 *      was charged for.
 *   3. "View" on the verification queue must resolve the full order out of the
 *      in-memory realtime list — the queue row carries only safe summary
 *      fields, so opening it from the wrong source would show a partial receipt.
 *
 * The app context is mocked (no Supabase, no realtime, no provider tree). The
 * REAL `canTransitionOrder` is kept, because which options/actions are offered
 * is part of what is being checked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Order } from '../../types';

const useApp = vi.fn();
vi.mock('../../context/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/AppContext')>();
  return { ...actual, useApp: () => useApp() };
});

const posConfirmationRequired = vi.fn();
const paymentRecord = vi.fn();
vi.mock('../../lib/api', () => ({
  orders: { posConfirmationRequired: () => posConfirmationRequired() },
  paymentGateway: {
    record: (id: string) => paymentRecord(id),
    adminVerify: vi.fn(),
  },
}));

import { LiveOrdersPanel } from './LiveOrdersPanel';

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'SM-1042',
    lazywaitOrderNumber: null,
    customerId: 'c1',
    customerName: 'Nora Al-Harbi',
    customerPhone: '0551234567',
    branchId: 'b1',
    branchNameEn: 'Olaya',
    branchNameAr: 'العليا',
    orderType: 'delivery',
    status: 'received',
    paymentStatus: 'pending',
    paymentMethod: 'online',
    items: [],
    subtotal: 100,
    deliveryFee: 0,
    total: 100,
    createdAt: '2026-03-14T09:00:00.000Z',
    ...over,
  } as Order;
}

const updateOrderStatus = vi.fn();

function mockContext(over: Record<string, unknown> = {}) {
  useApp.mockReturnValue({
    orders: [makeOrder()],
    branches: [{ id: 'b1', nameEn: 'Olaya', nameAr: 'العليا', lazywaitBranchId: 'LW1' }],
    updateOrderStatus,
    brandSettings: { vatPercentage: 15 },
    currentUser: { role: 'admin' },
    adminLang: 'en',
    ...over,
  });
}

const openReceipt = async () => {
  const view = await screen.findAllByText('View Receipt');
  fireEvent.click(view[0]);
  return screen.findByRole('dialog');
};

beforeEach(() => {
  vi.clearAllMocks();
  posConfirmationRequired.mockResolvedValue({ total: 0, items: [] });
  paymentRecord.mockResolvedValue(null);
  mockContext();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('permission gate', () => {
  it('an accountant cannot change an order status', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockContext({ currentUser: { role: 'accountant' } });
    render(<LiveOrdersPanel />);
    await openReceipt();

    const select = screen.getByLabelText('Order status') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'preparing' } });
    expect(updateOrderStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('an admin can change an order status and cancel through the dedicated action', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LiveOrdersPanel />);
    await openReceipt();

    const select = screen.getByLabelText('Order status') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'preparing' } });
    expect(updateOrderStatus).toHaveBeenCalledWith('o1', 'preparing');

    updateOrderStatus.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(updateOrderStatus).toHaveBeenCalledWith('o1', 'cancelled');
  });
});

describe('unpaid-order confirmation', () => {
  const confirmWith = (answer: boolean) =>
    vi.spyOn(window, 'confirm').mockReturnValue(answer);

  it('DECLINING the prompt leaves the order untouched', async () => {
    const confirm = confirmWith(false);
    render(<LiveOrdersPanel />);
    await openReceipt();

    fireEvent.change(screen.getByLabelText('Order status'), { target: { value: 'preparing' } });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it('accepting the prompt advances the order', async () => {
    confirmWith(true);
    render(<LiveOrdersPanel />);
    await openReceipt();

    fireEvent.change(screen.getByLabelText('Order status'), { target: { value: 'preparing' } });
    expect(updateOrderStatus).toHaveBeenCalledWith('o1', 'preparing');
  });

  it('does NOT prompt for a paid order', async () => {
    const confirm = confirmWith(true);
    mockContext({ orders: [makeOrder({ paymentStatus: 'paid' })] });
    render(<LiveOrdersPanel />);
    await openReceipt();

    fireEvent.change(screen.getByLabelText('Order status'), { target: { value: 'preparing' } });
    expect(confirm).not.toHaveBeenCalled();
    expect(updateOrderStatus).toHaveBeenCalledWith('o1', 'preparing');
  });

  it('does NOT prompt for a CASH order — it is legitimately unpaid until collected', async () => {
    const confirm = confirmWith(true);
    mockContext({ orders: [makeOrder({ paymentMethod: 'cash' })] });
    render(<LiveOrdersPanel />);
    await openReceipt();

    fireEvent.change(screen.getByLabelText('Order status'), { target: { value: 'preparing' } });
    expect(confirm).not.toHaveBeenCalled();
    expect(updateOrderStatus).toHaveBeenCalledWith('o1', 'preparing');
  });

  it('uses only the dedicated cancellation confirmation for an unpaid order', async () => {
    const confirm = confirmWith(true);
    render(<LiveOrdersPanel />);
    await openReceipt();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus).toHaveBeenCalledWith('o1', 'cancelled');
  });
});

describe('the verification queue', () => {
  it('self-hides when nothing needs verification', async () => {
    render(<LiveOrdersPanel />);
    await screen.findByText('SM-1042');
    expect(screen.queryByText('Orders Requiring Verification')).toBeNull();
  });

  it('shows the queue with a count, and View opens the FULL in-memory order', async () => {
    posConfirmationRequired.mockResolvedValue({
      total: 1,
      items: [{
        id: 'o1', order_number: 'SM-1042', order_type: 'delivery', total: 100,
        created_at: '2026-03-14T09:00:00.000Z', pos_sync_started_at: null,
        first_pos_sync_failure_at: null, reason: 'timeout',
      }],
    });
    render(<LiveOrdersPanel />);
    expect(await screen.findByText('Orders Requiring Verification')).toBeTruthy();

    const buttons = await screen.findAllByText('View Receipt');
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Nora Al-Harbi');
    expect(dialog.textContent).toContain('0551234567');
  });

  it('a failed queue read hides the card rather than showing a broken one', async () => {
    posConfirmationRequired.mockRejectedValue(new Error('42501'));
    render(<LiveOrdersPanel />);
    await screen.findByText('SM-1042');
    await waitFor(() =>
      expect(screen.queryByText('Orders Requiring Verification')).toBeNull());
  });
});

describe('filtering', () => {
  it('opens on outstanding work, with everything else one click away', async () => {
    mockContext({
      orders: [makeOrder(), makeOrder({ id: 'o2', orderNumber: 'SM-1043', status: 'delivered' })],
    });
    render(<LiveOrdersPanel />);
    await screen.findByText('SM-1042');
    expect(screen.queryByText('SM-1043')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('SM-1042')).toBeTruthy();
    expect(screen.getByText('SM-1043')).toBeTruthy();
  });

  it('the status tabs filter the table', async () => {
    mockContext({
      orders: [makeOrder(), makeOrder({ id: 'o2', orderNumber: 'SM-1043', status: 'delivered' })],
    });
    render(<LiveOrdersPanel />);
    await screen.findByText('SM-1042');

    fireEvent.click(screen.getByRole('button', { name: 'delivered' }));
    expect(screen.queryByText('SM-1042')).toBeNull();
    expect(screen.getByText('SM-1043')).toBeTruthy();
  });

  it('caps the rendered rows and reveals the rest on demand', async () => {
    mockContext({
      orders: Array.from({ length: 120 }, (_, i) =>
        makeOrder({ id: `o${i}`, orderNumber: `SM-2${String(i).padStart(3, '0')}` })),
    });
    render(<LiveOrdersPanel />);
    await screen.findByText('SM-2000');

    expect(screen.getByText('SM-2049')).toBeTruthy();
    expect(screen.queryByText('SM-2050')).toBeNull();

    const older = screen.getByRole('button', { name: /Show older orders \(70 more\)/ });
    fireEvent.click(older);
    expect(screen.getByText('SM-2050')).toBeTruthy();
    expect(screen.queryByText('SM-2100')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show older orders \(20 more\)/ }));
    expect(screen.getByText('SM-2119')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show older orders/ })).toBeNull();
  });

  it('the search box matches the phone by raw digits', async () => {
    mockContext({
      orders: [makeOrder(), makeOrder({ id: 'o2', orderNumber: 'SM-1043', customerPhone: '0509999999' })],
    });
    render(<LiveOrdersPanel />);
    await screen.findByText('SM-1042');

    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: '0551234' } });
    expect(screen.getByText('SM-1042')).toBeTruthy();
    expect(screen.queryByText('SM-1043')).toBeNull();
  });

  it('says so plainly when nothing matches', async () => {
    render(<LiveOrdersPanel />);
    await screen.findByText('SM-1042');
    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'zzz' } });
    expect(screen.getByText('No incoming orders yet.')).toBeTruthy();
  });
});
