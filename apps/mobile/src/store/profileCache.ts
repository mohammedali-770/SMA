/**
 * Profile cache policy — PURE and framework-free so the keep-on-failure /
 * clear-on-switch rules are unit-tested under Node (profileCache.test.ts) and
 * applied by AuthProvider.
 *
 * The rules this encodes:
 *  - A TRANSIENT fetch failure never downgrades a signed-in customer to
 *    "Guest" / 0 loyalty points: the last known profile stays until a
 *    confirmed refresh replaces it. (Points are never fabricated — only a
 *    successful fetch changes them.)
 *  - Sign-out clears the cache; a DIFFERENT user signing in clears it too, so
 *    one customer's profile/points can never leak into another's session.
 *  - A fetch result that raced a sign-out/user-switch is ignored (stale).
 */
import type { UserProfile } from '../types/models';

/**
 * Bounded backoff for transient profile-fetch failures. After the last delay
 * the cycle STOPS (no infinite loop); the next auth event or manual refresh
 * starts a fresh cycle.
 */
export const PROFILE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

/** Delay before retry `attempt` (1-based), or null when retries are exhausted. */
export function profileRetryDelayMs(attempt: number): number | null {
  return PROFILE_RETRY_DELAYS_MS[attempt - 1] ?? null;
}

export interface ProfileCache {
  /** The auth user the cached profile belongs to (null when signed out). */
  userId: string | null;
  profile: UserProfile | null;
}

export const EMPTY_PROFILE_CACHE: ProfileCache = { userId: null, profile: null };

export type ProfileEvent =
  | { type: 'signed_out' }
  | { type: 'auth_user'; userId: string }
  /** `profile: null` here is AUTHORITATIVE (the user has no profile row). */
  | { type: 'fetch_success'; userId: string; profile: UserProfile | null }
  /** Transient network/Supabase error — keep whatever is cached. */
  | { type: 'fetch_failure'; userId: string };

export function applyProfileEvent(state: ProfileCache, event: ProfileEvent): ProfileCache {
  switch (event.type) {
    case 'signed_out':
      return EMPTY_PROFILE_CACHE;
    case 'auth_user':
      // Same user (e.g. token refresh): keep the cached profile untouched.
      // Different user: drop the old profile immediately — never leak it.
      return event.userId === state.userId ? state : { userId: event.userId, profile: null };
    case 'fetch_success':
      // Ignore results that raced a sign-out or user switch.
      return event.userId === state.userId ? { userId: state.userId, profile: event.profile } : state;
    case 'fetch_failure':
      // Transient: the last known profile stays visible while retries run.
      return state;
  }
}
