import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FIRST_RUN, isCompletedForReview, shouldRequestReview, shouldShowOnboarding,
} from './firstRun';

describe('shouldShowOnboarding', () => {
  it('shows once for a signed-in customer who has not seen it', () => {
    expect(shouldShowOnboarding(DEFAULT_FIRST_RUN, true)).toBe(true);
  });
  it('never shows before sign-in — the name needs a session to save to', () => {
    expect(shouldShowOnboarding(DEFAULT_FIRST_RUN, false)).toBe(false);
  });
  it('never shows twice', () => {
    expect(shouldShowOnboarding({ ...DEFAULT_FIRST_RUN, onboarded: true }, true)).toBe(false);
  });
});

describe('shouldRequestReview', () => {
  const base = { state: DEFAULT_FIRST_RUN, orderCompleted: true, leavingConfirmation: true, available: true };

  it('asks after a completed order, as the customer leaves the confirmation', () => {
    expect(shouldRequestReview(base)).toBe(true);
  });

  it('does NOT ask while the confirmation screen is still open', () => {
    // The customer is showing that screen to a cashier; a rating dialog would
    // sit on top of the order number.
    expect(shouldRequestReview({ ...base, leavingConfirmation: false })).toBe(false);
  });

  it('never asks twice', () => {
    expect(shouldRequestReview({ ...base, state: { onboarded: true, reviewAsked: true } })).toBe(false);
  });

  it('does not ask when the order did not complete', () => {
    expect(shouldRequestReview({ ...base, orderCompleted: false })).toBe(false);
  });

  it('does not ask when the OS says reviews are unavailable', () => {
    expect(shouldRequestReview({ ...base, available: false })).toBe(false);
  });
});

describe('isCompletedForReview', () => {
  it('counts an order the branch actually has', () => {
    expect(isCompletedForReview('delivered', 'synced')).toBe(true);
    expect(isCompletedForReview('received', 'synced')).toBe(true);
  });
  it('rejects an order still failing to reach the branch', () => {
    expect(isCompletedForReview('received', 'failed')).toBe(false);
    expect(isCompletedForReview('received', 'pending')).toBe(false);
  });
  it('rejects cancelled and missing statuses', () => {
    expect(isCompletedForReview('cancelled', 'synced')).toBe(false);
    expect(isCompletedForReview(null)).toBe(false);
    expect(isCompletedForReview(undefined)).toBe(false);
  });
});
