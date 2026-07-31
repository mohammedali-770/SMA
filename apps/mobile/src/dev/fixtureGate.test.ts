/**
 * The fixture gate is the only thing standing between a development preview and
 * production, so it is tested as a security control rather than a convenience:
 * every path that is not an explicit, valid, dev-only opt-in must be blocked.
 *
 * Framework-free — runs under Node per vitest.config.ts.
 */
import { describe, expect, it } from 'vitest';

import { FIXTURE_SCENES, resolveFixtureGate } from './fixtureGate';

describe('fixture gate — fails closed', () => {
  it('blocks in a production build even with a valid flag', () => {
    expect(resolveFixtureGate(false, 'checkout')).toEqual({
      allowed: false,
      reason: 'not-dev',
    });
  });

  it('blocks in production for every known scene', () => {
    for (const scene of FIXTURE_SCENES) {
      expect(resolveFixtureGate(false, scene).allowed).toBe(false);
    }
  });

  it('blocks when the flag is missing entirely', () => {
    expect(resolveFixtureGate(true, undefined)).toEqual({ allowed: false, reason: 'no-flag' });
    expect(resolveFixtureGate(true, null)).toEqual({ allowed: false, reason: 'no-flag' });
  });

  it('blocks an empty or whitespace-only flag', () => {
    expect(resolveFixtureGate(true, '').reason).toBe('no-flag');
    expect(resolveFixtureGate(true, '   ').reason).toBe('no-flag');
  });

  it('blocks an unknown scene rather than falling back to a default', () => {
    // There is deliberately no default scene: a typo must not open a fixture.
    expect(resolveFixtureGate(true, 'checkout ')).toEqual({ allowed: true, scene: 'checkout' });
    expect(resolveFixtureGate(true, 'chekout')).toEqual({ allowed: false, reason: 'unknown-scene' });
    expect(resolveFixtureGate(true, 'admin')).toEqual({ allowed: false, reason: 'unknown-scene' });
    expect(resolveFixtureGate(true, '1')).toEqual({ allowed: false, reason: 'unknown-scene' });
  });

  it('checks production BEFORE parsing the scene', () => {
    // A release build must never even reach scene resolution.
    expect(resolveFixtureGate(false, 'nonsense')).toEqual({ allowed: false, reason: 'not-dev' });
  });

  it('allows only an explicit, known scene in dev', () => {
    for (const scene of FIXTURE_SCENES) {
      expect(resolveFixtureGate(true, scene)).toEqual({ allowed: true, scene });
    }
  });

  it('exposes no scene that could be mistaken for a production route', () => {
    for (const scene of FIXTURE_SCENES) {
      expect(scene).not.toMatch(/^\//);
    }
  });

  it('has no scene for account deletion', () => {
    // DeleteAccountScreen calls accountDeletion.current() on mount and can
    // submit a REAL deletion request. It must never be reachable from a
    // fixture, at any stage of its flow.
    for (const scene of FIXTURE_SCENES) {
      expect(scene).not.toMatch(/delete|deletion/i);
    }
  });

  it('has no scene for the payment-return screen', () => {
    // app/payment/return.tsx exists to RESOLVE an interrupted charge: it
    // persists a session id and drives recoverPendingSession, which calls the
    // real payment-verify endpoint when a pending session is present. A fixture
    // must never be able to reach that, and the screen redirects within a frame
    // anyway — there is nothing to review. Verified on-device instead.
    for (const scene of FIXTURE_SCENES) {
      expect(scene).not.toMatch(/return/);
    }
  });
});
