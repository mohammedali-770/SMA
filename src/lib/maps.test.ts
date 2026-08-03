import { describe, expect, it } from 'vitest';

import { isPlottable, mapsUrlFor } from './maps';

describe('isPlottable', () => {
  it('accepts a real Riyadh coordinate', () => {
    expect(isPlottable(24.7136, 46.6753)).toBe(true);
  });

  it('rejects (0,0) — the classic "coordinates failed to load" value', () => {
    // A real Saudi address is never at null island; sending a driver there is
    // worse than showing no link at all.
    expect(isPlottable(0, 0)).toBe(false);
  });

  it('accepts a genuine zero on one axis only', () => {
    expect(isPlottable(0, 46.6753)).toBe(true);
    expect(isPlottable(24.7136, 0)).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(isPlottable(91, 46)).toBe(false);
    expect(isPlottable(24, 181)).toBe(false);
    expect(isPlottable(-91, 46)).toBe(false);
  });

  it('rejects non-numbers, NaN and Infinity', () => {
    expect(isPlottable(undefined, undefined)).toBe(false);
    expect(isPlottable(null, null)).toBe(false);
    expect(isPlottable('24.7', '46.6')).toBe(false);
    expect(isPlottable(NaN, 46)).toBe(false);
    expect(isPlottable(24, Infinity)).toBe(false);
  });
});

describe('mapsUrlFor', () => {
  it('builds a cross-platform maps URL', () => {
    expect(mapsUrlFor(24.7136, 46.6753))
      .toBe('https://www.google.com/maps/search/?api=1&query=24.7136,46.6753');
  });

  it('returns null rather than a broken link when coordinates are unusable', () => {
    expect(mapsUrlFor(0, 0)).toBeNull();
    expect(mapsUrlFor(undefined, undefined)).toBeNull();
    expect(mapsUrlFor(NaN, 46)).toBeNull();
  });

  it('handles negative coordinates', () => {
    expect(mapsUrlFor(-33.8688, 151.2093))
      .toBe('https://www.google.com/maps/search/?api=1&query=-33.8688,151.2093');
  });
});
