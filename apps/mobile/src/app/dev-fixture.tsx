/**
 * DEV-ONLY fixture route. Renders the REAL production screens against
 * deterministic mock state so Checkout, Payment and anything else that needs a
 * catalog/cart/order context can be reviewed visually WITHOUT a WhatsApp OTP,
 * a network, or a backend.
 *
 * Access requires BOTH `__DEV__` and an explicit `?fixture=<scene>` flag, and
 * FAILS CLOSED — no flag, an empty flag, an unknown scene, or a release build
 * all redirect home. There is deliberately no default scene, so forgetting the
 * flag cannot silently open a fixture. The gate itself is a pure function and
 * is unit-tested (see src/dev/fixtureGate.test.ts).
 *
 *   /dev-fixture?fixture=checkout
 *   /dev-fixture?fixture=checkout-invalid
 *   /dev-fixture?fixture=checkout-loading
 *
 * Nothing links here; it is reachable only by typing the path.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { FixtureProvider, type FixtureOptions } from '../dev/FixtureProvider';
import { resolveFixtureGate, type FixtureScene } from '../dev/fixtureGate';
import { CheckoutScreen } from '../features/checkout/CheckoutScreen';

/** Scene → the state the fixture provider should inject. */
const SCENE_OPTIONS: Record<FixtureScene, FixtureOptions> = {
  checkout: {},
  'checkout-invalid': { invalidContext: true },
  'checkout-loading': { loading: true },
  // Payment scenes are wired when the Payment surface is migrated; they resolve
  // to the checkout screen today so the gate list stays honest about coverage.
  'payment-processing': {},
  'payment-success': {},
  'payment-failure': {},
};

export default function DevFixtureRoute() {
  const { fixture } = useLocalSearchParams<{ fixture?: string }>();
  const gate = resolveFixtureGate(__DEV__, fixture);

  if (!gate.allowed) return <Redirect href="/" />;

  return (
    <FixtureProvider options={SCENE_OPTIONS[gate.scene]}>
      <CheckoutScreen />
    </FixtureProvider>
  );
}
