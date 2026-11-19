import { STRINGS } from '../../i18n/strings';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_RESEND_LIMIT,
  confirmationPresentation,
  deriveCustomerOrderState,
  hasUsablePosRef,
  orderConfirmationState,
  posConfirmationChannelActive,
  type CustomerOrderState,
  type OrderConfirmationInput,
} from './orderConfirmation';

const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 60_000).toISOString();
const ALL: CustomerOrderState[] = [
  'payment_pending',
  'accepted_no_pos_channel',
  'accepted_no_pos_channel_unpaid',
  'sending_to_branch',
  'confirmed_by_branch',
  'verifying_with_branch',
  'branch_failed_retry_available',
  'unpaid_branch_failed_retry_available',
  'final_failure_refund_pending',
  'final_failure_refunded',
  'final_failure_refund_failed',
  'unpaid_final_failure',
  'order_cancelled',
];
function paid(over: Partial<OrderConfirmationInput> = {}): OrderConfirmationInput {
  return {
    orderType: 'pickup',
    paymentMethod: 'online',
    paymentStatus: 'paid',
    syncState: 'pending',
    ref: null,
    blockedReason: null,
    nextAttemptAt: null,
    posCreateAttemptedAt: null,
    customerRetryCount: 0,
    refundState: 'none',
    ...over,
  };
}
function cash(over: Partial<OrderConfirmationInput> = {}): OrderConfirmationInput {
  return paid({ paymentMethod: 'cash', paymentStatus: 'pending', ...over });
}

describe('reference and channel safety', () => {
  it('accepts only a trimmed non-empty POS ref', () => {
    expect(hasUsablePosRef('#12')).toBe(true);
    for (const v of [null, undefined, '', '   ', '\t\n', 12, {}, []]) expect(hasUsablePosRef(v)).toBe(false);
  });
  it('excludes only channels with no POS step', () => {
    expect(posConfirmationChannelActive('blocked', 'delivery_schema_unconfirmed')).toBe(false);
    expect(posConfirmationChannelActive('skipped', null)).toBe(false);
    expect(posConfirmationChannelActive(null, null)).toBe(false);
    expect(posConfirmationChannelActive('blocked', 'invalid_license')).toBe(true);
    expect(posConfirmationChannelActive('pending', null)).toBe(true);
  });
});

describe('presentation invariants', () => {
  it('claims success only after a usable branch confirmation', () => {
    for (const s of ALL) expect(confirmationPresentation(s).success, s).toBe(s === 'confirmed_by_branch');
  });
  // The number card is shown when a POS number is present OR still expected.
  // It must stay hidden on a channel with no POS step, which will never issue
  // one — promising it there is the delivery-confirmation copy bug.
  it('shows the branch-number card only where a number can exist', () => {
    const numbered = new Set<CustomerOrderState>([
      'sending_to_branch',
      'confirmed_by_branch',
      'verifying_with_branch',
    ]);
    for (const s of ALL) expect(confirmationPresentation(s).showBranchNumber, s).toBe(numbered.has(s));
  });
  it('never promises a branch number on a channel with no POS step', () => {
    for (const s of ['accepted_no_pos_channel', 'accepted_no_pos_channel_unpaid'] as CustomerOrderState[])
      expect(confirmationPresentation(s).showBranchNumber, s).toBe(false);
  });
  it('offers resend only from proven-not-sent states', () => {
    const resendable = new Set<CustomerOrderState>([
      'branch_failed_retry_available',
      'unpaid_branch_failed_retry_available',
    ]);
    for (const s of ALL) expect(confirmationPresentation(s).canResend, s).toBe(resendable.has(s));
  });
});

describe('manual-resend-only state derivation', () => {
  it('keeps only the current pending/syncing attempt in sending state', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'pending' }))).toBe('sending_to_branch');
    expect(deriveCustomerOrderState(paid({ syncState: 'syncing' }))).toBe('sending_to_branch');
  });
  it('never treats a failed row as an automatic retry, even with a legacy future timestamp', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'failed', nextAttemptAt: future() }))).toBe(
      'branch_failed_retry_available',
    );
    expect(deriveCustomerOrderState(cash({ syncState: 'failed', nextAttemptAt: future() }))).toBe(
      'unpaid_branch_failed_retry_available',
    );
  });
  it('offers manual resend immediately after proven failure', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'failed' }))).toBe('branch_failed_retry_available');
    expect(deriveCustomerOrderState(paid({ syncState: 'dead_letter' }))).toBe(
      'branch_failed_retry_available',
    );
  });
  it('moves to final outcome at the customer resend limit', () => {
    expect(
      deriveCustomerOrderState(paid({ syncState: 'failed', customerRetryCount: CUSTOMER_RESEND_LIMIT })),
    ).toBe('final_failure_refund_pending');
    expect(
      deriveCustomerOrderState(cash({ syncState: 'failed', customerRetryCount: CUSTOMER_RESEND_LIMIT })),
    ).toBe('unpaid_final_failure');
  });
});

describe('ambiguity and payment gates', () => {
  it('never resends a may-have-been-sent order', () => {
    for (const input of [
      paid({ syncState: 'confirmation_required' }),
      paid({ syncState: 'synced', ref: '' }),
      paid({ syncState: 'dead_letter', ref: '  ' }),
      paid({ syncState: 'dead_letter', posCreateAttemptedAt: past() }),
    ]) {
      const state = deriveCustomerOrderState(input);
      expect(state).toBe('verifying_with_branch');
      expect(confirmationPresentation(state).canResend).toBe(false);
    }
  });
  // SM-2026-000070 was synced as ticket #2 in 7.30 s with zero failed attempts,
  // and its customer was still shown "we could not verify whether the branch
  // received this order". pos_create_attempted_at is written IMMEDIATELY BEFORE
  // the POST leaves, so every in-flight order carries it; testing the marker
  // ahead of `syncing` made the alarming copy the default for any order checkout
  // returned on mid-send. The number is still expected, so the card stays.
  it('calls an in-flight send "sending", not "could not verify"', () => {
    const state = deriveCustomerOrderState(paid({ syncState: 'syncing', posCreateAttemptedAt: past() }));
    expect(state).toBe('sending_to_branch');
    const p = confirmationPresentation(state);
    expect(p.canResend).toBe(false);
    expect(p.tone).toBe('info');
    expect(p.showBranchNumber).toBe(true);
  });
  // A syncing row that already holds a ref is genuinely ambiguous, so `ref` must
  // stay AHEAD of the in-flight check.
  it('still verifies a syncing row that already holds a ref', () => {
    expect(
      deriveCustomerOrderState(paid({ syncState: 'syncing', ref: '#5', posCreateAttemptedAt: past() })),
    ).toBe('verifying_with_branch');
  });
  // And the marker is still ambiguous once the send is OVER — it outlived it.
  it('still verifies a marker that outlived its send', () => {
    for (const s of ['pending', 'failed', 'dead_letter'])
      expect(deriveCustomerOrderState(paid({ syncState: s, posCreateAttemptedAt: past() })), s).toBe(
        'verifying_with_branch',
      );
  });
  it('confirms only synced + usable ref', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'synced', ref: '#42' }))).toBe('confirmed_by_branch');
    expect(deriveCustomerOrderState(paid({ syncState: 'synced', ref: null }))).toBe('verifying_with_branch');
  });
  it('keeps unpaid online behind payment gate', () => {
    expect(deriveCustomerOrderState(paid({ paymentStatus: 'pending' }))).toBe('payment_pending');
  });
  it('keeps non-POS delivery neutral', () => {
    expect(
      deriveCustomerOrderState(
        paid({
          orderType: 'delivery',
          syncState: 'blocked',
          blockedReason: 'delivery_schema_unconfirmed',
          customerRetryCount: 9,
        }),
      ),
    ).toBe('accepted_no_pos_channel');
    expect(
      deriveCustomerOrderState(
        cash({ orderType: 'delivery', syncState: 'blocked', blockedReason: 'delivery_schema_unconfirmed' }),
      ),
    ).toBe('accepted_no_pos_channel_unpaid');
  });
});

describe('refund lifecycle and adapter', () => {
  it('reports provider-confirmed refund states honestly', () => {
    expect(deriveCustomerOrderState(paid({ refundState: 'processing' }))).toBe(
      'final_failure_refund_pending',
    );
    expect(deriveCustomerOrderState(paid({ refundState: 'refunded' }))).toBe('final_failure_refunded');
    expect(deriveCustomerOrderState(paid({ refundState: 'failed' }))).toBe('final_failure_refund_failed');
  });
  it('maps Order-shaped fields', () => {
    expect(
      orderConfirmationState({
        orderType: 'pickup',
        paymentMethod: 'online',
        paymentStatus: 'paid',
        lazywaitSyncState: 'synced',
        lazywaitRef: '#7',
        syncBlockedReason: null,
        syncNextAttemptAt: null,
        posCreateAttemptedAt: null,
        posCustomerRetryCount: 0,
        refundState: 'none',
      }),
    ).toBe('confirmed_by_branch');
  });
});

// Gap PG-03. A paid order that never reached the branch, cancelled and refunded
// by hand, still showed "Resend order", because the state ignored `status`.
// Each shape below would otherwise offer Resend, say "sending" or promise an
// automatic refund.
describe('cancelled orders (gap PG-03)', () => {
  type OrderShape = Parameters<typeof orderConfirmationState>[0];
  const order = (over: Partial<OrderShape> = {}): OrderShape => ({
    status: 'cancelled',
    orderType: 'pickup',
    paymentMethod: 'online',
    paymentStatus: 'paid',
    lazywaitSyncState: 'failed',
    lazywaitRef: null,
    syncBlockedReason: null,
    syncNextAttemptAt: null,
    posCreateAttemptedAt: null,
    posCustomerRetryCount: 0,
    refundState: 'none',
    ...over,
  });
  const SHAPES: Partial<OrderShape>[] = [
    {}, // paid, proven not sent: was branch_failed_retry_available
    { paymentMethod: 'cash', paymentStatus: 'pending' }, // cash, proven not sent: was unpaid_branch_failed_retry_available
    { lazywaitSyncState: 'dead_letter', posCustomerRetryCount: 3 }, // budget spent: was final_failure_refund_pending
    { lazywaitSyncState: 'pending' }, // queued: was sending_to_branch
    { lazywaitSyncState: 'synced', lazywaitRef: '#12' }, // at the branch: was confirmed_by_branch
    { paymentStatus: 'pending', lazywaitSyncState: 'awaiting_payment' }, // the July order-first orders: was payment_pending
    { lazywaitSyncState: 'blocked', syncBlockedReason: 'delivery_schema_unconfirmed' },
  ];
  it('is order_cancelled in every sync shape, and offers no Resend', () => {
    for (const s of SHAPES) {
      const state = orderConfirmationState(order(s));
      expect(state, JSON.stringify(s)).toBe('order_cancelled');
      expect(confirmationPresentation(state).canResend).toBe(false);
    }
  });
  it('reads as cancelled, never as success, and promises no branch number', () => {
    const p = confirmationPresentation('order_cancelled');
    expect(p.titleKey).toBe('oc_cancelled');
    expect(p.bodyKey).toBe('oc_cancelled_body');
    expect(p.tone).toBe('danger');
    expect(p.success).toBe(false);
    expect(p.showBranchNumber).toBe(false);
  });
  it('never promises an automatic refund the server will not make', () => {
    const state = orderConfirmationState(
      order({ lazywaitSyncState: 'dead_letter', posCustomerRetryCount: 3 }),
    );
    expect(state).not.toBe('final_failure_refund_pending');
    expect(confirmationPresentation(state).bodyKey).not.toBe('oc_failed_refund_pending_body');
  });
  // Changed 2026-11-19 (owner: "do the auto refund", 20261018120000). The
  // refund is still the story, but a cancelled order now says it was
  // CANCELLED with its refund. The POS-failure copy ("we could not send your
  // order because the ordering service is unavailable") is false for an order
  // the branch received and then cancelled.
  it('keeps a refund that exists as the story, told as a cancellation', () => {
    expect(orderConfirmationState(order({ refundState: 'pending' }))).toBe('cancelled_refund_pending');
    expect(orderConfirmationState(order({ refundState: 'processing' }))).toBe('cancelled_refund_pending');
    expect(orderConfirmationState(order({ refundState: 'refunded' }))).toBe('cancelled_refunded');
    expect(orderConfirmationState(order({ refundState: 'failed' }))).toBe('cancelled_refund_failed');
    for (const refundState of ['pending', 'processing', 'refunded', 'failed']) {
      const p = confirmationPresentation(orderConfirmationState(order({ refundState })));
      expect(p.titleKey).toBe('oc_cancelled');
      expect(p.bodyKey).toMatch(/^oc_cancelled_refund/);
      expect(p.canResend).toBe(false);
    }
  });

  it('the cancelled-refund copy never claims the order failed to send', () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const key of [
        'oc_cancelled_refund_pending_body',
        'oc_cancelled_refunded_body',
        'oc_cancelled_refund_failed_body',
      ] as const) {
        const text = STRINGS[lang][key];
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toMatch(/could not send|ordering service|تعذر إرسال|خدمة الطلبات/);
      }
    }
  });
  it('changes nothing for an order that is not cancelled', () => {
    for (const status of [
      'received',
      'preparing',
      'ready',
      'out_for_delivery',
      'delivered',
      null,
      undefined,
    ]) {
      for (const s of SHAPES) {
        const o = order({ ...s, status });
        expect(orderConfirmationState(o), `${status} ${JSON.stringify(s)}`).toBe(
          deriveCustomerOrderState({
            orderType: o.orderType,
            paymentMethod: o.paymentMethod,
            paymentStatus: o.paymentStatus,
            syncState: o.lazywaitSyncState,
            ref: o.lazywaitRef,
            blockedReason: o.syncBlockedReason,
            nextAttemptAt: o.syncNextAttemptAt,
            posCreateAttemptedAt: o.posCreateAttemptedAt,
            customerRetryCount: o.posCustomerRetryCount,
            refundState: o.refundState,
          }),
        );
      }
    }
    expect(orderConfirmationState(order({ status: 'received' }))).toBe('branch_failed_retry_available');
  });
  it('leaves the SQL mirror itself status-blind', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'failed' }))).toBe('branch_failed_retry_available');
  });
});
