import { describe, expect, it } from 'vitest';

import {
  applyProfileEvent,
  EMPTY_PROFILE_CACHE,
  PROFILE_RETRY_DELAYS_MS,
  profileRetryDelayMs,
  type ProfileCache,
} from './profileCache';
import type { UserProfile } from '../types/models';

function profile(id: string, points = 120): UserProfile {
  return { id, fullName: `User ${id}`, phoneNumber: '05', role: 'customer', loyaltyPoints: points, phoneVerified: true };
}

const CACHED: ProfileCache = { userId: 'u1', profile: profile('u1') };

describe('applyProfileEvent', () => {
  it('fetch success stores the profile for the current user', () => {
    const s = applyProfileEvent({ userId: 'u1', profile: null }, { type: 'fetch_success', userId: 'u1', profile: profile('u1') });
    expect(s.profile?.id).toBe('u1');
  });

  it('TRANSIENT failure keeps the previous profile (no Guest / 0-points downgrade)', () => {
    const s = applyProfileEvent(CACHED, { type: 'fetch_failure', userId: 'u1' });
    expect(s).toBe(CACHED); // untouched — loyaltyPoints preserved
    expect(s.profile?.loyaltyPoints).toBe(120);
  });

  it('failure with NO previous profile stays at the safe null fallback', () => {
    const empty: ProfileCache = { userId: 'u1', profile: null };
    expect(applyProfileEvent(empty, { type: 'fetch_failure', userId: 'u1' }).profile).toBeNull();
  });

  it('an authoritative "no profile row" success clears the cache (not treated as transient)', () => {
    const s = applyProfileEvent(CACHED, { type: 'fetch_success', userId: 'u1', profile: null });
    expect(s.profile).toBeNull();
  });

  it('sign-out clears the cache', () => {
    expect(applyProfileEvent(CACHED, { type: 'signed_out' })).toEqual(EMPTY_PROFILE_CACHE);
  });

  it('same-user auth event (token refresh) keeps the cached profile untouched', () => {
    expect(applyProfileEvent(CACHED, { type: 'auth_user', userId: 'u1' })).toBe(CACHED);
  });

  it('USER SWITCH clears the old profile immediately (no leak across accounts)', () => {
    const s = applyProfileEvent(CACHED, { type: 'auth_user', userId: 'u2' });
    expect(s).toEqual({ userId: 'u2', profile: null });
  });

  it('a stale fetch result from the PREVIOUS user is ignored after a switch', () => {
    const afterSwitch = applyProfileEvent(CACHED, { type: 'auth_user', userId: 'u2' });
    const s = applyProfileEvent(afterSwitch, { type: 'fetch_success', userId: 'u1', profile: profile('u1') });
    expect(s.profile).toBeNull(); // u1's late response never lands on u2's session
  });
});

describe('profileRetryDelayMs', () => {
  it('backs off through the schedule then STOPS (never loops forever)', () => {
    const delays = [1, 2, 3].map(profileRetryDelayMs);
    expect(delays).toEqual([...PROFILE_RETRY_DELAYS_MS]);
    expect(profileRetryDelayMs(4)).toBeNull();
    expect(profileRetryDelayMs(99)).toBeNull();
  });
  it('delays grow and stay gentle (≥2s)', () => {
    expect(PROFILE_RETRY_DELAYS_MS[0]).toBeGreaterThanOrEqual(2000);
    expect([...PROFILE_RETRY_DELAYS_MS]).toEqual([...PROFILE_RETRY_DELAYS_MS].slice().sort((a, b) => a - b));
  });
});
