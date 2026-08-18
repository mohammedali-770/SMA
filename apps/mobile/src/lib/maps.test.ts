import { describe, expect, it } from 'vitest';

import { buildDirectionsUrl, hasUsableCoordinates } from './maps';

const RIYADH = { lat: 24.7136, lng: 46.6753 };

describe('hasUsableCoordinates', () => {
  it('accepts a real branch location', () => {
    expect(hasUsableCoordinates(RIYADH.lat, RIYADH.lng)).toBe(true);
  });

  it('rejects 0,0 — an unset column, not a branch in the Atlantic', () => {
    expect(hasUsableCoordinates(0, 0)).toBe(false);
  });

  it('rejects missing, non-numeric and out-of-range values', () => {
    expect(hasUsableCoordinates(undefined, undefined)).toBe(false);
    expect(hasUsableCoordinates(null, null)).toBe(false);
    expect(hasUsableCoordinates('24.7', '46.6')).toBe(false);
    expect(hasUsableCoordinates(NaN, 46)).toBe(false);
    expect(hasUsableCoordinates(91, 46)).toBe(false);
    expect(hasUsableCoordinates(24, 181)).toBe(false);
  });
});

describe('buildDirectionsUrl', () => {
  it('uses an Apple Maps universal link on iOS, not the maps:// scheme', () => {
    const url = buildDirectionsUrl('ios', RIYADH.lat, RIYADH.lng, 'الناصرة');
    expect(url.startsWith('https://maps.apple.com/')).toBe(true);
    expect(url).not.toContain('maps://');
    expect(url).toContain('daddr=24.7136,46.6753');
    expect(url).toContain('dirflg=d');
  });

  it('uses the geo: intent on Android so the customer picks their maps app', () => {
    const url = buildDirectionsUrl('android', RIYADH.lat, RIYADH.lng, 'Al Nasrah');
    expect(url.startsWith('geo:24.7136,46.6753')).toBe(true);
    expect(url).toContain('Al%20Nasrah');
  });

  it('falls back to Google Maps directions on web', () => {
    const url = buildDirectionsUrl('web', RIYADH.lat, RIYADH.lng);
    expect(url).toContain('google.com/maps/dir/');
    expect(url).toContain('destination=24.7136,46.6753');
  });

  it('escapes an Arabic branch name rather than emitting raw text', () => {
    const url = buildDirectionsUrl('ios', RIYADH.lat, RIYADH.lng, 'الناصرة');
    expect(url).toContain(encodeURIComponent('الناصرة'));
    expect(url).not.toContain('الناصرة');
  });

  it('omits the label entirely when there is none', () => {
    expect(buildDirectionsUrl('ios', 1, 2)).not.toContain('&q=');
    expect(buildDirectionsUrl('android', 1, 2)).toBe('geo:1,2?q=1,2');
  });
});
