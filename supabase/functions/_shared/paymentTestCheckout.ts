/**
 * The testing-phase switch that lets a customer pay a real order with Moyasar
 * TEST keys and test cards.
 *
 * By default (the production default) a TEST-mode payment never pays for an
 * order: payment-initiate refuses customer checkout while the gateway is in
 * TEST mode, and validateAndConfirmMoyasarPayment refuses to confirm a TEST
 * attempt. Both refusals stay exactly as they are unless the Edge Function
 * secret PAYMENT_ALLOW_TEST_CHECKOUT is the exact string 'true'. Anything else,
 * 'TRUE', '1', an empty string, or the secret being unset, keeps them.
 *
 * Owner request, 2026-11-18: the app is in testing, and the owner wants to pay
 * test orders in the mobile app with Moyasar test cards. The switch MUST be
 * unset before card payments go live (docs/PAYMENTS.md, docs/OWNER_ACTIONS.md,
 * docs/RELEASE_CHECKLIST.md).
 *
 * Read on every call and never cached here, so this module holds no copy of it
 * after the secret is unset. Fails closed: if the environment cannot be read,
 * the answer is false.
 */
export const PAYMENT_ALLOW_TEST_CHECKOUT_ENV = 'PAYMENT_ALLOW_TEST_CHECKOUT';

export function allowTestModeCheckout(): boolean {
  try {
    return Deno.env.get(PAYMENT_ALLOW_TEST_CHECKOUT_ENV) === 'true';
  } catch {
    return false;
  }
}

/** The one structured line written whenever the switch lets a TEST payment through. */
export function logTestModeAllowed(fields: Record<string, string>): void {
  console.warn(JSON.stringify({ event: 'payment_test_mode_allowed', ...fields }));
}
