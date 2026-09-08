import { describe, expect, it } from 'vitest';

import { expiryNotice, formatExpiryDate } from './loyaltyExpiry';

describe('formatExpiryDate', () => {
  it('formats an ISO date in both languages', () => {
    expect(formatExpiryDate('2027-01-01', 'en')).toBe('1 January 2027');
    expect(formatExpiryDate('2027-01-01', 'ar')).toBe('1 يناير 2027');
    expect(formatExpiryDate('2026-12-28', 'en')).toBe('28 December 2026');
  });

  it('does not shift the day across a time zone', () => {
    // Parsed by hand precisely so this holds wherever the device is. `new
    // Date('2027-01-01')` is UTC midnight, which is the previous day west of
    // Greenwich — a customer in that position would be told the wrong date.
    expect(formatExpiryDate('2027-01-01', 'en')).toContain('1 January');
  });

  it('returns null rather than guessing at anything that is not a plain date', () => {
    expect(formatExpiryDate('', 'en')).toBeNull();
    expect(formatExpiryDate('2027-01-01T00:00:00Z', 'en')).toBeNull();
    expect(formatExpiryDate('01/01/2027', 'en')).toBeNull();
    expect(formatExpiryDate('2027-13-01', 'en')).toBeNull();
  });
});

describe('expiryNotice — when to stay silent', () => {
  const base = { enabled: true, nextRunOn: '2027-01-01', points: 400, lang: 'en' as const };

  it('shows the date when expiry is on and there is a balance to lose', () => {
    expect(expiryNotice(base)).toBe('1 January 2027');
  });

  it('says nothing when expiry is off', () => {
    expect(expiryNotice({ ...base, enabled: false })).toBeNull();
  });

  it('says nothing when the server has scheduled no reset', () => {
    // The database owns the schedule. No date means no promise.
    expect(expiryNotice({ ...base, nextRunOn: null })).toBeNull();
  });

  it('says nothing to a customer holding no points', () => {
    // "Your 0 points expire on 1 January" is noise, and noise makes the warning
    // worthless for the customers it exists for.
    expect(expiryNotice({ ...base, points: 0 })).toBeNull();
    expect(expiryNotice({ ...base, points: -5 })).toBeNull();
  });

  it('says nothing rather than rendering a malformed date', () => {
    expect(expiryNotice({ ...base, nextRunOn: 'soon' })).toBeNull();
  });
});
