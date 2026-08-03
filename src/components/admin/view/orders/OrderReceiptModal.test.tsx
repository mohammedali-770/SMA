// @vitest-environment jsdom
/**
 * Order receipt — the customer note contract.
 *
 * `orders.notes` has existed since the first orders migration, and the staff RPC
 * `admin_list_orders_with_items` has always returned it. But it was never mapped
 * into the admin `Order` type and nothing rendered it, so a customer's free-text
 * instruction reached nobody. The POS handoff does not carry it either, which
 * makes this modal the ONLY place the text can reach a human.
 *
 * The realistic worst case for this field is an unread allergy, so these tests
 * pin the behaviour rather than the styling: the note is rendered, it is rendered
 * verbatim, and a note that is only whitespace does not produce an empty panel
 * that reads as "no special instructions".
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Branch, Order } from '../../../../types';

import { OrderReceiptModal } from './OrderReceiptModal';

afterEach(cleanup);

const baseOrder: Order = {
  id: 'o1',
  orderNumber: 'SM-2026-000001',
  customerId: 'u1',
  customerName: 'Test Customer',
  customerPhone: '+966500000000',
  branchId: 'b1',
  branchNameEn: 'Main',
  branchNameAr: 'الرئيسي',
  status: 'received',
  orderType: 'pickup',
  subtotal: 100,
  deliveryFee: 0,
  total: 100,
  paymentStatus: 'paid',
  orderSyncStatus: 'synced',
  createdAt: '2026-08-03T10:00:00.000Z',
  items: [
    {
      id: 'i1',
      productId: 'p1',
      nameEn: 'Burger',
      nameAr: 'برجر',
      price: 100,
      quantity: 1,
      selectedModifiers: [],
    },
  ],
};

function renderReceipt(over: Partial<Order> = {}) {
  const branches: Branch[] = [];
  return render(
    <OrderReceiptModal
      order={{ ...baseOrder, ...over }}
      branches={branches}
      isRTL={false}
      adminLang="en"
      isAccountant={false}
      vatPercentage={15}
      methodLabelText={() => 'Cash'}
      paymentBadgeText={() => 'Paid'}
      paymentWarning={() => null}
      phoneLabel={(p) => p ?? ''}
      onStatusChange={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('OrderReceiptModal — customer note', () => {
  it('renders the note so a staff member can act on it', () => {
    renderReceipt({ notes: 'SEVERE NUT ALLERGY - no peanut oil' });

    expect(screen.getByText('Customer note:')).toBeTruthy();
    expect(screen.getByText('SEVERE NUT ALLERGY - no peanut oil')).toBeTruthy();
  });

  it('renders the note verbatim rather than summarising or truncating it', () => {
    // Multi-line instructions are normal here (door codes, allergy + preference).
    const note = 'No onions.\nRing the bell twice.\nGate code 4471.';
    renderReceipt({ notes: note });

    const el = screen.getByText((_, node) => node?.textContent === note);
    expect(el).toBeTruthy();
  });

  it('shows no note panel when the order has none', () => {
    // The whitespace-only case is handled upstream in mapOrder, which trims to
    // undefined so an empty highlighted panel — which reads as a real instruction
    // the reader failed to parse — never reaches this component. See mappers.test.ts.
    renderReceipt({ notes: undefined });

    expect(screen.queryByText('Customer note:')).toBeNull();
  });
});
