/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';

import { loyaltyEarnState, type LoyaltyEarnInput } from './loyaltyEarnState';

const order = (o: Partial<LoyaltyEarnInput>): LoyaltyEarnInput => ({
  status: 'received',
  paymentMethod: 'cash',
  paymentStatus: 'pending',
  loyaltyPointsEarned: 64,
  ...o,
});

describe('loyaltyEarnState', () => {
  it('is pending before the order is delivered', () => {
    for (const status of ['received', 'preparing', 'ready', 'out_for_delivery']) {
      expect(loyaltyEarnState(order({ status }))).toBe('pending');
    }
  });

  it('is credited once a cash order is delivered', () => {
    expect(loyaltyEarnState(order({ status: 'delivered' }))).toBe('credited');
  });

  it('treats a missing payment method as cash, not as online', () => {
    // One legacy order carries no method. Denying it would be a silent
    // regression; the server uses `is distinct from 'online'` for the same
    // reason.
    expect(loyaltyEarnState(order({ status: 'delivered', paymentMethod: null }))).toBe('credited');
    expect(loyaltyEarnState(order({ status: 'delivered', paymentMethod: undefined }))).toBe('credited');
  });

  it('stays PENDING for a delivered online order that was never paid', () => {
    // The review finding: staff can advance an unpaid online order past a
    // confirm dialog, and the server refuses to credit it. The receipt must not
    // claim otherwise.
    expect(
      loyaltyEarnState(order({ status: 'delivered', paymentMethod: 'online', paymentStatus: 'pending' })),
    ).toBe('pending');
  });

  it('credits a delivered online order once payment is recorded', () => {
    expect(
      loyaltyEarnState(order({ status: 'delivered', paymentMethod: 'online', paymentStatus: 'paid' })),
    ).toBe('credited');
  });

  it('forfeits a cancelled order, at every payment state', () => {
    expect(loyaltyEarnState(order({ status: 'cancelled' }))).toBe('forfeited');
    expect(
      loyaltyEarnState(order({ status: 'cancelled', paymentMethod: 'online', paymentStatus: 'paid' })),
    ).toBe('forfeited');
  });

  it('forfeits an order that earned nothing, so no row is rendered', () => {
    expect(loyaltyEarnState(order({ loyaltyPointsEarned: 0 }))).toBe('forfeited');
    expect(loyaltyEarnState(order({ status: 'delivered', loyaltyPointsEarned: 0 }))).toBe('forfeited');
  });
});
