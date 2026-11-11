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
 *
 * The payment API is mocked. The receipt's payment block reads the order's
 * payment record on mount, and without the mock that read went to Supabase from
 * jsdom on every test here.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Branch, Order } from '../../../../types';

const paymentRecord = vi.fn();
vi.mock('../../../../lib/api', () => ({
  paymentGateway: { record: (orderId: string) => paymentRecord(orderId), adminVerify: vi.fn() },
}));

import { OrderReceiptModal } from './OrderReceiptModal';

afterEach(() => {
  cleanup();
  paymentRecord.mockReset();
});

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

describe('OrderReceiptModal — online payment details', () => {
  it("shows a Moyasar payment's details inside the receipt", async () => {
    paymentRecord.mockResolvedValue({
      id: 'r1',
      order_id: 'o1',
      provider: 'moyasar',
      provider_ref: 'pay_7f3a',
      status: 'paid',
      amount: 100,
      currency: 'SAR',
      mode: 'live',
      card_scheme: 'mada',
      card_last_four: '4242',
      failure_code: null,
      failure_message_safe: null,
      confirmed_at: '2026-08-03T10:01:00.000Z',
      last_verified_at: '2026-08-03T10:01:00.000Z',
      created_at: '2026-08-03T10:00:30.000Z',
    });
    renderReceipt({ paymentMethod: 'online' });

    expect(await screen.findByText('Moyasar')).toBeTruthy();
    expect(screen.getByText('pay_7f3a')).toBeTruthy();
    expect(paymentRecord).toHaveBeenCalledWith('o1');
  });
});
