import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_RESEND_LIMIT, confirmationPresentation, deriveCustomerOrderState,
  hasUsablePosRef, orderConfirmationState, posConfirmationChannelActive,
  type CustomerOrderState, type OrderConfirmationInput,
} from './orderConfirmation';

/**
 * PARITY CONTRACT — the case table below is mirrored verbatim in
 * supabase/tests/order_confirmation_state_machine_test.sql against the SQL
 * authority `customer_order_state()`. If a case changes here it MUST change
 * there in the same commit, or the app and the server will disagree about
 * whether a customer's order was placed.
 */

const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

/** Every state, so the presentation invariants below are exhaustive. */
const ALL_STATES: CustomerOrderState[] = [
  'payment_pending', 'accepted_no_pos_channel', 'accepted_no_pos_channel_unpaid',
  'sending_to_branch', 'confirmed_by_branch', 'verifying_with_branch',
  'branch_failed_retry_available', 'unpaid_branch_failed_retry_available',
  'final_failure_refund_pending', 'final_failure_refunded',
  'final_failure_refund_failed', 'unpaid_final_failure',
];

/** A paid, pickup, POS-integrated order in the given sync state. */
function paid(over: Partial<OrderConfirmationInput> = {}): OrderConfirmationInput {
  return {
    orderType: 'pickup', paymentMethod: 'online', paymentStatus: 'paid',
    syncState: 'pending', ref: null, blockedReason: null, nextAttemptAt: null,
    posCreateAttemptedAt: null, customerRetryCount: 0, refundState: 'none', ...over,
  };
}
function cash(over: Partial<OrderConfirmationInput> = {}): OrderConfirmationInput {
  return paid({ paymentMethod: 'cash', paymentStatus: 'pending', ...over });
}

describe('hasUsablePosRef', () => {
  it('accepts a trimmed non-empty string only', () => {
    expect(hasUsablePosRef('#12')).toBe(true);
    expect(hasUsablePosRef('  #12  ')).toBe(true);
  });

  it('rejects every shape that cannot prove confirmation', () => {
    for (const v of [null, undefined, '', '   ', '\t\n', 12, {}, []]) {
      expect(hasUsablePosRef(v)).toBe(false);
    }
  });
});

describe('posConfirmationChannelActive', () => {
  it('excludes the delivery channel while its POS schema is unconfirmed', () => {
    expect(posConfirmationChannelActive('blocked', 'delivery_schema_unconfirmed')).toBe(false);
  });

  it('excludes pre-integration rows', () => {
    expect(posConfirmationChannelActive('skipped', null)).toBe(false);
    expect(posConfirmationChannelActive(null, null)).toBe(false);
  });

  it('includes a blocked order whose reason is a real POS rejection', () => {
    // 'blocked' for a bad licence/mapping IS a branch failure and must stay in
    // the gate — only the delivery-schema reason means "no POS channel exists".
    expect(posConfirmationChannelActive('blocked', 'invalid_license')).toBe(true);
  });

  it('turns delivery gate-active as soon as it enqueues normally', () => {
    // The forward-compatibility property: when Lazywait ships the delivery API
    // and delivery starts enqueuing to 'pending' like pickup, no code changes.
    expect(posConfirmationChannelActive('pending', null)).toBe(true);
  });
});

describe('deriveCustomerOrderState — the core contradiction is impossible', () => {
  it('shows the success check for confirmed_by_branch and NOTHING else', () => {
    // The hard product rule: a green check may appear only when the branch has
    // actually accepted the order. Every other state — including the no-POS-channel
    // states, which merely acknowledge payment — must render neutral.
    for (const s of ALL_STATES) {
      expect(confirmationPresentation(s).success, s).toBe(s === 'confirmed_by_branch');
    }
  });

  it('renders the no-POS-channel states neutrally and claims no branch acceptance', () => {
    for (const s of ['accepted_no_pos_channel', 'accepted_no_pos_channel_unpaid'] as CustomerOrderState[]) {
      const p = confirmationPresentation(s);
      expect(p.success, s).toBe(false);
      expect(p.tone, s).toBe('info');          // neutral/informational, not success
      expect(p.canResend, s).toBe(false);
      expect(p.showBranchNumber, s).toBe(false);
      expect(p.bodyKey, s).toBe('oc_no_pos_channel_body');
    }
    // Payment success may be stated ONLY when payment actually happened.
    expect(confirmationPresentation('accepted_no_pos_channel').titleKey).toBe('oc_payment_received');
    expect(confirmationPresentation('accepted_no_pos_channel_unpaid').titleKey).toBe('oc_received');
  });

  it('only shows a branch order number in the confirmed state', () => {
    const ALL: CustomerOrderState[] = ALL_STATES;
    for (const s of ALL) {
      expect(confirmationPresentation(s).showBranchNumber, s).toBe(s === 'confirmed_by_branch');
    }
  });

  it('offers the resend only from proven-not-sent states', () => {
    const ALL: CustomerOrderState[] = ALL_STATES;
    const resendable = new Set<CustomerOrderState>([
      'branch_failed_retry_available', 'unpaid_branch_failed_retry_available',
    ]);
    for (const s of ALL) {
      expect(confirmationPresentation(s).canResend, s).toBe(resendable.has(s));
    }
  });
});

describe('deriveCustomerOrderState — payment gate', () => {
  it('never shows an order state for an unverified online payment', () => {
    expect(deriveCustomerOrderState(paid({ paymentStatus: 'pending' })))
      .toBe('payment_pending');
  });

  it('treats a cash order as ready to send without any payment gate', () => {
    expect(deriveCustomerOrderState(cash({ syncState: 'pending' })))
      .toBe('sending_to_branch');
  });
});

describe('deriveCustomerOrderState — branch acceptance gate', () => {
  it('confirms ONLY on synced with a usable reference', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'synced', ref: '#42' })))
      .toBe('confirmed_by_branch');
  });

  it('refuses to confirm a synced order with a blank reference', () => {
    // A 'synced' row without a usable ref is an inconsistent DB state; it is
    // never presented as confirmed.
    expect(deriveCustomerOrderState(paid({ syncState: 'synced', ref: '   ' })))
      .toBe('verifying_with_branch');
    expect(deriveCustomerOrderState(paid({ syncState: 'synced', ref: null })))
      .toBe('verifying_with_branch');
  });

  it('shows in-flight sends as sending, not as failure', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'pending' }))).toBe('sending_to_branch');
    expect(deriveCustomerOrderState(paid({ syncState: 'syncing' }))).toBe('sending_to_branch');
    // A queued automatic retry is still "sending" — the customer is not alarmed
    // while the system is still trying on its own.
    expect(deriveCustomerOrderState(paid({ syncState: 'failed', nextAttemptAt: future() })))
      .toBe('sending_to_branch');
  });

  it('offers the resend only once the automatic road runs out', () => {
    expect(deriveCustomerOrderState(paid({ syncState: 'failed', nextAttemptAt: past() })))
      .toBe('branch_failed_retry_available');
    expect(deriveCustomerOrderState(paid({ syncState: 'dead_letter' })))
      .toBe('branch_failed_retry_available');
  });
});

describe('deriveCustomerOrderState — ambiguous outcomes are never resendable', () => {
  // Lazywait Create Order has no idempotency key, so a resend for an order that
  // MAY have been sent could double the restaurant's ticket. Every ambiguous
  // shape must land in verifying_with_branch, whose presentation forbids resend.
  const ambiguous: Array<[string, OrderConfirmationInput]> = [
    ['confirmation_required state', paid({ syncState: 'confirmation_required' })],
    ['synced without a usable ref', paid({ syncState: 'synced', ref: '' })],
    ['an unusable ref marker on a failed row', paid({ syncState: 'dead_letter', ref: '  ' })],
    ['the may-have-been-sent marker', paid({ syncState: 'dead_letter', posCreateAttemptedAt: past() })],
  ];

  for (const [label, input] of ambiguous) {
    it(`routes ${label} to verification with no resend`, () => {
      const state = deriveCustomerOrderState(input);
      expect(state).toBe('verifying_with_branch');
      expect(confirmationPresentation(state).canResend).toBe(false);
      expect(confirmationPresentation(state).success).toBe(false);
    });
  }

  it('keeps ambiguity ahead of the retry budget', () => {
    // Even with the budget spent, an ambiguous order must NOT become a final
    // failure — that would auto-refund an order the branch may have accepted.
    expect(deriveCustomerOrderState(paid({
      syncState: 'confirmation_required', customerRetryCount: 9,
    }))).toBe('verifying_with_branch');
  });
});

describe('deriveCustomerOrderState — retry budget and terminal outcomes', () => {
  it('keeps offering the resend below the limit', () => {
    for (let n = 0; n < CUSTOMER_RESEND_LIMIT; n++) {
      expect(deriveCustomerOrderState(paid({ syncState: 'dead_letter', customerRetryCount: n })), `n=${n}`)
        .toBe('branch_failed_retry_available');
    }
  });

  it('moves a PAID order to the refund story once the budget is spent', () => {
    expect(deriveCustomerOrderState(paid({
      syncState: 'dead_letter', customerRetryCount: CUSTOMER_RESEND_LIMIT,
    }))).toBe('final_failure_refund_pending');
  });

  it('gives an UNPAID order the same apology with no refund language', () => {
    const state = deriveCustomerOrderState(cash({
      syncState: 'dead_letter', customerRetryCount: CUSTOMER_RESEND_LIMIT,
    }));
    expect(state).toBe('unpaid_final_failure');
    expect(confirmationPresentation(state).bodyKey).toBe('oc_failed_unpaid_body');
  });

  it('offers the resend to an unpaid order too', () => {
    expect(deriveCustomerOrderState(cash({ syncState: 'dead_letter' })))
      .toBe('unpaid_branch_failed_retry_available');
  });
});

describe('deriveCustomerOrderState — refund lifecycle', () => {
  it('reports refund progress without ever claiming premature completion', () => {
    expect(deriveCustomerOrderState(paid({ refundState: 'pending' })))
      .toBe('final_failure_refund_pending');
    expect(deriveCustomerOrderState(paid({ refundState: 'processing' })))
      .toBe('final_failure_refund_pending');
    expect(deriveCustomerOrderState(paid({ refundState: 'refunded' })))
      .toBe('final_failure_refunded');
    expect(deriveCustomerOrderState(paid({ refundState: 'failed' })))
      .toBe('final_failure_refund_failed');
  });

  it('never offers a resend once a refund has started', () => {
    for (const r of ['pending', 'processing', 'refunded', 'failed']) {
      const state = deriveCustomerOrderState(paid({ syncState: 'dead_letter', refundState: r }));
      expect(confirmationPresentation(state).canResend, r).toBe(false);
    }
  });
});

describe('deriveCustomerOrderState — channels without a branch step', () => {
  it('does not mark a delivery order unconfirmed or refundable', () => {
    // The regression this guards: gating delivery on Lazywait acceptance would
    // leave every delivery order permanently unconfirmed and auto-refunded.
    const delivery = paid({
      orderType: 'delivery', syncState: 'blocked',
      blockedReason: 'delivery_schema_unconfirmed', customerRetryCount: 9,
    });
    const state = deriveCustomerOrderState(delivery);
    expect(state).toBe('accepted_no_pos_channel');
    expect(confirmationPresentation(state).canResend).toBe(false);
    // Neutral, NOT a success check — the branch has confirmed nothing.
    expect(confirmationPresentation(state).success).toBe(false);
  });

  it('makes no payment claim for a CASH order with no POS channel', () => {
    // Cash on delivery lands here too; saying "Payment received" would be false.
    const cashDelivery = cash({
      orderType: 'delivery', syncState: 'blocked',
      blockedReason: 'delivery_schema_unconfirmed',
    });
    const state = deriveCustomerOrderState(cashDelivery);
    expect(state).toBe('accepted_no_pos_channel_unpaid');
    expect(confirmationPresentation(state).titleKey).toBe('oc_received');
  });

  it('treats a pre-integration skipped row as unpaid-safe too', () => {
    expect(deriveCustomerOrderState(cash({ syncState: 'skipped' })))
      .toBe('accepted_no_pos_channel_unpaid');
    expect(deriveCustomerOrderState(paid({ syncState: 'skipped' })))
      .toBe('accepted_no_pos_channel');
  });

  it('still gates an unpaid online delivery order behind payment', () => {
    expect(deriveCustomerOrderState(paid({
      orderType: 'delivery', paymentStatus: 'pending',
      syncState: 'blocked', blockedReason: 'delivery_schema_unconfirmed',
    }))).toBe('payment_pending');
  });
});

describe('orderConfirmationState — Order-shaped adapter', () => {
  it('maps the mobile Order field names onto the derivation', () => {
    expect(orderConfirmationState({
      orderType: 'pickup', paymentMethod: 'online', paymentStatus: 'paid',
      lazywaitSyncState: 'synced', lazywaitRef: '#7',
      syncBlockedReason: null, syncNextAttemptAt: null,
      posCreateAttemptedAt: null, posCustomerRetryCount: 0, refundState: 'none',
    })).toBe('confirmed_by_branch');
  });

  it('defaults a legacy row with no new columns to a safe state', () => {
    // Rows written before this migration have no retry count / refund state.
    expect(orderConfirmationState({
      orderType: 'pickup', paymentMethod: 'cash', paymentStatus: 'pending',
      lazywaitSyncState: 'pending',
    })).toBe('sending_to_branch');
  });
});
