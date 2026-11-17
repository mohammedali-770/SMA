/**
 * Checkout computes the points summary from FRESH redemption settings, and
 * stops rather than charging something different from what it showed.
 *
 * PR #470 made the summary reproduce the server's redemption exactly — for the
 * settings the app last loaded. `min_points_to_redeem` and `discount_per_point`
 * came from the settings row `CatalogProvider` reads once at launch and never
 * refreshes, and only `loyalty_pickup_only` was re-read, at submission. An
 * administrator changing either value mid-session left the summary showing a
 * points discount the server does not give, and the card page asking for a
 * different amount (docs/PAYMENTS.md §4).
 *
 * Now `catalog.readLoyaltyRedemption()` re-reads all four redemption settings
 * when checkout opens, when the points switch is turned on, and just before
 * submission, and `decideLoyaltyRedemptionChange` refuses a submission whose
 * points figures would move. A failed read changes nothing: the launch-time
 * values stay in use, exactly as before.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }));

import { catalog } from '../../services/api';
import { mapLoyaltyRedemption } from '../../lib/mappers';
import {
  decideLoyaltyRedemptionChange,
  effectiveLoyaltyRedemption,
  withLoyaltyRedemption,
} from './checkoutGuards';
import { computePreviewTotals, type PreviewInput } from './previewTotals';
import type { CartItem, LoyaltySettings, Product } from '../../types/models';

function line(unitPrice: number, quantity: number): CartItem {
  return {
    cartItemId: 'p1',
    product: { id: 'p1', price: unitPrice } as unknown as Product,
    selectedModifiers: {},
    quantity,
    unitPrice,
  };
}

/** The live settings as read 2026-11-14 (docs/readiness PG-31). */
const LIVE = { isEnabled: true, pickupOnly: true, minPointsToRedeem: 100, discountPerPoint: 0.1 };

const launch: LoyaltySettings = {
  ...LIVE,
  pointsPerRiyal: 1,
  expiryEnabled: false,
  expiryNextRunOn: null,
};

/** What CheckoutScreen hands the preview: a pickup order, the whole balance. */
function input(subtotal: number, points: number, s = LIVE): PreviewInput {
  return {
    items: [line(subtotal, 1)],
    orderType: 'pickup',
    deliveryFee: 0,
    minDeliveryOrder: 0,
    couponDiscount: 0,
    loyaltyPoints: s.isEnabled ? points : 0,
    discountPerPoint: s.discountPerPoint,
    minPointsToRedeem: s.minPointsToRedeem,
    loyaltyPickupOnly: s.pickupOnly,
    comped: false,
  };
}

function decide(i: PreviewInput, fresh: Parameters<typeof decideLoyaltyRedemptionChange>[0]['fresh']) {
  return decideLoyaltyRedemptionChange({ displayedInput: i, displayed: computePreviewTotals(i), fresh });
}

describe('mapLoyaltyRedemption — a bad row is never looser than no row', () => {
  it('maps the four columns', () => {
    expect(
      mapLoyaltyRedemption({
        loyalty_enabled: true,
        loyalty_pickup_only: false,
        min_points_to_redeem: 250,
        discount_per_point: 0.05,
      }),
    ).toEqual({ isEnabled: true, pickupOnly: false, minPointsToRedeem: 250, discountPerPoint: 0.05 });
  });

  it('reads numeric columns that arrive as strings', () => {
    expect(
      mapLoyaltyRedemption({
        loyalty_enabled: true,
        loyalty_pickup_only: true,
        min_points_to_redeem: '100',
        discount_per_point: '0.1000',
      }),
    ).toEqual(LIVE);
  });

  it('gives null, NOT a minimum of 0, when the minimum is missing', () => {
    // Number(null) is 0. A minimum of 0 would promise points on a SAR 8.00
    // order that the server, at a minimum of 100, gives none on (PG-31).
    for (const min of [null, undefined, '', 'x', -1]) {
      expect(
        mapLoyaltyRedemption({
          loyalty_enabled: true,
          loyalty_pickup_only: true,
          min_points_to_redeem: min as number | null,
          discount_per_point: 0.1,
        }),
      ).toBeNull();
    }
  });

  it('gives null when the point value is missing', () => {
    for (const per of [null, undefined, '', 'x', -0.1]) {
      expect(
        mapLoyaltyRedemption({
          loyalty_enabled: true,
          loyalty_pickup_only: true,
          min_points_to_redeem: 100,
          discount_per_point: per as number | null,
        }),
      ).toBeNull();
    }
  });

  it('defaults the two switches the way the server does', () => {
    expect(mapLoyaltyRedemption({ min_points_to_redeem: 100, discount_per_point: 0.1 })).toEqual({
      isEnabled: false,
      pickupOnly: true,
      minPointsToRedeem: 100,
      discountPerPoint: 0.1,
    });
  });
});

describe('catalog.readLoyaltyRedemption', () => {
  const select = vi.fn();
  function answer(result: { data: unknown; error: unknown }) {
    select.mockReturnValue({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) });
    from.mockReturnValue({ select });
  }
  beforeEach(() => vi.clearAllMocks());

  it('reads exactly the four redemption columns of the settings row', async () => {
    answer({
      data: {
        loyalty_enabled: true,
        loyalty_pickup_only: true,
        min_points_to_redeem: 100,
        discount_per_point: 0.1,
      },
      error: null,
    });
    await expect(catalog.readLoyaltyRedemption()).resolves.toEqual(LIVE);
    expect(from).toHaveBeenCalledWith('app_settings');
    expect(select).toHaveBeenCalledWith(
      'loyalty_enabled, loyalty_pickup_only, min_points_to_redeem, discount_per_point',
    );
  });

  it('answers null — not a default — when the read fails or finds no row', async () => {
    answer({ data: null, error: { message: 'permission denied' } });
    await expect(catalog.readLoyaltyRedemption()).resolves.toBeNull();
    answer({ data: null, error: null });
    await expect(catalog.readLoyaltyRedemption()).resolves.toBeNull();
  });
});

describe('effectiveLoyaltyRedemption — fresh when read, launch-time otherwise', () => {
  it('uses the fresh values when a read succeeded', () => {
    const fresh = { isEnabled: true, pickupOnly: false, minPointsToRedeem: 300, discountPerPoint: 0.05 };
    expect(effectiveLoyaltyRedemption(launch, fresh)).toEqual(fresh);
  });

  it('falls back to the launch-time values EXACTLY when no read succeeded', () => {
    expect(effectiveLoyaltyRedemption(launch, null)).toEqual(LIVE);
  });

  it('withholds when neither has loaded: off, pickup only, no minimum known, no value', () => {
    expect(effectiveLoyaltyRedemption(null, null)).toEqual({
      isEnabled: false,
      pickupOnly: true,
      minPointsToRedeem: Infinity,
      discountPerPoint: 0,
    });
  });
});

describe('the fresh settings feed the summary', () => {
  it('a fresh point value moves the discount', () => {
    // 30.00 pickup, 500 points: 0.10 a point → 300 points, 30.00 off.
    const shown = computePreviewTotals(input(30, 500));
    expect(shown).toMatchObject({ loyaltyPointsRedeemed: 300, loyaltyDiscount: 30, total: 0 });
    const fresh = computePreviewTotals(
      withLoyaltyRedemption(input(30, 500), { ...LIVE, discountPerPoint: 0.05 }),
    );
    expect(fresh).toMatchObject({ loyaltyPointsRedeemed: 500, loyaltyDiscount: 25, total: 5 });
  });

  it('a fresh minimum decides whether a small order gets any points', () => {
    const fresh = computePreviewTotals(
      withLoyaltyRedemption(input(30, 500), { ...LIVE, minPointsToRedeem: 400 }),
    );
    expect(fresh).toMatchObject({
      loyaltyPointsRedeemed: 0,
      loyaltyDiscount: 0,
      total: 30,
      loyaltyOrderTooSmall: true,
    });
  });

  it('loyalty switched off uses no points', () => {
    const fresh = computePreviewTotals(withLoyaltyRedemption(input(30, 500), { ...LIVE, isEnabled: false }));
    expect(fresh).toMatchObject({ loyaltyPointsRedeemed: 0, loyaltyDiscount: 0, total: 30 });
  });
});

describe('decideLoyaltyRedemptionChange — never charge or spend what was not shown', () => {
  it('blocks when a raised minimum would take the discount away', () => {
    expect(decide(input(30, 500), { ...LIVE, minPointsToRedeem: 400 })).toEqual({ action: 'block' });
  });

  it('blocks when a new point value would change the discount', () => {
    expect(decide(input(30, 500), { ...LIVE, discountPerPoint: 0.05 })).toEqual({ action: 'block' });
  });

  it('blocks when loyalty was switched off', () => {
    expect(decide(input(30, 500), { ...LIVE, isEnabled: false })).toEqual({ action: 'block' });
  });

  it('blocks in the customer’s favour too: a lower minimum would spend points the screen said it would not', () => {
    // SAR 8.00 at a minimum of 100: no points, total 8.00 (the PG-31 cart).
    const i = input(8, 500);
    expect(computePreviewTotals(i)).toMatchObject({ loyaltyPointsRedeemed: 0, total: 8 });
    expect(decide(i, { ...LIVE, minPointsToRedeem: 50 })).toEqual({ action: 'block' });
  });

  it('lets the order through when the figures are the same', () => {
    expect(decide(input(30, 500), LIVE)).toEqual({ action: 'none' });
    // A changed setting that does not move THIS order's figures.
    expect(decide(input(30, 500), { ...LIVE, minPointsToRedeem: 200 })).toEqual({ action: 'none' });
  });

  it('lets the order through when nothing was being spent', () => {
    expect(decide(input(30, 0), { ...LIVE, discountPerPoint: 0.05, minPointsToRedeem: 1 })).toEqual({
      action: 'none',
    });
  });

  it('never blocks on an unknown answer — the server stays the authority', () => {
    expect(decide(input(30, 500), null)).toEqual({ action: 'none' });
  });
});

describe('CheckoutScreen re-reads the settings and acts on them', () => {
  // Source-level, in the style of previewParity.test.ts: the screen cannot be
  // rendered here.
  const screen = readFileSync(new URL('./CheckoutScreen.tsx', import.meta.url), 'utf8');
  const placeOrder = screen.slice(screen.indexOf('const placeOrder = async () => {'));

  it('computes the summary from the fresh settings, falling back to the launch-time ones', () => {
    expect(screen).toContain('const loyaltySettings = effectiveLoyaltyRedemption(loyalty, loyaltyOverride);');
    const memo = screen.slice(
      screen.indexOf('const previewInput = useMemo<PreviewInput>(() => ({'),
      screen.indexOf('const totals = useMemo(() => computePreviewTotals(previewInput), [previewInput]);'),
    );
    expect(memo).toContain('discountPerPoint: loyaltySettings.discountPerPoint,');
    expect(memo).toContain('minPointsToRedeem: loyaltySettings.minPointsToRedeem,');
    expect(memo).not.toMatch(/loyalty\?\.(discountPerPoint|minPointsToRedeem)/);
    expect(memo).toContain('loyaltySettings.discountPerPoint, loyaltySettings.minPointsToRedeem');
    expect(screen).toContain(
      'const loyaltyEnabled = loyaltySettings.isEnabled && availablePoints >= loyaltySettings.minPointsToRedeem;',
    );
  });

  it('keeps a successful read, and only a successful one', () => {
    expect(screen).toContain('const fresh = await catalogApi.readLoyaltyRedemption();');
    expect(screen).toContain('if (fresh && seq === loyaltyReadSeq.current) setLoyaltyOverride(fresh);');
    expect(screen).not.toContain('readLoyaltyPickupOnly');
  });

  it('re-reads the settings and the balance when checkout opens and when the switch is turned on', () => {
    expect(screen).toContain('void readFreshLoyalty();');
    expect(screen).toContain('await refreshProfile();');
    const mount = screen.slice(screen.indexOf('useEffect(() => {\n    refreshLoyalty();'));
    expect(mount.slice(0, mount.indexOf('}, [profile?.id]);'))).toContain('refreshLoyalty();');
    expect(screen).toContain(
      'onToggle={() => { if (!redeemPoints) refreshLoyalty(); setRedeemPoints((v) => !v); }}',
    );
  });

  it('re-reads at submission and stops, before any order or payment, when the figures would move', () => {
    expect(placeOrder).toContain('const freshLoyalty = await readFreshLoyalty();');
    expect(placeOrder).toContain('const freshPickupOnly = freshLoyalty ? freshLoyalty.pickupOnly : null;');
    const call = placeOrder.indexOf('decideLoyaltyRedemptionChange({');
    expect(call).toBeGreaterThan(-1);
    expect(placeOrder.slice(call)).toMatch(
      /^decideLoyaltyRedemptionChange\(\{\s+displayedInput: previewInput,\s+displayed: totals,\s+fresh: freshLoyalty,\s+\}\);/,
    );
    const block =
      "if (redemptionChange.action === 'block') {\n        setError(t('loyaltyRedemptionChanged'));\n        return;\n      }";
    const at = placeOrder.indexOf(block);
    expect(at).toBeGreaterThan(call);
    // Before anything that creates an order or opens a payment.
    for (const later of ['recoverPendingSession(', 'checkout.begin(', 'orders.placeAndSync(']) {
      expect(placeOrder.indexOf(later)).toBeGreaterThan(at);
    }
  });

  it('says so in both languages', () => {
    const strings = readFileSync(new URL('../../i18n/strings.ts', import.meta.url), 'utf8');
    expect(strings.match(/^\s+loyaltyRedemptionChanged: '/gm)).toHaveLength(2);
  });
});
