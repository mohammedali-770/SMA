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
  // Checkout — the screen state matrix.
  'checkout',
  'checkout-pickup',
  'checkout-invalid',
  'checkout-loading',
  'checkout-empty',
  'checkout-below-minimum',
  'checkout-no-address',
  'checkout-delivery-closed',
  'checkout-online-off',
  'checkout-payment-none',
  // Payment — the overlay states. These are driven by state INSIDE
  // CheckoutScreen rather than by context, which is why the dialog is a
  // presentational component the fixture can render directly.
  'payment-opening',
  'payment-verifying',
  'payment-pending',
  'payment-failed',
  'payment-cancelled',
  'payment-expired',
  'payment-error',
  // NOTE: there is deliberately NO scene for `app/payment/return.tsx`. That
  // screen exists to RESOLVE an interrupted charge: it persists a session id
  // from the deep link and drives `recoverPendingSession`, which calls the real
  // payment-verify endpoint when a pending session is present. A fixture must
  // never be able to touch a payment session, and the screen redirects within a
  // frame anyway, so there is nothing to review. It is verified on-device.

  // Orders + Receipt. These render the PRESENTATIONAL components against fixed
  // mock orders — never the fetching screens. OrdersScreen and ReceiptScreen
  // call `orders.listWithItems` / `orders.byId` / `orders.requestResend` on
  // mount, and a resend is a real POS action, so they are deliberately not
  // mounted here. Every handler passed to the components is inert.
  'orders',
  'orders-empty',
  'receipt-payment-pending',
  'receipt-paid',
  'receipt-cash',
  'receipt-sending',
  'receipt-confirmed',
  'receipt-verifying',
  'receipt-resend',
  'receipt-resend-cash',
  'receipt-refund-pending',
  'receipt-refunded',
  'receipt-refund-failed',
  'receipt-ready',
  'receipt-completed',
  'receipt-cancelled',

  // Profile. Renders the REAL screen: it reads auth from context and its only
  // actions are navigation and sign-out, both inert under the fixture's no-op
  // auth value. Account deletion is NOT a scene — that screen calls
  // `accountDeletion.current()` on mount and can submit a real deletion.
  'profile',
  'profile-no-name',

  // Order-type gate. Rendered with NO delivery zones injected, which makes
  // `resolveDeliveryBranch` return null for any pin — so `confirmNewAddress`
  // always returns at the "delivery unavailable" branch and can never reach
  // `addresses.create`. The write is unreachable by construction, not by the
  // accident of the review environment lacking a Maps API key.
  'order-type-pickup',
  'order-type-delivery',
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
