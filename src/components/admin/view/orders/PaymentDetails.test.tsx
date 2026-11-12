// @vitest-environment jsdom
/**
 * The receipt's online-payment details, for a Moyasar payment and for the
 * historical rows of the gateway it replaced.
 *
 * This block used to render only rows whose provider was 'tap', so a Moyasar
 * payment, the only kind there will be, showed nothing at all: no payment id,
 * no card, and no Verify action for a paid-but-unconfirmed order. The nine Tap
 * attempts still in payment_records (none paid) stay visible, read-only, because
 * history is data.
 *
 * The payment API is mocked: no Supabase, no network.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbPaymentRecord } from '../../../../lib/api';
import type { Order } from '../../../../types';

const record = vi.fn();
const adminVerify = vi.fn();
vi.mock('../../../../lib/api', () => ({
  paymentGateway: {
    record: (orderId: string) => record(orderId),
    adminVerify: (orderId: string) => adminVerify(orderId),
  },
}));

import { PaymentDetails } from './PaymentDetails';

afterEach(cleanup);

const order = { id: 'o1', paymentMethod: 'online' } as Order;

function rec(over: Partial<DbPaymentRecord> = {}): DbPaymentRecord {
  return {
    id: 'r1',
    order_id: 'o1',
    provider: 'moyasar',
    provider_ref: 'pay_7f3a',
    status: 'initiated',
    amount: 42,
    currency: 'SAR',
    mode: 'live',
    card_scheme: 'mada',
    card_last_four: '4242',
    failure_code: null,
    failure_message_safe: null,
    confirmed_at: null,
    last_verified_at: null,
    created_at: '2026-11-11T12:00:00.000Z',
    ...over,
  };
}

function renderDetails({ isAccountant = false, o = order } = {}) {
  return render(<PaymentDetails order={o} isAccountant={isAccountant} isRTL={false} />);
}

beforeEach(() => {
  record.mockReset();
  adminVerify.mockReset();
});

describe('a Moyasar payment', () => {
  it('shows the provider, the payment id and the card', async () => {
    record.mockResolvedValue(rec());
    renderDetails();

    expect(await screen.findByText('Moyasar')).toBeTruthy();
    expect(screen.getByText('Payment ID')).toBeTruthy();
    expect(screen.getByText('pay_7f3a')).toBeTruthy();
    expect(screen.getByText('mada •••• 4242')).toBeTruthy();
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.queryByText('Charge ID')).toBeNull();
  });

  it('offers Verify while unpaid, and re-verifies through the server', async () => {
    record.mockResolvedValue(rec());
    adminVerify.mockResolvedValue({ status: 'paid' });
    renderDetails();

    expect(await screen.findByText('Re-verify via Moyasar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(adminVerify).toHaveBeenCalledWith('o1'));
    expect(await screen.findByText('Result: paid')).toBeTruthy();
    // The record is read again, so the receipt shows what the server now holds.
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('offers no Verify once paid', async () => {
    record.mockResolvedValue(rec({ status: 'paid' }));
    renderDetails();
    await screen.findByText('Moyasar');
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
  });

  it('offers no Verify to an accountant', async () => {
    record.mockResolvedValue(rec());
    renderDetails({ isAccountant: true });
    await screen.findByText('Moyasar');
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
  });
});

describe('a historical attempt with the previous gateway', () => {
  it('stays visible, labelled with its own provider, and read-only', async () => {
    record.mockResolvedValue(
      rec({ provider: 'tap', provider_ref: 'chg_TS02A', status: 'failed', mode: 'test' }),
    );
    renderDetails();

    expect(await screen.findByText('Tap')).toBeTruthy();
    expect(screen.getByText('chg_TS02A')).toBeTruthy();
    expect(screen.getByText(/no longer used/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.queryByText(/Re-verify/)).toBeNull();
  });
});

describe('an order with nothing to show', () => {
  it('renders nothing for a cash order', async () => {
    record.mockResolvedValue(rec());
    const { container } = renderDetails({ o: { id: 'o2', paymentMethod: 'cash' } as Order });
    await waitFor(() => expect(record).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('renders nothing when there is no payment record', async () => {
    record.mockResolvedValue(null);
    const { container } = renderDetails();
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
