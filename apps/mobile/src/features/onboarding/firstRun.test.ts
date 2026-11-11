import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FIRST_RUN, firstRunNotificationStep, isCompletedForReview, shouldRegisterOnFirstRun,
  shouldRequestFirstRunPermissions, shouldRequestReview,
} from './firstRun';

describe('shouldRequestFirstRunPermissions', () => {
  it('spends the first run once, for a signed-in customer', () => {
    expect(shouldRequestFirstRunPermissions(DEFAULT_FIRST_RUN, true)).toBe(true);
  });
  it('never asks before sign-in — a granted notification permission is useless without an account to register', () => {
    expect(shouldRequestFirstRunPermissions(DEFAULT_FIRST_RUN, false)).toBe(false);
  });
  it('never asks twice — an iOS notification denial is permanent', () => {
    expect(shouldRequestFirstRunPermissions({ ...DEFAULT_FIRST_RUN, permissionsRequested: true }, true)).toBe(false);
  });
});

describe('firstRunNotificationStep — the consent screen comes before the OS prompt', () => {
  const askable = { granted: false, canAskAgain: true };
  const base = { state: DEFAULT_FIRST_RUN, signedIn: true, pushEnabled: true, permission: askable };

  it('offers the consent screen to a signed-in customer the OS can still ask', () => {
    expect(firstRunNotificationStep(base)).toBe('offer_consent');
  });

  it('never before sign-in', () => {
    expect(firstRunNotificationStep({ ...base, signedIn: false })).toBe('nothing');
  });

  it('never twice on a device — the storage key is unchanged, so nobody already through first run is re-asked', () => {
    expect(firstRunNotificationStep({ ...base, state: { ...DEFAULT_FIRST_RUN, permissionsRequested: true } }))
      .toBe('nothing');
  });

  it('never while the push kill switch is off', () => {
    expect(firstRunNotificationStep({ ...base, pushEnabled: false })).toBe('nothing');
  });

  it('not when permission is already granted: an existing customer, or Android 12 and older', () => {
    // Android 12 and older report `granted` from install, so the OS never asks
    // there. Those devices are told by the one-time consent NOTICE instead,
    // never registered again from here (shouldRegisterOnFirstRun).
    expect(firstRunNotificationStep({ ...base, permission: { granted: true, canAskAgain: true } })).toBe('nothing');
  });

  it('not when the OS would show nothing — a screen promising a prompt would be a dead end', () => {
    // Also the web build, whose mirror reports exactly this (pushRegistration.web.ts).
    expect(firstRunNotificationStep({ ...base, permission: { granted: false, canAskAgain: false } })).toBe('nothing');
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
    expect(shouldRequestReview({ ...base, state: { permissionsRequested: true, reviewAsked: true } })).toBe(false);
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

describe('shouldRegisterOnFirstRun', () => {
  it('registers a device that has never been granted permission', () => {
    expect(shouldRegisterOnFirstRun(false)).toBe(true);
  });

  it('NEVER re-registers a device that already holds permission', () => {
    // The regression this pins: the first-run flag is a new storage key, so
    // first run is also every EXISTING customer's next launch. Such a customer
    // already holds OS permission, so the permission call returns true without
    // showing anything — and register_push_device upserts `is_active = true`
    // with both preference columns. Registering here silently reactivated
    // devices customers had switched off and overwrote their promotions
    // choice. Marketing consent must only ever change by the customer's own
    // action in Profile.
    expect(shouldRegisterOnFirstRun(true)).toBe(false);
  });
});
