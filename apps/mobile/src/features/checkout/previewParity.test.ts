/**
 * The checkout preview against the SERVER, measured rather than assumed (gap PG-31).
 *
 * `previewParity.fixture.json` holds what `compute_order_snapshot` answered for a
 * table of carts, on a local database built from this repository's migration
 * chain (`place_order` agreed on every amount, or the fixture could not have been
 * written). Each cart goes through `computePreviewTotals` here with exactly what
 * the checkout screen would pass it, and every amount must come out the same.
 *
 * WHY A FIXTURE AND NOT HAND-WRITTEN EXPECTATIONS. The bug this guards was a
 * preview that applied the rule its author believed in (balance times point
 * value, capped at the goods) instead of the rule the server runs (whole points
 * that fit, none below the minimum, delivery fee included). A test written from
 * the same belief would have passed. These numbers come from the server itself.
 *
 * Regenerate with `bash scripts/checkout-preview-parity.sh`. The SQL suite that
 * produced the fixture runs in CI and fails when the server's answers move, so
 * the fixture cannot quietly go stale while this test keeps passing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { computePreviewTotals } from './previewTotals';
import type { CartItem, Product } from '../../types/models';

interface ParityCase {
  n: number;
  name: string;
  orderType: 'pickup' | 'delivery';
  comped: boolean;
  lines: { product: string; unitPrice: number; quantity: number }[];
  coupon: string | null;
  requestedPoints: number;
  balance: number;
  settings: { minPointsToRedeem: number; discountPerPoint: number; pickupOnly: boolean };
  server: {
    subtotal: number;
    deliveryFee: number;
    couponDiscount: number | null;
    discountAmount: number;
    loyaltyPointsRedeemed: number;
    loyaltyDiscountAmount: number;
    total: number;
    compDiscountAmount: number;
    isComped: boolean;
  };
}

interface ParityFixture {
  digest: string;
  branch: { deliveryFee: number; minDeliveryOrder: number };
  cases: ParityCase[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./previewParity.fixture.json', import.meta.url), 'utf8'),
) as ParityFixture;

function cartLine(l: ParityCase['lines'][number]): CartItem {
  return {
    cartItemId: l.product,
    product: { id: l.product, price: l.unitPrice } as unknown as Product,
    selectedModifiers: {},
    quantity: l.quantity,
    unitPrice: l.unitPrice,
  };
}

/** What CheckoutScreen hands the preview for this cart. */
function previewFor(c: ParityCase) {
  return computePreviewTotals({
    items: c.lines.map(cartLine),
    orderType: c.orderType,
    deliveryFee: fixture.branch.deliveryFee,
    minDeliveryOrder: fixture.branch.minDeliveryOrder,
    // The app's coupon figure IS the server's: `coupons.validate` calls
    // validate_coupon with the cart subtotal, and the fixture recorded that call.
    couponDiscount: c.server.couponDiscount ?? 0,
    // The whole balance with the switch on, 0 with it off: the only two values
    // the app can send (LoyaltyToggle is on or off).
    loyaltyPoints: c.requestedPoints,
    discountPerPoint: c.settings.discountPerPoint,
    minPointsToRedeem: c.settings.minPointsToRedeem,
    loyaltyPickupOnly: c.settings.pickupOnly,
    comped: c.comped,
  });
}

describe('checkout preview matches compute_order_snapshot (PG-31)', () => {
  it('compares a real table of carts, not an empty one', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(20);
    // The carts the gap is about must be in it, or this file proves nothing
    // about PG-31.
    const pg31 = fixture.cases.find((c) => c.n === 2);
    expect(pg31?.server).toMatchObject({ subtotal: 8, loyaltyPointsRedeemed: 0, total: 8 });
    expect(pg31?.requestedPoints).toBeGreaterThanOrEqual(pg31?.settings.minPointsToRedeem ?? Infinity);
    // And the PG-05 shape: a percentage coupon leaves 0.05 after 212 whole
    // points. Trimming it from the case table and regenerating would otherwise
    // keep every check green with the remainder case gone.
    const pg05 = fixture.cases.find((c) => c.n === 12);
    expect(pg05?.coupon).not.toBeNull();
    expect(pg05?.server).toMatchObject({ loyaltyPointsRedeemed: 212, total: 0.05 });
  });

  it.each(fixture.cases.map((c) => [`${c.n}. ${c.name}`, c] as const))('%s', (_label, c) => {
    // Every pair must agree for the APP's reason, not by coincidence: the
    // balance the server saw is the one the app asked for.
    expect(c.requestedPoints === 0 || c.requestedPoints === c.balance).toBe(true);

    const t = previewFor(c);
    expect({
      total: t.total,
      loyaltyDiscount: t.loyaltyDiscount,
      loyaltyPointsRedeemed: t.loyaltyPointsRedeemed,
      couponDiscount: t.couponDiscount,
      compDiscount: t.compDiscount,
      deliveryFee: t.deliveryFee,
      subtotal: t.subtotal,
    }).toEqual({
      total: c.server.total,
      loyaltyDiscount: c.server.loyaltyDiscountAmount,
      loyaltyPointsRedeemed: c.server.loyaltyPointsRedeemed,
      couponDiscount: c.server.discountAmount,
      compDiscount: c.server.compDiscountAmount,
      deliveryFee: c.server.deliveryFee,
      subtotal: c.server.subtotal,
    });
  });

  it('is the fixture the SQL suite holds the server to', () => {
    // The two halves are one check only if they share a digest: the suite
    // refuses in CI when the server's answers no longer produce this value.
    const suite = readFileSync(
      new URL('../../../../../supabase/tests/checkout_preview_parity_test.sql', import.meta.url),
      'utf8',
    );
    expect(suite.split('\n')).toContain(`\\set parity_expected_digest '${fixture.digest}'`);
  });
});

describe('CheckoutScreen hands the preview what the server rule needs', () => {
  // A source-level check, in the style of paymentWebViewWiring.test.ts: the
  // screen cannot be rendered here, and a preview that is right in isolation is
  // still wrong on screen if it is never given the minimum.
  const screen = readFileSync(new URL('./CheckoutScreen.tsx', import.meta.url), 'utf8');
  const call = screen.slice(
    screen.indexOf('const totals = useMemo(() => computePreviewTotals({'),
    screen.indexOf('}), [cart.items, orderType'),
  );

  it('passes the redemption minimum, failing closed when it is unknown', () => {
    expect(call).toContain('minPointsToRedeem: loyalty?.minPointsToRedeem ?? Infinity,');
  });

  it('gives the summary the same pickup-only answer as the switch and the submission', () => {
    // The fresher value read during checkout, not the launch-time snapshot.
    // With `loyalty?.pickupOnly` here, an administrator relaxing the rule
    // mid-checkout would leave the summary withholding a delivery redemption
    // the server grants.
    expect(screen).toContain('const loyaltyPickupOnly = pickupOnlyOverride ?? loyalty?.pickupOnly ?? true;');
    expect(screen).toContain("const loyaltyChannelOk = !loyaltyPickupOnly || orderType === 'pickup';");
    expect(call).toMatch(/^\s+loyaltyPickupOnly,$/m);
    expect(call).not.toContain('loyalty?.pickupOnly');
    const deps = screen.slice(screen.indexOf('}), [cart.items, orderType'));
    expect(deps.slice(0, deps.indexOf(']);'))).toContain('loyaltyPickupOnly');
  });

  it('asks for the whole balance or nothing, which is what the parity carts assume', () => {
    expect(call).toContain('loyaltyPoints: redeemingPoints,');
    expect(screen).toContain(
      'const redeemingPoints = redeemPoints && loyaltyChannelOk ? availablePoints : 0;',
    );
  });

  it('says why when the switch is on and the order is too small for any points', () => {
    const toggle = screen.slice(screen.indexOf('<LoyaltyToggle'), screen.indexOf('<LoyaltyChannelNote'));
    expect(toggle).toContain('totals.loyaltyOrderTooSmall');
    expect(toggle).toContain(
      "t('loyaltyOrderTooSmall').replace('{amount}', totals.loyaltyMinimumOrder.toFixed(2))",
    );
  });

  it('lets a screen reader hear that note too', () => {
    // LoyaltyToggle's accessibilityLabel replaces the text inside it, so the
    // caption carrying the note must be part of the label.
    const toggle = readFileSync(new URL('./view/LoyaltyToggle.tsx', import.meta.url), 'utf8');
    expect(toggle).toContain('accessibilityLabel={`${label}. ${pointsLabel}`}');
    expect(toggle).not.toMatch(/accessibilityLabel=\{label\}/);
  });
});
