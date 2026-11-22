/**
 * The testing-phase switch that lets a NAMED customer pay a real order with
 * Moyasar TEST keys and test cards.
 *
 * By default (the production default) a TEST-mode payment never pays for an
 * order: payment-initiate refuses customer checkout while the gateway is in
 * TEST mode, and validateAndConfirmMoyasarPayment refuses to confirm a TEST
 * attempt. Both refusals stay exactly as they are unless BOTH of these hold:
 *
 *   1. the Edge Function secret PAYMENT_ALLOW_TEST_CHECKOUT is the exact string
 *      'true'. Anything else, 'TRUE', '1', an empty string, or the secret being
 *      unset, keeps the refusals;
 *   2. the customer who owns the order or checkout session (its `customer_id`,
 *      read from the database by the caller, never from a request body) is
 *      listed in the Edge Function secret PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS: a
 *      comma-separated list of profile ids (UUIDs). Unset or empty, nobody is
 *      listed. An entry that is not a UUID is ignored, never matched.
 *
 * Owner request, 2026-11-18: the app is in testing, and the owner wants to pay
 * test orders in the mobile app with Moyasar test cards. Until 2026-11-22 the
 * switch was condition 1 alone, which admitted EVERY signed-in customer of the
 * public app: anyone holding Moyasar's published test card numbers could have
 * real food sent to a kitchen for no money (audit finding F-EFP-05-001). The
 * switch MUST still be unset before card payments go live (docs/PAYMENTS.md,
 * docs/OWNER_ACTIONS.md, docs/RELEASE_CHECKLIST.md).
 *
 * Both secrets are read on every call and never cached here, so this module
 * holds no copy of either after one is unset. Fails closed: if the environment
 * cannot be read, the answer is false.
 */
export const PAYMENT_ALLOW_TEST_CHECKOUT_ENV = 'PAYMENT_ALLOW_TEST_CHECKOUT';
export const PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS_ENV = 'PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The listed customer ids, lower-cased; entries that are not UUIDs are dropped. */
export function testCheckoutCustomerIds(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of String(raw ?? '').split(',')) {
    const id = part.trim().toLowerCase();
    if (UUID.test(id)) out.add(id);
  }
  return out;
}

/**
 * True only when the switch is exactly 'true' AND `customerId` is listed. The
 * argument is required, so a call site cannot ask "is the switch on" without
 * naming whose order it is deciding for.
 */
export function allowTestModeCheckout(customerId: unknown): boolean {
  try {
    if (Deno.env.get(PAYMENT_ALLOW_TEST_CHECKOUT_ENV) !== 'true') return false;
    const id = typeof customerId === 'string' ? customerId.trim().toLowerCase() : '';
    if (!UUID.test(id)) return false;
    return testCheckoutCustomerIds(Deno.env.get(PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS_ENV)).has(id);
  } catch {
    return false;
  }
}

/** The one structured line written whenever the switch lets a TEST payment through. */
export function logTestModeAllowed(fields: Record<string, string>): void {
  console.warn(JSON.stringify({ event: 'payment_test_mode_allowed', ...fields }));
}
