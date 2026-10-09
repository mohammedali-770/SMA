import { describe, expect, it } from 'vitest';

import { chooseConsoleAudience, type ConsoleAudienceInput } from './consoleAudience';

/** A signed-in, settled, identity-known baseline. Each case overrides one part. */
const base: ConsoleAudienceInput = {
  authReady: true,
  isAuthenticated: true,
  profileUnavailable: false,
  identityKnown: true,
  dataLoading: false,
  role: 'customer',
};

const at = (over: Partial<ConsoleAudienceInput>) => chooseConsoleAudience({ ...base, ...over });

describe('console audience', () => {
  it('waits for auth before deciding anything', () => {
    // Every other field is deliberately set to a staff-looking identity to
    // prove authReady wins outright.
    expect(at({ authReady: false, role: 'admin' })).toBe('starting');
  });

  it('shows the sign-in form when there is no session', () => {
    expect(at({ isAuthenticated: false })).toBe('sign-in');
  });

  it('routes the two admin-console roles to the admin console', () => {
    expect(at({ role: 'admin' })).toBe('admin');
    expect(at({ role: 'accountant' })).toBe('admin');
  });

  it('routes the two branch-operations roles to the ops console', () => {
    expect(at({ role: 'branch_staff' })).toBe('ops');
    expect(at({ role: 'call_center' })).toBe('ops');
  });

  it('routes a real customer to the non-staff notice', () => {
    expect(at({ role: 'customer' })).toBe('non-staff');
  });

  // ---------------------------------------------------------------------
  // The regression this module exists for.
  // ---------------------------------------------------------------------

  it('NEVER reports an undetermined identity as non-staff', () => {
    // This is the whole point. Before the fix, `bootstrap` substituted a
    // role of `customer` for an unreadable profile, so each of these cases
    // produced `non-staff` -> window.location.replace('/app') and an
    // administrator was locked out of the dashboard.
    expect(at({ profileUnavailable: true })).toBe('profile-unavailable');
    expect(at({ profileUnavailable: true, role: 'admin' })).toBe('profile-unavailable');
    expect(at({ identityKnown: false })).toBe('profile-unavailable');
    expect(at({ identityKnown: false, role: 'customer' })).toBe('profile-unavailable');
  });

  it('answers the fault before the role, even when a role is present', () => {
    // A stale or half-written role must not win over an explicit fault: that
    // ordering is what stops a fault being re-described as an audience.
    for (const role of ['admin', 'accountant', 'branch_staff', 'call_center', 'customer']) {
      expect(at({ profileUnavailable: true, role })).toBe('profile-unavailable');
    }
  });

  it('treats the ordinary mid-sign-in window as loading, not as a fault', () => {
    // `bootstrap` sets isAuthenticated before reading the profile, so this
    // state happens on EVERY sign-in. Reporting it as a fault would flash the
    // error screen on the way in.
    expect(at({ identityKnown: false, dataLoading: true })).toBe('account-loading');
  });

  it('stops calling it loading once the load has settled', () => {
    // Settled with no identity and no explicit fault is still unknown, and
    // unknown must not become an audience.
    expect(at({ identityKnown: false, dataLoading: false })).toBe('profile-unavailable');
  });

  it('prefers an explicit fault over the loading window', () => {
    expect(at({ profileUnavailable: true, identityKnown: false, dataLoading: true })).toBe(
      'profile-unavailable',
    );
  });

  it('does not grant a console to an unknown or malformed role', () => {
    // A role outside the vocabulary is not staff, but it is a known identity,
    // so it gets the notice rather than a console.
    for (const role of ['', 'ADMIN', 'superuser', 'owner', null, undefined]) {
      expect(at({ role })).toBe('non-staff');
    }
  });

  it('never grants a console surface while the identity is unknown', () => {
    // Property form, over the whole input space that matters: no combination
    // of unknown identity may yield `admin` or `ops`.
    const flags = [true, false];
    const roles = ['admin', 'accountant', 'branch_staff', 'call_center', 'customer', null];
    for (const profileUnavailable of flags) {
      for (const dataLoading of flags) {
        for (const role of roles) {
          const got = at({ identityKnown: false, profileUnavailable, dataLoading, role });
          expect(['admin', 'ops']).not.toContain(got);
        }
      }
    }
  });
});
