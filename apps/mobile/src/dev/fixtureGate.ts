/**
 * The gate for every development-only fixture surface.
 *
 * FAILS CLOSED. Access requires BOTH:
 *   1. `__DEV__` — false in every release build, so the whole mechanism is
 *      compiled out of production regardless of anything else;
 *   2. an explicit opt-in flag on the route (`?fixture=<scene>`).
 *
 * Anything else — flag absent, flag empty, unknown scene, production build —
 * returns `blocked`. There is deliberately no default scene: forgetting the
 * flag must not silently open a fixture.
 *
 * Framework-free so it is unit-tested under Node.
 */

/** Scenes a fixture route may render. Add one per surface as it is migrated. */
export const FIXTURE_SCENES = [
  'checkout',
  'checkout-invalid',
  'checkout-loading',
  'payment-processing',
  'payment-success',
  'payment-failure',
] as const;

export type FixtureScene = (typeof FIXTURE_SCENES)[number];

export type GateResult =
  | { allowed: true; scene: FixtureScene }
  | { allowed: false; reason: 'not-dev' | 'no-flag' | 'unknown-scene' };

/**
 * @param isDev   pass `__DEV__` from the call site so this stays testable.
 * @param flag    the raw `?fixture=` query value, if any.
 */
export function resolveFixtureGate(isDev: boolean, flag: string | undefined | null): GateResult {
  // Order matters: production is checked first so a release build can never
  // reach scene parsing at all.
  if (!isDev) return { allowed: false, reason: 'not-dev' };
  const value = (flag ?? '').trim();
  if (!value) return { allowed: false, reason: 'no-flag' };
  if (!(FIXTURE_SCENES as readonly string[]).includes(value)) {
    return { allowed: false, reason: 'unknown-scene' };
  }
  return { allowed: true, scene: value as FixtureScene };
}
