import { describe, expect, it } from 'vitest';

import {
  formatDistanceKm, GPS_MISMATCH_THRESHOLD_KM, MIN_TRUSTED_ACCURACY_M,
  mismatchDistanceKm, mismatchWarning,
} from './deliveryLocationWarning';

// Qatif / Al-Nasirah area, where the delivery pilot actually runs.
const PIN = { lat: 26.5650, lng: 49.9960 };
/** ~600 m from PIN — a customer standing at their own door. */
const NEARBY = { lat: 26.5700, lng: 49.9985 };
/** ~13 km from PIN — Dammam-ish. A genuinely different place. */
const FAR = { lat: 26.4500, lng: 50.0800 };

describe('mismatchDistanceKm — silence is the default', () => {
  it('says nothing without a device fix', () => {
    expect(mismatchDistanceKm(null, PIN)).toBeNull();
    expect(mismatchDistanceKm(undefined, PIN)).toBeNull();
  });

  it('says nothing when the pin has not resolved', () => {
    expect(mismatchDistanceKm(FAR, { lat: null, lng: null })).toBeNull();
    expect(mismatchDistanceKm(FAR, { lat: 26.5, lng: undefined })).toBeNull();
  });

  it('rejects non-finite coordinates rather than warning on NaN', () => {
    expect(mismatchDistanceKm({ lat: Number.NaN, lng: 50 }, PIN)).toBeNull();
    expect(mismatchDistanceKm({ lat: 26.5, lng: Number.POSITIVE_INFINITY }, PIN)).toBeNull();
    expect(mismatchDistanceKm(FAR, { lat: Number.NaN, lng: 50 })).toBeNull();
  });

  it('treats the null island as "no fix", not as a location', () => {
    expect(mismatchDistanceKm({ lat: 0, lng: 0 }, PIN)).toBeNull();
    expect(mismatchDistanceKm(FAR, { lat: 0, lng: 0 })).toBeNull();
  });

  it('will not warn on a fix too vague to support the claim', () => {
    expect(mismatchDistanceKm({ ...FAR, accuracyM: MIN_TRUSTED_ACCURACY_M + 1 }, PIN)).toBeNull();
    expect(mismatchDistanceKm({ ...FAR, accuracyM: 5000 }, PIN)).toBeNull();
    // At or under the bound the fix is trusted.
    expect(mismatchDistanceKm({ ...FAR, accuracyM: MIN_TRUSTED_ACCURACY_M }, PIN)).not.toBeNull();
    // An absent or null accuracy is not the same as a bad one.
    expect(mismatchDistanceKm({ ...FAR, accuracyM: null }, PIN)).not.toBeNull();
    expect(mismatchDistanceKm(FAR, PIN)).not.toBeNull();
  });
});

describe('mismatchDistanceKm — the threshold', () => {
  it('stays quiet for a customer at their own address', () => {
    expect(mismatchDistanceKm(NEARBY, PIN)).toBeNull();
  });

  it('reports the distance when they are genuinely elsewhere', () => {
    const km = mismatchDistanceKm(FAR, PIN);
    expect(km).not.toBeNull();
    expect(km as number).toBeGreaterThan(GPS_MISMATCH_THRESHOLD_KM);
  });

  it('is exclusive at the boundary — exactly the threshold does not warn', () => {
    expect(mismatchDistanceKm(FAR, PIN, 1_000_000)).toBeNull();
    const km = mismatchDistanceKm(FAR, PIN) as number;
    expect(mismatchDistanceKm(FAR, PIN, km)).toBeNull();
    expect(mismatchDistanceKm(FAR, PIN, km - 0.001)).not.toBeNull();
  });

  it('is symmetric — swapping device and pin gives the same distance', () => {
    const a = mismatchDistanceKm(FAR, PIN) as number;
    const b = mismatchDistanceKm({ lat: PIN.lat, lng: PIN.lng }, FAR) as number;
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('formatDistanceKm', () => {
  it('keeps one decimal at short range and rounds beyond 10km', () => {
    expect(formatDistanceKm(2.44, 'en')).toBe('2.4 km');
    expect(formatDistanceKm(9.99, 'en')).toBe('10.0 km');
    expect(formatDistanceKm(23.4, 'en')).toBe('23 km');
  });

  it('uses Arabic-Indic digits and the Arabic decimal separator', () => {
    expect(formatDistanceKm(2.4, 'ar')).toBe('٢٫٤ كم');
    expect(formatDistanceKm(23.4, 'ar')).toBe('٢٣ كم');
  });
});

describe('mismatchWarning', () => {
  it('returns nothing when there is nothing to say', () => {
    expect(mismatchWarning(NEARBY, PIN, 'ar')).toBeNull();
    expect(mismatchWarning(null, PIN, 'en')).toBeNull();
  });

  it('names the distance in both languages', () => {
    const ar = mismatchWarning(FAR, PIN, 'ar');
    const en = mismatchWarning(FAR, PIN, 'en');
    expect(ar?.title).toContain('كم');
    expect(en?.title).toContain('km');
    // Body must not read as a rejection — it states what will happen.
    expect(ar?.body).toContain('سنوصل');
    expect(en?.body).toContain('We will deliver');
  });

  it('never phrases the warning as a block', () => {
    const en = mismatchWarning(FAR, PIN, 'en');
    for (const word of ['cannot', 'not allowed', 'invalid', 'error']) {
      expect(`${en?.title} ${en?.body}`.toLowerCase()).not.toContain(word);
    }
  });
});
