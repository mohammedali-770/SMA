import { describe, expect, it } from 'vitest';

import type { LoyaltyCampaign } from './loyaltyCampaignsApi';
import { loyaltyRulesSummary } from './loyaltyRulesSummary';
import type { LoyaltySettings } from '../types';

const base: LoyaltySettings = {
  isEnabled: true,
  pointsPerRiyal: 1,
  minPointsToRedeem: 100,
  discountPerPoint: 0.1,
  pickupOnly: true,
  expiryEnabled: false,
  expiryAnchorMonth: 1,
  expiryAnchorDay: 1,
  expiryPeriodMonths: 12,
  expiryNextRunOn: null,
};

const ids = (s: LoyaltySettings) => loyaltyRulesSummary(s).map((l) => l.id);
const line = (s: LoyaltySettings, id: string) => loyaltyRulesSummary(s).find((l) => l.id === id)!;

describe('loyaltyRulesSummary', () => {
  it('says only that the programme is off when it is off', () => {
    // Listing an expiry date under a switched-off programme would describe rules
    // that are not running.
    const off = loyaltyRulesSummary({ ...base, isEnabled: false, expiryEnabled: true });
    expect(off).toHaveLength(1);
    expect(off[0].id).toBe('off');
    expect(off[0].tone).toBe('warn');
  });

  it('covers every rule that decides what a customer gets', () => {
    expect(ids(base)).toEqual(['rate', 'floor', 'channel', 'perItem', 'expiry']);
  });

  it('flags the rules that REMOVE customer value, and only those', () => {
    // Tone is the operator's cue. Pickup-only and expiry take something away;
    // a rate and a floor do not.
    const strict = loyaltyRulesSummary({ ...base, pickupOnly: true, expiryEnabled: true });
    expect(strict.filter((l) => l.tone === 'warn').map((l) => l.id)).toEqual(['channel', 'expiry']);

    const open = loyaltyRulesSummary({ ...base, pickupOnly: false, expiryEnabled: false });
    expect(open.filter((l) => l.tone === 'warn')).toHaveLength(0);
  });

  it('states both channels when pickup-only is off', () => {
    expect(line({ ...base, pickupOnly: false }, 'channel').en).toContain('Pickup and delivery');
    expect(line(base, 'channel').en).toContain('PICKUP ONLY');
  });

  it('names the actual reset date when expiry is on', () => {
    const l = line({ ...base, expiryEnabled: true, expiryNextRunOn: '2027-01-01' }, 'expiry');
    expect(l.en).toContain('2027-01-01');
    expect(l.tone).toBe('warn');
  });

  it('does not print a bare "null" when expiry is on but unscheduled', () => {
    const l = line({ ...base, expiryEnabled: true, expiryNextRunOn: null }, 'expiry');
    expect(l.en).not.toContain('null');
    expect(l.ar).not.toContain('null');
  });

  it('writes whole numbers without decimals', () => {
    // "1.00 point per 1 SAR" reads like a rounding artefact.
    expect(line(base, 'rate').en).toContain('1 point(s)');
    expect(line({ ...base, pointsPerRiyal: 1.5 }, 'rate').en).toContain('1.5 point(s)');
  });

  it('says there is no minimum rather than "at least 0"', () => {
    expect(line({ ...base, minPointsToRedeem: 0 }, 'floor').en).toContain('no minimum');
  });

  it('always carries both languages', () => {
    for (const l of loyaltyRulesSummary({ ...base, expiryEnabled: true })) {
      expect(l.en.length).toBeGreaterThan(0);
      expect(l.ar.length).toBeGreaterThan(0);
      expect(l.ar).not.toBe(l.en);
    }
  });

  it('keeps four decimals, because the column has four', () => {
    // `discount_per_point` is numeric(10,4). Rounding to two turned a saved
    // 0.0051 into "0.01" — nearly double what a point is worth, printed under a
    // heading claiming to state the rule in force.
    expect(line({ ...base, discountPerPoint: 0.0051 }, 'rate').en).toContain('0.0051 SAR');
    // Trailing zeros still go: an ordinary rate must not read as "0.1000".
    expect(line({ ...base, discountPerPoint: 0.1 }, 'rate').en).toContain('0.1 SAR');
  });
});

/**
 * Campaigns. The block is read as authoritative, so the two failure modes are
 * asymmetric: saying nothing when a campaign is running understates the rate,
 * and asserting "none running" when the list never loaded is a claim the code
 * has not checked. The second is worse, so `undefined` stays silent.
 */
describe('loyaltyRulesSummary — campaigns', () => {
  const NOW = new Date('2026-09-15T12:00:00Z');
  const campaign = (over: Partial<LoyaltyCampaign> = {}): LoyaltyCampaign =>
    ({
      id: 'x',
      name_en: 'Double points',
      name_ar: 'نقاط مضاعفة',
      multiplier: 2,
      starts_at: null,
      ends_at: null,
      branch_id: null,
      product_id: null,
      category_id: null,
      is_active: true,
      created_at: '2026-09-01T00:00:00Z',
      ...over,
    }) as LoyaltyCampaign;

  const ids = (c?: LoyaltyCampaign[]) =>
    loyaltyRulesSummary(base, c, NOW).map((l) => l.id);

  it('says nothing about campaigns when the list has not loaded', () => {
    expect(ids(undefined)).not.toContain('campaigns');
  });

  it('states plainly that none is running when the list is empty', () => {
    expect(loyaltyRulesSummary(base, [], NOW).find((l) => l.id === 'campaigns')?.en)
      .toContain('No points campaign is running');
  });

  it('names a live campaign and its multiplier', () => {
    const l = loyaltyRulesSummary(base, [campaign()], NOW).find((x) => x.id === 'campaigns');
    expect(l?.en).toContain('Double points (x2)');
    expect(l?.en).toContain('earn MORE than the rate above');
    expect(l?.ar).toContain('نقاط مضاعفة');
  });

  it('ignores a campaign that is scheduled, finished, or switched off', () => {
    const notYet = campaign({ starts_at: '2026-10-01T00:00:00Z' });
    const over = campaign({ ends_at: '2026-09-01T00:00:00Z' });
    const off = campaign({ is_active: false });
    for (const c of [notYet, over, off]) {
      expect(loyaltyRulesSummary(base, [c], NOW).find((l) => l.id === 'campaigns')?.en)
        .toContain('No points campaign is running');
    }
  });
});
