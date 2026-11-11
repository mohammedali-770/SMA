import { describe, it, expect } from 'vitest';
import {
  amountsMatch, basicAuthHeader, buildInvoicePayload, currencyExponent, customerCheckoutUrl, extractMoyasarError,
  fromMinorUnits, HANDLED_WEBHOOK_TYPES, invoiceExpiryIso, isAdminTestInvoice, isMoyasarIpNotAllowed,
  keyMatchesMode, lastFourOf, mapMoyasarInvoiceStatus, mapMoyasarPaymentStatus, parseWebhookEnvelope,
  paymentFailureMessage, resolveMoyasarConfig, sanitizeMoyasarInvoice, sanitizeMoyasarPayment,
  selectInvoicePayment, checkPaymentBinding, timingSafeEqual, toMinorUnits, verifyWebhookSecretToken,
  matchesAnyWebhookSecret, WEBHOOK_VERIFICATION_TYPE, webhookVerificationLogRow, confirmMessageKey,
  closedInvoiceOutcome,
} from './moyasar.ts';
import { STRINGS } from '../../../apps/mobile/src/i18n/strings.ts';
import { decidePendingAction } from '../../../apps/mobile/src/features/checkout/pendingSession.ts';

describe('minor units (halalas)', () => {
  it('converts SAR major units to integer halalas', () => {
    expect(toMinorUnits(1, 'SAR')).toBe(100);
    expect(toMinorUnits(45, 'SAR')).toBe(4500);
    expect(toMinorUnits(45.5, 'SAR')).toBe(4550);
    expect(toMinorUnits(0.05, 'SAR')).toBe(5);
  });

  /**
   * The whole reason this conversion is a tested function and not an inline
   * `* 100`. 45.55 * 100 is 4554.999999999999 in IEEE-754, so a truncating
   * implementation charges a halala less than the order total — and an amount
   * that does not match is an amount validateAndConfirm refuses to confirm, so
   * the customer is charged and the order never completes.
   */
  it('does not lose a halala to binary floating point', () => {
    expect(toMinorUnits(45.55, 'SAR')).toBe(4555);
    expect(toMinorUnits(1.005, 'SAR')).toBe(101);
    expect(toMinorUnits(8.15, 'SAR')).toBe(815);
    expect(toMinorUnits(1.115, 'SAR')).toBe(112);
  });

  it('honours the exponent for three- and zero-decimal currencies', () => {
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('SAR')).toBe(2);
    expect(toMinorUnits(3, 'KWD')).toBe(3000);
    expect(toMinorUnits(500, 'JPY')).toBe(500);
  });

  it('is safe on non-finite and negative input', () => {
    expect(toMinorUnits(NaN, 'SAR')).toBe(0);
    expect(toMinorUnits(-5, 'SAR')).toBe(0);
    expect(toMinorUnits(Infinity, 'SAR')).toBe(0);
  });

  it('round-trips back to major units', () => {
    expect(fromMinorUnits(4550, 'SAR')).toBe(45.5);
    expect(fromMinorUnits(100, 'SAR')).toBe(1);
    expect(fromMinorUnits(3000, 'KWD')).toBe(3);
  });
});

describe('amountsMatch', () => {
  it('matches an order total against the provider minor-unit amount', () => {
    expect(amountsMatch(45.5, 4550, 'SAR')).toBe(true);
    expect(amountsMatch(45.55, 4555, 'SAR')).toBe(true);
  });
  it('rejects a mismatch, a non-integer, and zero', () => {
    expect(amountsMatch(45.5, 4551, 'SAR')).toBe(false);
    expect(amountsMatch(45.5, 45.5, 'SAR')).toBe(false); // major units sent as minor
    expect(amountsMatch(45.5, 4550.5, 'SAR')).toBe(false);
    expect(amountsMatch(0, 0, 'SAR')).toBe(false);
  });
  /** A 100x error is exactly what mixing up the units produces. */
  it('rejects the classic 100x confusion in both directions', () => {
    expect(amountsMatch(45, 45, 'SAR')).toBe(false);
    expect(amountsMatch(45, 450000, 'SAR')).toBe(false);
  });
});

describe('basicAuthHeader', () => {
  /**
   * Moyasar's key is the Basic username and "the password must be kept empty".
   * The trailing colon is load-bearing: without it the credential is a different
   * string and does not authenticate.
   */
  it('encodes key + empty password', () => {
    expect(basicAuthHeader('sk_test_abc')).toBe(`Basic ${btoa('sk_test_abc:')}`);
  });
  it('is not the same as encoding the key alone', () => {
    expect(basicAuthHeader('sk_test_abc')).not.toBe(`Basic ${btoa('sk_test_abc')}`);
  });
});

describe('timingSafeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('keyMatchesMode', () => {
  it('recognises the documented prefixes', () => {
    expect(keyMatchesMode('sk_test_x', 'test')).toBe(true);
    expect(keyMatchesMode('sk_live_x', 'live')).toBe(true);
    expect(keyMatchesMode('pk_test_x', 'test', 'publishable')).toBe(true);
    expect(keyMatchesMode('pk_live_x', 'live', 'publishable')).toBe(true);
  });
  /** The mistake that charges real cards from a screen labelled TEST. */
  it('rejects a live key filed under test and vice versa', () => {
    expect(keyMatchesMode('sk_live_x', 'test')).toBe(false);
    expect(keyMatchesMode('sk_test_x', 'live')).toBe(false);
  });
  it('rejects a publishable key in the secret slot', () => {
    expect(keyMatchesMode('pk_test_x', 'test', 'secret')).toBe(false);
  });
});

describe('resolveMoyasarConfig', () => {
  const pub = { mode: 'test', currency: 'SAR', invoice_expiry_minutes: 30 };
  const sec = { moyasar_test_secret_key: 'sk_test_abc', moyasar_webhook_secret_token: 'wh_secret' };

  it('resolves a complete test config', () => {
    const c = resolveMoyasarConfig(true, 'moyasar', pub, sec);
    expect(c.ok).toBe(true);
    expect(c.mode).toBe('test');
    expect(c.secretKey).toBe('sk_test_abc');
    expect(c.webhookSecret).toBe('wh_secret');
    expect(c.currency).toBe('SAR');
  });

  it('fails closed when disabled or when the provider is someone else', () => {
    expect(resolveMoyasarConfig(false, 'moyasar', pub, sec).reason).toBe('disabled');
    expect(resolveMoyasarConfig(true, 'tap', pub, sec).reason).toBe('not_moyasar');
  });

  /** No silent live -> test fallback: a missing live key is a hard stop. */
  it('never falls back to the other mode key', () => {
    const c = resolveMoyasarConfig(true, 'moyasar', { ...pub, mode: 'live' }, sec);
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('missing_key');
    expect(c.secretKey).toBe('');
  });

  it('refuses a key whose prefix does not match its slot', () => {
    const c = resolveMoyasarConfig(true, 'moyasar', pub, { ...sec, moyasar_test_secret_key: 'sk_live_oops' });
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('key_mode_mismatch');
  });

  /**
   * Moyasar's webhook carries no signature; the shared token IS the
   * authentication. Without it the provider is not usable, so resolution fails
   * rather than leaving a gateway that silently never confirms an order.
   */
  it('requires a webhook secret', () => {
    const c = resolveMoyasarConfig(true, 'moyasar', pub, { moyasar_test_secret_key: 'sk_test_abc' });
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('missing_webhook_secret');
  });

  it('prefers a mode-specific webhook secret over the shared one', () => {
    const c = resolveMoyasarConfig(true, 'moyasar', pub, {
      ...sec, moyasar_test_webhook_secret_token: 'wh_test_specific',
    });
    expect(c.webhookSecret).toBe('wh_test_specific');
  });

  it('honours an explicit mode override for verifying an older attempt', () => {
    const c = resolveMoyasarConfig(true, 'moyasar', { ...pub, mode: 'live' }, {
      ...sec, moyasar_live_secret_key: 'sk_live_xyz',
    }, 'test');
    expect(c.mode).toBe('test');
    expect(c.secretKey).toBe('sk_test_abc');
  });

  it('clamps the invoice expiry to 5..60 minutes', () => {
    expect(resolveMoyasarConfig(true, 'moyasar', { ...pub, invoice_expiry_minutes: 1 }, sec).expiryMinutes).toBe(5);
    expect(resolveMoyasarConfig(true, 'moyasar', { ...pub, invoice_expiry_minutes: 999 }, sec).expiryMinutes).toBe(60);
    expect(resolveMoyasarConfig(true, 'moyasar', { ...pub, invoice_expiry_minutes: 'x' }, sec).expiryMinutes).toBe(30);
  });
});

describe('buildInvoicePayload', () => {
  const base = {
    amount: 45.5,
    currency: 'SAR',
    description: 'Spicy Meal order',
    referenceTransaction: 'sm_abc',
    referenceOrder: 'ORD-0123456789ab',
    expiryMinutes: 30,
    successUrl: 'https://x/functions/v1/payment-return?order=o1',
    backUrl: 'https://x/functions/v1/payment-return?order=o1',
    expiresAtIso: '2026-08-24T10:30:00.000Z',
  };

  it('sends the amount in MINOR units', () => {
    const b = buildInvoicePayload(base);
    expect(b.amount).toBe(4550);
    expect(b.currency).toBe('SAR');
  });

  it('carries both opaque references in metadata', () => {
    const meta = buildInvoicePayload(base).metadata as Record<string, string>;
    expect(meta.reference_transaction).toBe('sm_abc');
    expect(meta.reference_order).toBe('ORD-0123456789ab');
  });

  /**
   * Issue #94: `description` is rendered on Moyasar's hosted checkout page, so
   * it must never carry the internal SM-… order number. The binding lives in
   * payment.invoice_id, not in this string.
   */
  it('never leaks the internal SM-… order number into a customer-visible field', () => {
    const b = buildInvoicePayload({ ...base, description: 'Spicy Meal order' });
    const serialized = JSON.stringify(b);
    expect(serialized).not.toMatch(/SM-\d/);
    expect(b.description).toBe('Spicy Meal order');
  });

  it('sends the redirect URLs and the expiry Moyasar documents', () => {
    const b = buildInvoicePayload(base);
    expect(b.success_url).toBe(base.successUrl);
    expect(b.back_url).toBe(base.backUrl);
    expect(b.expired_at).toBe(base.expiresAtIso);
  });

  /**
   * Moyasar's invoice `callback_url` POSTs a bare invoice object with no
   * `secret_token`, so nothing about it can be authenticated. Sending it would
   * either fill the webhook log with rejected POSTs or invite an unauthenticated
   * caller to trigger our outbound API calls. The registered `payment_paid`
   * webhook and the app's own verify call already cover confirmation, and both
   * re-fetch server-side.
   */
  it('deliberately does NOT send callback_url', () => {
    expect(buildInvoicePayload(base)).not.toHaveProperty('callback_url');
  });

  it('sends no undocumented fields', () => {
    const keys = Object.keys(buildInvoicePayload(base)).sort();
    expect(keys).toEqual([
      'amount', 'back_url', 'currency', 'description',
      'expired_at', 'metadata', 'success_url',
    ]);
  });

  it('merges caller metadata without dropping the references', () => {
    const meta = buildInvoicePayload({ ...base, metadata: { purpose: 'admin_test' } }).metadata as Record<string, string>;
    expect(meta.purpose).toBe('admin_test');
    expect(meta.reference_transaction).toBe('sm_abc');
  });
});

describe('customerCheckoutUrl', () => {
  const ID = 'efebc231-7795-4cfd-b69c-980fe4c02c49';

  /** Moyasar's own documented example uses http, so it is upgraded, not refused. */
  it("upgrades Moyasar's documented http example and sets the customer's language", () => {
    expect(customerCheckoutUrl(`http://checkout.moyasar.com/invoices/${ID}?lang=en`, 'ar')).toBe(
      `https://checkout.moyasar.com/invoices/${ID}?lang=ar`,
    );
  });
  it('keeps an https URL on the domain or a subdomain, adding lang and keeping the rest', () => {
    expect(customerCheckoutUrl(`https://checkout.moyasar.com/invoices/${ID}`, 'en')).toBe(
      `https://checkout.moyasar.com/invoices/${ID}?lang=en`,
    );
    expect(customerCheckoutUrl(`https://CHECKOUT.Moyasar.com/invoices/${ID}?x=1`, 'ar')).toBe(
      `https://checkout.moyasar.com/invoices/${ID}?x=1&lang=ar`,
    );
    expect(customerCheckoutUrl('https://moyasar.com/i/1', 'en')).toBe('https://moyasar.com/i/1?lang=en');
    expect(customerCheckoutUrl('https://a.b.moyasar.com/i', 'en')).toBe('https://a.b.moyasar.com/i?lang=en');
  });
  it("refuses anything that is not https on Moyasar's own domain", () => {
    for (const raw of [
      'https://evil.example/invoices/1',
      'https://moyasar.com.evil.example/invoices/1',
      'https://evilmoyasar.com/invoices/1',
      'https://checkout.moyasar.com.evil.example/invoices/1',
      'https://checkout.moyasar.com./invoices/1',
      'https://user:pass@checkout.moyasar.com/invoices/1',
      'https://checkout.moyasar.com:8443/invoices/1',
      'ftp://checkout.moyasar.com/invoices/1',
      'javascript:alert(1)//checkout.moyasar.com',
      'checkout.moyasar.com/invoices/1',
      '',
      null,
      undefined,
    ]) {
      expect(customerCheckoutUrl(raw, 'en'), String(raw)).toBeNull();
    }
  });
});

describe('invoiceExpiryIso', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  it('adds the clamped expiry and renders ISO-8601', () => {
    expect(invoiceExpiryIso(now, 30)).toBe('2026-08-24T10:30:00.000Z');
    expect(invoiceExpiryIso(now, 1)).toBe('2026-08-24T10:05:00.000Z');
    expect(invoiceExpiryIso(now, 900)).toBe('2026-08-24T11:00:00.000Z');
    expect(invoiceExpiryIso(now, NaN)).toBe('2026-08-24T10:30:00.000Z');
  });
});

describe('isAdminTestInvoice', () => {
  it('recognises the isolated admin test invoice both ways', () => {
    expect(isAdminTestInvoice({ metadata: { purpose: 'admin_test' } })).toBe(true);
    expect(isAdminTestInvoice({ metadata: { reference_order: 'admin_test' } })).toBe(true);
  });
  it('does not mistake a real order for one', () => {
    expect(isAdminTestInvoice({ metadata: { reference_order: 'ORD-0123456789ab' } })).toBe(false);
    expect(isAdminTestInvoice({})).toBe(false);
    expect(isAdminTestInvoice(null)).toBe(false);
  });
});

describe('mapMoyasarPaymentStatus', () => {
  it('treats only paid and captured as money we hold', () => {
    expect(mapMoyasarPaymentStatus('paid').outcome).toBe('paid');
    expect(mapMoyasarPaymentStatus('captured').outcome).toBe('paid');
  });
  /**
   * `authorized` reserves funds but, in Moyasar's words, "the cardholder is not
   * charged yet". Feeding that to the kitchen would give away food for money we
   * have not taken.
   */
  it('never treats authorized or verified as paid', () => {
    expect(mapMoyasarPaymentStatus('authorized').outcome).toBe('pending');
    expect(mapMoyasarPaymentStatus('verified').outcome).toBe('pending');
  });
  it('maps the terminal states', () => {
    expect(mapMoyasarPaymentStatus('failed').outcome).toBe('failed');
    expect(mapMoyasarPaymentStatus('voided').outcome).toBe('cancelled');
    expect(mapMoyasarPaymentStatus('refunded').outcome).toBe('refunded');
    expect(mapMoyasarPaymentStatus('initiated').outcome).toBe('pending');
  });
  it('sends anything unrecognised to unknown, never to paid', () => {
    for (const s of ['', null, undefined, 'PAID_MAYBE', 'settled', 42, {}]) {
      expect(mapMoyasarPaymentStatus(s as unknown).outcome).toBe('unknown');
    }
  });
  it('is case-insensitive on the documented values', () => {
    expect(mapMoyasarPaymentStatus('PAID').outcome).toBe('paid');
  });
});

describe('mapMoyasarInvoiceStatus', () => {
  it('adds the invoice-only states', () => {
    expect(mapMoyasarInvoiceStatus('expired').outcome).toBe('expired');
    expect(mapMoyasarInvoiceStatus('canceled').outcome).toBe('cancelled');
    expect(mapMoyasarInvoiceStatus('paid').outcome).toBe('paid');
  });
  /** on_hold is not terminal — closing the attempt on it strands a live payment. */
  it('keeps on_hold pending', () => {
    expect(mapMoyasarInvoiceStatus('on_hold').outcome).toBe('pending');
  });
  it('sends anything unrecognised to unknown', () => {
    expect(mapMoyasarInvoiceStatus('something_new').outcome).toBe('unknown');
  });
});

/**
 * payment-verify forwards `messageKey` to the app, which renders it with
 * `t(messageKey)` — and `t()` falls back to the key's own NAME when a string is
 * missing (I18nProvider.tsx). A key the shipped app lacks is therefore printed
 * on the customer's screen verbatim. The app reaches customers only through an
 * EAS build, so the server must stay inside the strings the app already has.
 *
 * The repository's strings are the proxy checked here. A key added to
 * strings.ts after the last EAS build would pass this test and still be missing
 * on installed phones, which is why `refunded` maps to a key that has been in
 * the app since the first online-payment build rather than to a new one.
 */
describe('closedInvoiceOutcome', () => {
  const paid = { id: 'pay_1', status: 'paid' };

  it('closes an expired or cancelled invoice that nobody paid', () => {
    expect(closedInvoiceOutcome({ status: 'expired', payments: [] })).toEqual({
      outcome: 'expired', messageKey: 'payExpired', failureCode: 'invoice_expired',
    });
    for (const status of ['canceled', 'cancelled', 'CANCELED']) {
      expect(closedInvoiceOutcome({ status }), status).toEqual({
        outcome: 'cancelled', messageKey: 'payCancelled', failureCode: 'invoice_canceled',
      });
    }
  });

  /** A declined card, or a 3-D Secure page abandoned half way, is not money held. */
  it('closes it whatever unsettled attempts it carries', () => {
    for (const status of ['failed', 'initiated', 'authorized', 'voided']) {
      expect(closedInvoiceOutcome({ status: 'expired', payments: [{ status }] })?.outcome, status).toBe('expired');
    }
  });

  /** Money Moyasar holds is confirmed or refunded, never written off. */
  it('never closes an invoice carrying a settled payment', () => {
    expect(closedInvoiceOutcome({ status: 'expired', payments: [{ status: 'failed' }, paid] })).toBeNull();
    expect(closedInvoiceOutcome({ status: 'canceled', payments: [{ status: 'captured' }] })).toBeNull();
  });

  it('leaves an open invoice open, SADAD on_hold included', () => {
    for (const status of ['initiated', 'on_hold', 'paid', 'refunded', 'something_new', '']) {
      expect(closedInvoiceOutcome({ status, payments: [] }), status).toBeNull();
    }
    expect(closedInvoiceOutcome({})).toBeNull();
    expect(closedInvoiceOutcome({ status: 'expired', payments: 'junk' })?.outcome).toBe('expired');
  });

  /** The contract with every installed copy of the app, read from the app itself. */
  it('answers in outcomes the shipped app treats as terminal and keys it can show', () => {
    for (const invoice of [{ status: 'expired' }, { status: 'canceled' }]) {
      const closed = closedInvoiceOutcome(invoice)!;
      expect(decidePendingAction({ status: closed.outcome })).toEqual({ kind: 'clear' });
      expect(Object.keys(STRINGS.en)).toContain(closed.messageKey);
      expect(Object.keys(STRINGS.ar)).toContain(closed.messageKey);
    }
    expect(decidePendingAction({ status: 'pending' })).toEqual({ kind: 'keep' });
  });
});

describe('message keys the app can show', () => {
  const PAYMENT_STATUSES = [
    'initiated', 'paid', 'captured', 'authorized', 'verified', 'failed', 'voided', 'refunded', 'something_new',
  ];
  const INVOICE_STATUSES = [
    'initiated', 'paid', 'failed', 'canceled', 'cancelled', 'voided', 'expired', 'on_hold', 'refunded',
    'something_new',
  ];

  it('maps a refunded payment or invoice to payUnknown, keeping the refunded outcome', () => {
    expect(mapMoyasarPaymentStatus('refunded')).toEqual({ outcome: 'refunded', messageKey: 'payUnknown' });
    expect(mapMoyasarInvoiceStatus('refunded')).toEqual({ outcome: 'refunded', messageKey: 'payUnknown' });
  });

  /**
   * The app shows the server's key beside the state it was given, so a paid
   * payment that was not confirmed (a binding mismatch, a TEST-mode attempt)
   * must not arrive as "Payment successful" on a failed dialog.
   */
  it('never says the payment succeeded unless it was confirmed', () => {
    expect(confirmMessageKey('paid', true)).toBe('paySuccess');
    expect(confirmMessageKey('captured', true)).toBe('paySuccess');
    expect(confirmMessageKey('paid', false)).toBe('payUnknown');
    expect(confirmMessageKey('captured', false)).toBe('payUnknown');
    expect(confirmMessageKey('failed', false)).toBe('payDeclined');
    expect(confirmMessageKey('initiated', false)).toBe('payPending');
  });

  it('never emits a key the app strings lack, in either language', () => {
    const emitted = [
      ...PAYMENT_STATUSES.map((s) => mapMoyasarPaymentStatus(s).messageKey),
      ...INVOICE_STATUSES.map((s) => mapMoyasarInvoiceStatus(s).messageKey),
      ...PAYMENT_STATUSES.flatMap((s) => [confirmMessageKey(s, true), confirmMessageKey(s, false)]),
    ];
    for (const key of emitted) {
      expect(Object.keys(STRINGS.en), `en.${key}`).toContain(key);
      expect(Object.keys(STRINGS.ar), `ar.${key}`).toContain(key);
    }
  });
});

describe('verifyWebhookSecretToken', () => {
  it('accepts the configured token', () => {
    expect(verifyWebhookSecretToken('wh_secret', 'wh_secret')).toBe(true);
  });
  it('rejects a wrong, blank or missing token', () => {
    expect(verifyWebhookSecretToken('nope', 'wh_secret')).toBe(false);
    expect(verifyWebhookSecretToken('', 'wh_secret')).toBe(false);
    expect(verifyWebhookSecretToken(null, 'wh_secret')).toBe(false);
    expect(verifyWebhookSecretToken(undefined, 'wh_secret')).toBe(false);
  });
  /**
   * An unconfigured provider must not degrade into accepting everything — that
   * would make an empty secret a universal key.
   */
  it('rejects everything when no secret is configured', () => {
    expect(verifyWebhookSecretToken('anything', '')).toBe(false);
    expect(verifyWebhookSecretToken('', '')).toBe(false);
  });
});

describe('parseWebhookEnvelope', () => {
  it('reads the documented envelope fields', () => {
    const e = parseWebhookEnvelope({
      id: 'evt_1', type: 'payment_paid', secret_token: 'wh', live: true,
      created_at: '2026-08-24T10:00:00Z', data: { id: 'pay_1' },
    });
    expect(e).toEqual({
      id: 'evt_1', type: 'payment_paid', secretToken: 'wh', live: true,
      createdAt: '2026-08-24T10:00:00Z', data: { id: 'pay_1' },
    });
  });
  /**
   * An ABSENT flag must stay distinct from `false`. Coercing it made
   * checkPaymentBinding compare a mode it had no information about, so a live
   * event that omitted `live` marked a genuinely PAID attempt as a mismatch.
   */
  it('keeps an absent or mistyped live flag as null, not false', () => {
    expect(parseWebhookEnvelope({}).live).toBeNull();
    expect(parseWebhookEnvelope({ live: 'true' }).live).toBeNull(); // only a real boolean counts
    expect(parseWebhookEnvelope({ live: 1 }).live).toBeNull();
    expect(parseWebhookEnvelope({ live: false }).live).toBe(false);
    expect(parseWebhookEnvelope({ live: true }).live).toBe(true);
    expect(parseWebhookEnvelope(null).data).toEqual({});
  });

  it('so a live payment with no flag still binds', () => {
    const attempt = { provider_checkout_ref: 'inv_1', amount: 45.5, currency: 'SAR', mode: 'live' };
    const payment = { id: 'pay_1', invoice_id: 'inv_1', amount: 4550, currency: 'SAR' };
    const evt = parseWebhookEnvelope({ type: 'payment_paid', data: payment });
    expect(checkPaymentBinding(attempt, payment, { liveMode: evt.live }).allMatch).toBe(true);
  });
});

describe('HANDLED_WEBHOOK_TYPES', () => {
  /** Moyasar's own spelling is `payment_faild`; correcting it would stop matching. */
  it("keeps Moyasar's misspelling of the failure event", () => {
    expect(HANDLED_WEBHOOK_TYPES.has('payment_faild')).toBe(true);
    expect(HANDLED_WEBHOOK_TYPES.has('payment_failed')).toBe(true);
  });
  it('covers every payment event available_events lists', () => {
    for (const e of [
      'payment_paid', 'payment_failed', 'payment_voided', 'payment_authorized',
      'payment_captured', 'payment_refunded', 'payment_abandoned', 'payment_verified',
    ]) {
      expect(HANDLED_WEBHOOK_TYPES.has(e)).toBe(true);
    }
  });
  /** Standalone 3-D Secure is not something this integration uses. */
  it('excludes the card-authentication events', () => {
    expect(HANDLED_WEBHOOK_TYPES.has('card_auth_authenticated')).toBe(false);
    expect(HANDLED_WEBHOOK_TYPES.has('card_auth_failed')).toBe(false);
  });
  /** It carries a code for the dashboard, not a payment: nothing to re-fetch or confirm. */
  it('excludes the webhook verification event', () => {
    expect(WEBHOOK_VERIFICATION_TYPE).toBe('webhook_verification');
    expect(HANDLED_WEBHOOK_TYPES.has(WEBHOOK_VERIFICATION_TYPE)).toBe(false);
  });
});

describe('webhook verification', () => {
  // The shape Moyasar documents (https://docs.moyasar.com/api/other/webhooks/verify-webhook).
  const event = parseWebhookEnvelope({
    id: 'evt_1', type: 'webhook_verification', created_at: '2026-11-11T10:00:00Z',
    secret_token: 'whsec_shared', account_name: 'Spicy Meal', live: false,
    data: { webhook_id: 'b8c4f0a2-6d2e-4f7a-9d61-3b5a3c2e1f00', verification_code: '482913' },
  });

  it('accepts the token from any configured slot: test, live or shared', () => {
    for (const slot of [
      'moyasar_test_webhook_secret_token', 'moyasar_live_webhook_secret_token', 'moyasar_webhook_secret_token',
    ]) {
      expect(matchesAnyWebhookSecret('whsec_shared', { [slot]: ' whsec_shared ' }), slot).toBe(true);
    }
    expect(matchesAnyWebhookSecret('whsec_live', {
      moyasar_test_webhook_secret_token: 'whsec_test', moyasar_live_webhook_secret_token: 'whsec_live',
    })).toBe(true);
  });

  it('refuses a wrong or missing token, and an unconfigured gateway', () => {
    const configured = { moyasar_test_webhook_secret_token: 'whsec_test' };
    expect(matchesAnyWebhookSecret('whsec_wrong', configured)).toBe(false);
    expect(matchesAnyWebhookSecret('', configured)).toBe(false);
    expect(matchesAnyWebhookSecret(undefined, configured)).toBe(false);
    expect(matchesAnyWebhookSecret('anything', {})).toBe(false);
    expect(matchesAnyWebhookSecret('', { moyasar_webhook_secret_token: '' })).toBe(false);
    // Only Moyasar's own slots count, not some other gateway's leftover.
    expect(matchesAnyWebhookSecret('whsec_tap', { webhook_secret: 'whsec_tap' })).toBe(false);
  });

  it('becomes exactly the row the console reads, with the code in the response only', () => {
    const row = webhookVerificationLogRow(event);
    expect(row).toEqual({
      provider: 'moyasar',
      direction: 'webhook',
      status: 'success',
      request: { type: 'webhook_verification', webhook_id: 'b8c4f0a2-6d2e-4f7a-9d61-3b5a3c2e1f00' },
      response: { verification_code: '482913' },
      error: null,
    });
    expect(JSON.stringify(row.request)).not.toContain('482913');
    expect(JSON.stringify(row)).not.toContain('whsec_shared');
  });

  it('bounds what it stores', () => {
    const big = parseWebhookEnvelope({
      type: 'webhook_verification', data: { webhook_id: 'w'.repeat(500), verification_code: 9.9e99 },
    });
    const row = webhookVerificationLogRow(big) as { request: { webhook_id: string }; response: { verification_code: string } };
    expect(row.request.webhook_id).toHaveLength(64);
    expect(row.response.verification_code.length).toBeLessThanOrEqual(16);
  });
});

describe('lastFourOf / sanitizeMoyasarPayment', () => {
  it('reduces a masked PAN to its last four digits', () => {
    expect(lastFourOf('411111******1111')).toBe('1111');
    expect(lastFourOf('1111')).toBe('1111');
    expect(lastFourOf('12')).toBeNull();
    expect(lastFourOf(null)).toBeNull();
  });

  const payment = {
    id: 'pay_1', status: 'paid', amount: 4550, currency: 'SAR', fee: 100,
    refunded: 0, captured: 4550, invoice_id: 'inv_1', created_at: 'now',
    ip: '10.0.0.1',
    source: {
      type: 'creditcard', company: 'mada', name: 'SARA A',
      number: '441111******3211', token: 'token_secret', gateway_id: 'gw_1',
      message: 'APPROVED', reference_number: '123456789012',
      authorization_code: '123456', response_code: '00',
      issuer_name: 'Bank', issuer_country: 'SA',
    },
  };

  it('keeps only safe fields', () => {
    const s = sanitizeMoyasarPayment(payment);
    expect(s.id).toBe('pay_1');
    expect(s.invoice_id).toBe('inv_1');
    expect((s.source as Record<string, unknown>).last_four).toBe('3211');
    expect((s.source as Record<string, unknown>).company).toBe('mada');
  });

  /** The BIN, the token, the cardholder name and the payer IP are all dropped. */
  it('drops the BIN, the token, the name and the payer IP', () => {
    const serialized = JSON.stringify(sanitizeMoyasarPayment(payment));
    expect(serialized).not.toContain('441111');
    expect(serialized).not.toContain('token_secret');
    expect(serialized).not.toContain('SARA A');
    expect(serialized).not.toContain('10.0.0.1');
    expect(serialized).not.toContain('gw_1');
  });

  it('never throws on a malformed payment', () => {
    expect(() => sanitizeMoyasarPayment(null)).not.toThrow();
    expect(sanitizeMoyasarPayment({}).id).toBeNull();
  });

  it('sanitizes every payment nested in an invoice', () => {
    const s = sanitizeMoyasarInvoice({ id: 'inv_1', status: 'paid', payments: [payment] });
    expect(JSON.stringify(s)).not.toContain('441111');
    expect((s.payments as unknown[]).length).toBe(1);
  });
});

describe('extractMoyasarError', () => {
  it('reads the documented error shape', () => {
    expect(extractMoyasarError({
      type: 'authentication_error', message: 'Invalid authorization credentials', errors: null,
    })).toEqual({ type: 'authentication_error', message: 'Invalid authorization credentials' });
  });
  it('folds the validation errors map into the message', () => {
    const e = extractMoyasarError({
      type: 'invalid_request_error', message: 'Validation Failed',
      errors: { amount: ['must be an integer'] },
    });
    expect(e.type).toBe('invalid_request_error');
    expect(e.message).toContain('amount: must be an integer');
  });
  it('clamps a very long message and survives junk', () => {
    const long = extractMoyasarError({ message: 'x'.repeat(500) });
    expect((long.message ?? '').length).toBe(200);
    expect(extractMoyasarError(null)).toEqual({ type: null, message: null });
  });
});

describe('paymentFailureMessage', () => {
  it('reads the human reason Moyasar puts on source.message', () => {
    expect(paymentFailureMessage({ source: { message: 'INSUFFICIENT FUNDS' } })).toBe('INSUFFICIENT FUNDS');
  });
  it('returns null when there is nothing safe to show', () => {
    expect(paymentFailureMessage({})).toBeNull();
    expect(paymentFailureMessage(null)).toBeNull();
    expect(paymentFailureMessage({ source: { message: '   ' } })).toBeNull();
  });
});

describe('isMoyasarIpNotAllowed', () => {
  // The documented refusal, word for word
  // (https://docs.moyasar.com/guides/dashboard/setting-up-your-ip-whitelist).
  const refusal = {
    type: 'authentication_error', message: 'This IP Address is not whitelisted to do this operation', errors: null,
  };

  it('recognises the documented Allowed IPs refusal', () => {
    expect(isMoyasarIpNotAllowed(401, refusal)).toBe(true);
    expect(isMoyasarIpNotAllowed(401, { message: 'IP address not allowed' })).toBe(true);
  });
  /** Same status, same type: only the message separates a bad key from a refused address. */
  it('does not mistake a rejected key for a refused address', () => {
    expect(isMoyasarIpNotAllowed(401, {
      type: 'authentication_error', message: 'Invalid authorization credentials',
    })).toBe(false);
    // Naming the allow-list without the IP is not enough, nor the IP alone.
    expect(isMoyasarIpNotAllowed(401, { message: 'This key is not allowed to do this operation' })).toBe(false);
    expect(isMoyasarIpNotAllowed(401, { message: 'Unknown IP' })).toBe(false);
  });
  it('is only ever a 401', () => {
    for (const status of [200, 400, 403, 404, 429, 500]) expect(isMoyasarIpNotAllowed(status, refusal)).toBe(false);
  });
  it('survives a body that is missing or junk', () => {
    expect(isMoyasarIpNotAllowed(401, null)).toBe(false);
    expect(isMoyasarIpNotAllowed(401, 'nope')).toBe(false);
  });
});

describe('checkPaymentBinding', () => {
  const attempt = {
    provider_checkout_ref: 'inv_1',
    amount: 45.5,
    currency: 'SAR',
    mode: 'test',
  };
  const payment = { id: 'pay_1', invoice_id: 'inv_1', amount: 4550, currency: 'SAR', status: 'paid' };

  it('binds a genuine payment for this attempt', () => {
    expect(checkPaymentBinding(attempt, payment).allMatch).toBe(true);
  });

  /**
   * The single most important check in the whole provider. Without it, any real
   * Moyasar payment could be presented as settling this order.
   */
  it("refuses another invoice's payment", () => {
    const r = checkPaymentBinding(attempt, { ...payment, invoice_id: 'inv_someone_else' });
    expect(r.invoiceMatch).toBe(false);
    expect(r.allMatch).toBe(false);
  });

  it('refuses a payment with no invoice at all', () => {
    expect(checkPaymentBinding(attempt, { ...payment, invoice_id: null }).allMatch).toBe(false);
  });

  /** An attempt with no stored invoice can never bind — not even to a blank one. */
  it('refuses to bind when the attempt has no stored invoice', () => {
    const r = checkPaymentBinding({ ...attempt, provider_checkout_ref: null }, { ...payment, invoice_id: '' });
    expect(r.invoiceMatch).toBe(false);
    expect(r.allMatch).toBe(false);
  });

  it('refuses a short payment, an over-payment, and a units mix-up', () => {
    expect(checkPaymentBinding(attempt, { ...payment, amount: 4549 }).allMatch).toBe(false);
    expect(checkPaymentBinding(attempt, { ...payment, amount: 4551 }).allMatch).toBe(false);
    expect(checkPaymentBinding(attempt, { ...payment, amount: 45.5 }).allMatch).toBe(false);
  });

  it('refuses a different currency', () => {
    expect(checkPaymentBinding(attempt, { ...payment, currency: 'AED' }).allMatch).toBe(false);
  });

  it('refuses a missing payment id', () => {
    expect(checkPaymentBinding(attempt, { ...payment, id: '' }).allMatch).toBe(false);
  });

  it('compares live mode only when the caller supplies one', () => {
    expect(checkPaymentBinding(attempt, payment, { liveMode: null }).modeMatch).toBe(true);
    expect(checkPaymentBinding(attempt, payment, { liveMode: false }).modeMatch).toBe(true);
    // A LIVE webhook claiming to settle a TEST attempt is refused.
    expect(checkPaymentBinding(attempt, payment, { liveMode: true }).allMatch).toBe(false);
    expect(checkPaymentBinding({ ...attempt, mode: 'live' }, payment, { liveMode: true }).allMatch).toBe(true);
  });

  it('never throws on a malformed payment', () => {
    expect(() => checkPaymentBinding(attempt, {})).not.toThrow();
    expect(checkPaymentBinding(attempt, {}).allMatch).toBe(false);
  });
});

describe('selectInvoicePayment', () => {
  const failed = { id: 'p1', status: 'failed', created_at: '2026-08-24T10:00:00Z' };
  const paid = { id: 'p2', status: 'paid', created_at: '2026-08-24T10:05:00Z' };

  it('prefers the settled payment over a failed earlier attempt', () => {
    expect(selectInvoicePayment({ payments: [failed, paid] })?.id).toBe('p2');
    expect(selectInvoicePayment({ payments: [paid, failed] })?.id).toBe('p2');
  });
  it('accepts captured as settled too', () => {
    expect(selectInvoicePayment({ payments: [{ id: 'p3', status: 'captured' }] })?.id).toBe('p3');
  });
  it('falls back to the most recent attempt so a real reason can be reported', () => {
    const older = { id: 'p0', status: 'failed', created_at: '2026-08-24T09:00:00Z' };
    expect(selectInvoicePayment({ payments: [older, failed] })?.id).toBe('p1');
  });
  it('returns null when the invoice has no payments', () => {
    expect(selectInvoicePayment({ payments: [] })).toBeNull();
    expect(selectInvoicePayment({})).toBeNull();
    expect(selectInvoicePayment({ payments: 'nope' } as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe('resolveMoyasarConfig key namespacing', () => {
  /**
   * secret_config is MERGED on save, so Tap's old `test_secret_key` survives in
   * the payment row wherever it was ever saved — and a Tap test key is also
   * `sk_test_`-prefixed. Reading that name would treat a different gateway's
   * credential as a ready Moyasar key.
   */
  it('does not read Tap-shaped key names', () => {
    const c = resolveMoyasarConfig(true, 'moyasar',
      { mode: 'test' },
      { test_secret_key: 'sk_test_tap_key', webhook_secret_token: 'wh' });
    expect(c.secretKey).toBe('');
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('missing_key');
  });

  it('reads its own namespaced names', () => {
    const c = resolveMoyasarConfig(true, 'moyasar',
      { mode: 'test' },
      { moyasar_test_secret_key: 'sk_test_x', moyasar_webhook_secret_token: 'wh' });
    expect(c.ok).toBe(true);
    expect(c.secretKey).toBe('sk_test_x');
  });
});
