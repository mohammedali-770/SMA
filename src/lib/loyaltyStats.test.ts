import { describe, expect, it } from 'vitest';

import { classifyLoyaltyStatsError, formatCount, loyaltyTiles } from './loyaltyStats';

describe('loyaltyTiles', () => {
  it('derives value and average from the two server figures and the rate', () => {
    const t = loyaltyTiles({ member_count: 5000, points_total: 1_000_079 }, 0.1);
    expect(t.members).toBe(5000);
    expect(t.points).toBe(1_000_079);
    expect(t.value).toBeCloseTo(100_007.9, 6);
    expect(t.averageValue).toBeCloseTo(20.00158, 6);
  });

  it('uses the long-standing 0.1 rate when none is configured', () => {
    expect(loyaltyTiles({ member_count: 2, points_total: 100 }, undefined).value).toBe(10);
    expect(loyaltyTiles({ member_count: 2, points_total: 100 }, 0).value).toBe(10);
  });

  it('reports an average of 0, not NaN, when there are no customers', () => {
    expect(loyaltyTiles({ member_count: 0, points_total: 0 }, 0.1).averageValue).toBe(0);
  });

  it('is entirely unknown — never 0 — when the stats could not be read', () => {
    expect(loyaltyTiles(null, 0.1)).toEqual({ members: null, points: null, value: null, averageValue: null });
  });

  it('treats a malformed answer as unknown rather than as a number', () => {
    expect(loyaltyTiles({ member_count: 'x', points_total: 3 } as never, 0.1).members).toBeNull();
    expect(loyaltyTiles({} as never, 0.1).points).toBeNull();
  });
});

describe('classifyLoyaltyStatsError', () => {
  it('reads PGRST202 as an unapplied migration', () => {
    expect(
      classifyLoyaltyStatsError(
        new Error(
          'Could not find the function public.admin_loyalty_stats without parameters in the schema cache',
        ),
      ),
    ).toEqual({ kind: 'missing-migration' });
  });

  it('keeps any other failure as itself', () => {
    expect(classifyLoyaltyStatsError(new Error('Only staff may read loyalty stats'))).toEqual({
      kind: 'other',
      message: 'Only staff may read loyalty stats',
    });
  });
});

describe('formatCount', () => {
  it('groups with Western digits whatever the browser locale', () => {
    expect(formatCount(1_000_079)).toBe('1,000,079');
    expect(formatCount(0)).toBe('0');
  });
});
