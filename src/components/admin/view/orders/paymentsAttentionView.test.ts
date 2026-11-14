import { describe, expect, it } from 'vitest';

import type { PaymentsNeedingAttention } from '../../../../lib/api';
import { ADMIN_LOCALES } from '../../adminLocales';
import {
  ATTENTION_SECTION_ORDER,
  attentionFailure,
  attentionReasonKey,
  attentionSections,
  attentionTotal,
  hiddenCount,
} from './paymentsAttentionView';

const empty = (): PaymentsNeedingAttention => ({
  failed_refunds: { total: 0, items: [] },
  retrying_refunds: { total: 0, items: [] },
  payments_to_refund: { total: 0, items: [] },
  unconfirmed_payments: { total: 0, items: [] },
});

describe('which failed reads hide the card', () => {
  it('hides before the migration is applied and for a caller who is not an admin at AAL2', () => {
    expect(attentionFailure({ code: 'PGRST202' })).toBe('hidden');
    expect(attentionFailure({ code: '42501' })).toBe('hidden');
  });

  it('shows every other failure, because money may be owed', () => {
    expect(attentionFailure({ code: '57014' })).toBe('error');
    expect(attentionFailure(new Error('Failed to fetch'))).toBe('error');
    expect(attentionFailure(null)).toBe('error');
    expect(attentionFailure({ code: null })).toBe('error');
  });
});

describe('totals and sections', () => {
  it('adds the four totals, not the items returned', () => {
    const d = empty();
    d.failed_refunds.total = 3;
    d.retrying_refunds.total = 2;
    d.payments_to_refund.total = 1;
    d.unconfirmed_payments.total = 4;
    expect(attentionTotal(d)).toBe(10);
    expect(attentionTotal(null)).toBe(0);
  });

  it('lists the non-empty sections, money taken with nothing to show for it first', () => {
    const d = empty();
    expect(attentionSections(d)).toEqual([]);
    d.retrying_refunds.total = 1;
    d.unconfirmed_payments.total = 1;
    expect(attentionSections(d)).toEqual(['unconfirmed_payments', 'retrying_refunds']);
    expect(ATTENTION_SECTION_ORDER).toEqual([
      'unconfirmed_payments',
      'payments_to_refund',
      'failed_refunds',
      'retrying_refunds',
    ]);
  });

  it('counts the rows beyond the ones returned', () => {
    expect(hiddenCount({ total: 25, items: new Array(20) })).toBe(5);
    expect(hiddenCount({ total: 2, items: new Array(2) })).toBe(0);
    expect(hiddenCount(null)).toBe(0);
  });
});

describe('failure codes read as words', () => {
  // Every code the refund worker, the lease reaper and moyasarVerify.ts write.
  const known: Record<string, string> = {
    provider_no_answer: 'payattn_reason_provider_no_answer',
    reconcile_unavailable: 'payattn_reason_reconcile_unavailable',
    key_unavailable: 'payattn_reason_key_unavailable',
    moyasar_ip_not_allowed: 'payattn_reason_ip_not_allowed',
    http_429: 'payattn_reason_rate_limited',
    http_503: 'payattn_reason_server_error',
    http_500: 'payattn_reason_server_error',
    http_400: 'payattn_reason_refused',
    http_404: 'payattn_reason_refused',
    refund_not_final: 'payattn_reason_not_final',
    lease_expired: 'payattn_reason_lease_expired',
    missing_charge_reference: 'payattn_reason_no_payment_id',
    unsupported_provider: 'payattn_reason_old_provider',
    refund_ambiguous_needs_review: 'payattn_reason_ambiguous',
    refund_failed: 'payattn_reason_not_refundable',
    refund_voided: 'payattn_reason_not_refundable',
    payment_failed: 'payattn_reason_not_refundable',
    payment_voided: 'payattn_reason_not_refundable',
    finalize_failed: 'payattn_reason_order_not_created',
    confirm_failed: 'payattn_reason_order_not_paid',
  };

  it.each(Object.entries(known))('%s', (code, key) => {
    expect(attentionReasonKey(code)).toBe(key);
  });

  it('an unknown code is "Other", never dropped; no code is no reason', () => {
    expect(attentionReasonKey('something_new')).toBe('payattn_reason_other');
    expect(attentionReasonKey(null)).toBeNull();
    expect(attentionReasonKey('')).toBeNull();
  });

  it('every reason has English and Arabic, and they differ', () => {
    const keys = [...new Set([...Object.values(known), 'payattn_reason_other'])] as Array<
      keyof typeof ADMIN_LOCALES.en
    >;
    for (const k of keys) {
      expect(ADMIN_LOCALES.en[k], k).toBeTruthy();
      expect(ADMIN_LOCALES.ar[k], k).toBeTruthy();
      expect(ADMIN_LOCALES.ar[k], k).not.toBe(ADMIN_LOCALES.en[k]);
      expect(ADMIN_LOCALES.ar[k], k).toMatch(/[؀-ۿ]/);
    }
  });
});
