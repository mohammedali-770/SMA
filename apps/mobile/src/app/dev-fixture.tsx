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
 *   /dev-fixture?fixture=checkout-below-minimum
 *   /dev-fixture?fixture=payment-pending
 *
 * The payment scenes render `PaymentStatusDialog` DIRECTLY over the checkout
 * screen. That is the honest way to review them: those states live in
 * CheckoutScreen's own state, reached only by running a real charge, so the
 * alternative is either not reviewing them or faking a payment — and the fixture
 * must never touch a payment session. Every handler passed here is a no-op.
 *
 * Nothing links here; it is reachable only by typing the path.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';

import { FixtureProvider, type FixtureOptions } from '../dev/FixtureProvider';
import { OrdersListFixture, ReceiptFixture } from '../dev/OrderFixtures';
import { resolveFixtureGate, type FixtureScene } from '../dev/fixtureGate';
import type { ReceiptSceneKey } from '../dev/fixtureOrders';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { CheckoutScreen } from '../features/checkout/CheckoutScreen';
import {
  PaymentStatusDialog,
  type PayState,
} from '../features/checkout/view/PaymentStatusDialog';
import { useI18n } from '../i18n/I18nProvider';

/** Scene → the state the fixture provider should inject. */
const SCENE_OPTIONS: Record<FixtureScene, FixtureOptions> = {
  checkout: {},
  'checkout-pickup': { pickup: true },
  'checkout-invalid': { invalidContext: true },
  'checkout-loading': { loading: true },
  'checkout-empty': { emptyCart: true },
  'checkout-below-minimum': { belowMinimum: true },
  'checkout-no-address': { missingAddress: true },
  'checkout-delivery-closed': { deliveryClosed: true },
  'checkout-online-off': { payment: 'online-off' },
  'checkout-payment-none': { payment: 'none' },
  'payment-opening': {},
  'payment-verifying': {},
  'payment-pending': {},
  'payment-failed': {},
  'payment-cancelled': {},
  'payment-expired': {},
  'payment-error': {},
  orders: {},
  'orders-empty': {},
  'receipt-payment-pending': {},
  'receipt-paid': {},
  'receipt-cash': {},
  'receipt-sending': {},
  'receipt-confirmed': {},
  'receipt-verifying': {},
  'receipt-resend': {},
  'receipt-resend-cash': {},
  'receipt-refund-pending': {},
  'receipt-refunded': {},
  'receipt-refund-failed': {},
  'receipt-ready': {},
  'receipt-completed': {},
  'receipt-cancelled': {},
  profile: {},
  'profile-no-name': { noProfileName: true },
};

/** Payment scene → the overlay state it puts the dialog in. */
const PAY_STATE: Partial<Record<FixtureScene, PayState>> = {
  'payment-opening': 'opening',
  'payment-verifying': 'verifying',
  'payment-pending': 'pending',
  'payment-failed': 'failed',
  'payment-cancelled': 'cancelled',
  'payment-expired': 'expired',
  'payment-error': 'error',
};

export default function DevFixtureRoute() {
  const { fixture, lang } = useLocalSearchParams<{ fixture?: string; lang?: string }>();
  const gate = resolveFixtureGate(__DEV__, fixture);

  // `&lang=ar` makes the Arabic/RTL pass reproducible from a URL instead of
  // depending on whatever language happens to be in storage. Hooks must run
  // before the gate's early return, so the effect no-ops when blocked.
  useFixtureLanguage(gate.allowed ? lang : undefined);

  if (!gate.allowed) return <Redirect href="/" />;

  // Orders / Receipt render PRESENTATIONAL components against fixed mock
  // orders — never the fetching screens, which would call the orders API (and,
  // for a resend, the POS) on mount.
  if (gate.scene === 'orders' || gate.scene === 'orders-empty') {
    return <OrdersListFixture empty={gate.scene === 'orders-empty'} />;
  }
  if (gate.scene.startsWith('receipt-')) {
    return <ReceiptFixture scene={gate.scene.slice('receipt-'.length) as ReceiptSceneKey} />;
  }
  // Profile is the REAL screen: it reads auth from context, and its only
  // actions are navigation and sign-out, both inert here.
  if (gate.scene === 'profile' || gate.scene === 'profile-no-name') {
    return (
      <FixtureProvider options={SCENE_OPTIONS[gate.scene]}>
        <ProfileScreen />
      </FixtureProvider>
    );
  }

  const payState = PAY_STATE[gate.scene] ?? null;

  return (
    <FixtureProvider options={SCENE_OPTIONS[gate.scene]}>
      <CheckoutScreen />
      {payState ? <FixturePaymentDialog state={payState} /> : null}
    </FixtureProvider>
  );
}

/** Applies `?lang=ar|en` once, so a screenshot URL fully determines what renders. */
function useFixtureLanguage(lang: string | string[] | undefined) {
  const { setLang } = useI18n();
  const value = Array.isArray(lang) ? lang[0] : lang;
  useEffect(() => {
    if (value === 'ar' || value === 'en') setLang(value);
  }, [value, setLang]);
}

/**
 * The payment overlay with every handler inert. It cannot start, continue,
 * verify or retry anything — it only draws the state.
 */
function FixturePaymentDialog({ state }: { state: PayState }) {
  const { t } = useI18n();
  const noop = () => {};
  const message =
    state === 'pending' ? t('payNotCompleted')
    : state === 'cancelled' ? t('payCancelled')
    : state === 'expired' ? t('payExpired')
    : state === 'error' ? t('payUnavailable')
    : t('payFailed');

  return (
    <PaymentStatusDialog
      state={state}
      message={message}
      busy={false}
      labels={{
        title: t('payTitle'),
        opening: t('payOpening'),
        verifying: t('payVerifying'),
        cancel: t('cancel'),
        close: t('close'),
        continuePayment: t('payContinue'),
        verifyAgain: t('payVerifyAgain'),
        tryAgain: t('payTryAgain'),
        statusPending: t('payStatusPending'),
        statusFailed: t('payStatusFailed'),
        statusCancelled: t('payStatusCancelled'),
        statusExpired: t('payStatusExpired'),
      }}
      onContinue={noop}
      onVerifyAgain={noop}
      onResume={noop}
      onRetryFresh={noop}
      onClose={noop}
    />
  );
}
