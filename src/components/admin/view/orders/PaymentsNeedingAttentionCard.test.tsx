// @vitest-environment jsdom
/**
 * The "Refunds and payments needing attention" card (gaps PG-01 and PG-02).
 *
 * What only a render can show: every section a person has to act on appears
 * with its instruction and the Moyasar payment id to search for, in English
 * and in Arabic; the card is absent when nothing is owed, before its migration
 * is applied and for a non-admin; and a failed read is SAID rather than shown
 * as an empty card. Times are Riyadh time in Latin digits, like the receipts.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpcError, type PaymentsNeedingAttention } from '../../../../lib/api';

const gateway = vi.hoisted(() => ({ attention: vi.fn() }));
vi.mock('../../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/api')>()),
  paymentGateway: gateway,
}));

import { ADMIN_LOCALES } from '../../adminLocales';
import { PaymentsNeedingAttentionCard } from './PaymentsNeedingAttentionCard';

const NO_ARABIC_DIGITS = /^[^٠-٩۰-۹]*$/;

function owed(): PaymentsNeedingAttention {
  return {
    failed_refunds: {
      total: 1,
      items: [
        {
          id: 'r1',
          order_id: 'o-failed',
          order_number: 'SM-2026-000101',
          amount: 64,
          currency: 'SAR',
          attempt_count: 3,
          failure_code: 'lease_expired',
          last_error_safe: 'x',
          created_at: '2026-11-11T21:00:00Z',
          updated_at: '2026-11-11T21:30:00Z',
          payment_ref: 'pay_failed_1',
        },
      ],
    },
    retrying_refunds: {
      total: 3,
      items: [
        {
          id: 'r2',
          order_id: 'o-retry',
          order_number: 'SM-2026-000102',
          amount: 30,
          currency: 'SAR',
          attempt_count: 12,
          failure_code: 'moyasar_ip_not_allowed',
          last_error_safe: 'x',
          created_at: '2026-11-11T20:00:00Z',
          updated_at: '2026-11-11T21:55:00Z',
          payment_ref: 'pay_retry_1',
        },
      ],
    },
    payments_to_refund: {
      total: 2,
      items: [
        {
          id: 'p1',
          kind: 'duplicate_payment',
          order_id: 'o-dup',
          order_number: 'SM-2026-000103',
          amount: 45,
          currency: 'SAR',
          mode: 'live',
          failure_message_safe: 'x',
          payment_ref: 'pay_dup_1',
          created_at: '2026-11-11T19:00:00Z',
          last_verified_at: null,
        },
        {
          id: 'p2',
          kind: 'verification_mismatch',
          order_id: null,
          order_number: null,
          amount: 20,
          currency: 'SAR',
          mode: 'live',
          failure_message_safe: 'x',
          payment_ref: 'pay_mm_1',
          created_at: '2026-11-11T19:30:00Z',
          last_verified_at: null,
        },
      ],
    },
    unconfirmed_payments: {
      total: 1,
      items: [
        {
          payment_ref: 'pay_unconf_1',
          error: 'finalize_failed',
          order_id: null,
          order_number: null,
          payment_record_id: 'a1',
          amount: 52,
          currency: 'SAR',
          mode: 'live',
          log_count: 2,
          first_logged_at: '2026-11-11T21:29:00Z',
          last_logged_at: '2026-11-11T21:31:00Z',
        },
      ],
    },
  };
}

const nothing = (): PaymentsNeedingAttention => ({
  failed_refunds: { total: 0, items: [] },
  retrying_refunds: { total: 0, items: [] },
  payments_to_refund: { total: 0, items: [] },
  unconfirmed_payments: { total: 0, items: [] },
});

let zoneBefore: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  zoneBefore = process.env.TZ;
  process.env.TZ = 'Europe/London';
});
afterEach(() => {
  cleanup();
  if (zoneBefore === undefined) delete process.env.TZ;
  else process.env.TZ = zoneBefore;
});

describe('what staff are shown', () => {
  it('lists every section with its instruction and the payment id to search for', async () => {
    gateway.attention.mockResolvedValue(owed());
    render(<PaymentsNeedingAttentionCard adminLang="en" onView={() => {}} />);
    const card = await screen.findByRole('region', { name: 'Refunds and payments needing attention' });
    const t = ADMIN_LOCALES.en;

    // The badge counts every row, not only those returned.
    expect(within(card).getByText('7')).toBeTruthy();
    for (const [title, todo, total] of [
      [t.payattn_unconfirmed_title, t.payattn_unconfirmed_do, 1],
      [t.payattn_payments_title, t.payattn_payments_do, 2],
      [t.payattn_failed_title, t.payattn_failed_do, 1],
      [t.payattn_retrying_title, t.payattn_retrying_do, 3],
    ] as const) {
      const section = within(card).getByRole('region', { name: title });
      expect(within(section).getByText(`${title} (${total})`)).toBeTruthy();
      expect(within(section).getByText(todo)).toBeTruthy();
    }
    for (const ref of ['pay_failed_1', 'pay_retry_1', 'pay_dup_1', 'pay_mm_1', 'pay_unconf_1']) {
      expect(within(card).getByText(ref)).toBeTruthy();
    }
    // The instruction names the hand refund in Moyasar's dashboard.
    expect(t.payattn_payments_do).toMatch(/Moyasar's dashboard/);
    expect(t.payattn_failed_do).toMatch(/Moyasar's dashboard/);
    // The reasons read as words, with the attempts.
    expect(
      within(card).getByText(/The refund job stopped part-way; check Moyasar first · Attempts: 3/),
    ).toBeTruthy();
    expect(within(card).getByText(/Moyasar refused our address \(Allowed IPs\) · Attempts: 12/)).toBeTruthy();
    expect(within(card).getByText(/Charged twice/)).toBeTruthy();
    expect(within(card).getByText(/Did not match its checkout/)).toBeTruthy();
    expect(within(card).getByText(/The order could not be created · Times logged: 2/)).toBeTruthy();
    expect(within(card).getAllByText('No order')).toHaveLength(2);
    // Two more retrying refunds exist than were returned.
    expect(within(card).getByText('+2 more not shown')).toBeTruthy();
  });

  it('shows the same in Arabic, with Riyadh times in Latin digits', async () => {
    gateway.attention.mockResolvedValue(owed());
    render(<PaymentsNeedingAttentionCard adminLang="ar" onView={() => {}} />);
    const t = ADMIN_LOCALES.ar;
    const card = await screen.findByRole('region', { name: t.payattn_title });
    for (const key of [
      'payattn_unconfirmed_do',
      'payattn_payments_do',
      'payattn_failed_do',
      'payattn_retrying_do',
      'payattn_sub',
    ] as const) {
      expect(within(card).getByText(t[key])).toBeTruthy();
    }
    expect(within(card).getAllByText(/رقم الدفعة/).length).toBeGreaterThan(0);
    // 21:29 UTC on 11 November is 00:29 on the 12th in Riyadh; London would say 21:29.
    const line = within(card).getByText(/مرات التسجيل/);
    expect(line.textContent).toContain('2026-11-12 00:29');
    expect(line.textContent).toMatch(NO_ARABIC_DIGITS);
  });

  it('View opens the order, and only rows that have one offer it', async () => {
    gateway.attention.mockResolvedValue(owed());
    const onView = vi.fn();
    render(<PaymentsNeedingAttentionCard adminLang="en" onView={onView} />);
    const card = await screen.findByRole('region', { name: 'Refunds and payments needing attention' });
    // Five rows, two without an order.
    const views = within(card).getAllByText('View Receipt');
    expect(views).toHaveLength(3);
    fireEvent.click(
      within(within(card).getByRole('region', { name: 'Automatic refunds that stopped' })).getByText(
        'View Receipt',
      ),
    );
    expect(onView).toHaveBeenCalledWith('o-failed');
  });

  it('offers no refund, retry or dismiss action', async () => {
    gateway.attention.mockResolvedValue(owed());
    render(<PaymentsNeedingAttentionCard adminLang="en" onView={() => {}} />);
    const card = await screen.findByRole('region', { name: 'Refunds and payments needing attention' });
    const buttons = within(card)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(new Set(buttons)).toEqual(new Set(['View Receipt']));
  });
});

describe('when the card is not shown', () => {
  it('nothing is owed', async () => {
    gateway.attention.mockResolvedValue(nothing());
    const { container } = render(<PaymentsNeedingAttentionCard adminLang="en" onView={() => {}} />);
    await vi.waitFor(() => expect(gateway.attention).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.textContent).toBe('');
  });

  it.each([
    ['the migration is not applied yet', 'PGRST202'],
    ['the caller is not an admin at AAL2', '42501'],
  ])('%s', async (_label, code) => {
    gateway.attention.mockRejectedValue(new RpcError('refused', code));
    const { container } = render(<PaymentsNeedingAttentionCard adminLang="en" onView={() => {}} />);
    await vi.waitFor(() => expect(gateway.attention).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.textContent).toBe('');
  });

  it('any other failure is said, not hidden', async () => {
    gateway.attention.mockRejectedValue(
      new RpcError('canceling statement due to statement timeout', '57014'),
    );
    render(<PaymentsNeedingAttentionCard adminLang="en" onView={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_LOCALES.en.payattn_error);
  });
});
