/**
 * How CheckoutScreen uses the card checkout key and the total check (audit
 * F-X02-001). The screen is React Native, so the wiring is asserted on the
 * source, as the other checkout wiring suites do; the logic itself is tested
 * in checkoutSessionKey.test.ts and pendingSession.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(new URL('./CheckoutScreen.tsx', import.meta.url), 'utf8');
const placeOrder = screen.slice(
  screen.indexOf('const placeOrder = async () => {'),
  screen.indexOf('const runOnlinePayment = async ('),
);
const mount = screen.slice(
  screen.indexOf('// On entry, resolve any payment interrupted'),
  screen.indexOf('const placeOrder = async () => {'),
);

describe('the card checkout key covers every input sent to begin_checkout_session', () => {
  it('is derived from the cart key and the same values the order input sends', () => {
    const at = placeOrder.indexOf('const checkoutKey = checkoutSessionKey(cart.idempotencyKey, {');
    expect(at).toBeGreaterThan(-1);
    const keyBlock = placeOrder.slice(at, placeOrder.indexOf('});', at));
    for (const line of [
      'branchId: selectedBranch.id,',
      'orderType,',
      'items: cart.toOrderItems(),',
      "addressId: orderType === 'delivery' ? addressId : null,",
      'couponCode: couponResult?.ok ? couponCode.trim() : null,',
      'notes: normalizeOrderNote(notes),',
      'loyaltyPoints: redeemingPoints,',
    ]) {
      expect(keyBlock).toContain(line);
    }
    const input = placeOrder.slice(placeOrder.indexOf('const orderInput = {'));
    for (const line of [
      'branchId: selectedBranch.id,',
      'items: cart.toOrderItems(),',
      'addressId: deliveryAddressId,',
      'couponCode: couponResult?.ok ? couponCode.trim() : null,',
      'notes: normalizeOrderNote(notes),',
      'loyaltyPoints: redeemingPoints,',
    ]) {
      expect(input).toContain(line);
    }
  });

  it('is computed before recovery, and recovery abandons a checkout begun for other details', () => {
    const key = placeOrder.indexOf('const checkoutKey = checkoutSessionKey(');
    const rec = placeOrder.indexOf('recoverPendingSession({');
    expect(key).toBeGreaterThan(-1);
    expect(rec).toBeGreaterThan(key);
    const recBlock = placeOrder.slice(rec, placeOrder.indexOf('});', rec));
    expect(recBlock).toContain('currentCartKey: cart.idempotencyKey,');
    expect(recBlock).toContain('currentCheckoutKey: checkoutKey,');
    expect(recBlock).toContain('abandon: (id) => payments.abandonSession(id),');
  });

  it('is not used on screen entry, where the details shown are defaults rather than a choice', () => {
    expect(mount).toContain('recoverPendingSession({');
    expect(mount).not.toContain('currentCheckoutKey');
  });

  it('is the key of the card checkout; cash keeps the cart key', () => {
    expect(placeOrder).toContain(
      "idempotencyKey: paymentMethod === 'online' ? checkoutKey : cart.idempotencyKey,",
    );
    expect(placeOrder).not.toMatch(/^\s+idempotencyKey: cart\.idempotencyKey,$/m);
  });

  it('is saved with the pending checkout it begins', () => {
    expect(placeOrder).toContain('await runOnlinePayment(session.id, cart.idempotencyKey, checkoutKey);');
    expect(screen).toContain('await savePendingSession(sessionId, Date.now(), cartKey, checkoutKey);');
  });
});

describe('payment opens only for the total on screen', () => {
  it('compares a newly begun session before opening its payment page', () => {
    const begin = placeOrder.indexOf('const session = await checkout.begin(orderInput);');
    const check = placeOrder.indexOf('!sessionTotalMatchesShown(session.total, totals.total)');
    const open = placeOrder.indexOf('await runOnlinePayment(session.id, cart.idempotencyKey, checkoutKey);');
    expect(begin).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(begin);
    expect(open).toBeGreaterThan(check);
    expect(placeOrder.slice(check, open)).toContain("setError(t('checkoutTotalChanged'));");
  });

  it('compares a resumed session before reopening it, and refuses when it cannot be read', () => {
    const resume = placeOrder.indexOf("if (rec.kind === 'resume') {");
    const read = placeOrder.indexOf('const resumedTotal = await checkout.sessionTotal(rec.sessionId);');
    const check = placeOrder.indexOf('if (!sessionTotalMatchesShown(resumedTotal, totals.total)) {');
    const open = placeOrder.indexOf('await runOnlinePayment(rec.sessionId);');
    expect(resume).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(resume);
    expect(check).toBeGreaterThan(read);
    expect(open).toBeGreaterThan(check);
    expect(placeOrder.slice(check, open)).toContain(
      "setError(t(resumedTotal === null ? 'somethingWentWrong' : 'checkoutEarlierPaymentOpen'));",
    );
  });

  it('says so in both languages', () => {
    const strings = readFileSync(new URL('../../i18n/strings.ts', import.meta.url), 'utf8');
    for (const key of ['checkoutTotalChanged', 'checkoutEarlierPaymentOpen', 'checkoutAlreadyPlaced']) {
      expect(strings.match(new RegExp(`^\\s+${key}: '`, 'gm'))).toHaveLength(2);
    }
  });
});
