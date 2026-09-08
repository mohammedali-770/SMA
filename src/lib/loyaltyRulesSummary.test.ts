import { describe, expect, it } from 'vitest';

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
});
