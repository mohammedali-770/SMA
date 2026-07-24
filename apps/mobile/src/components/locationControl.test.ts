import { describe, expect, it } from 'vitest';

import {
  FIX_FRESH_MS,
  classifyLocateFailure,
  isFixFresh,
  isUsableFix,
  locateErrorCopy,
  locateFailureMessage,
  roundCoord,
  shouldStartLocate,
} from './locationControl';

describe('shouldStartLocate', () => {
  it('honours a press from idle and after a failure', () => {
    expect(shouldStartLocate('idle')).toBe(true);
    expect(shouldStartLocate('error')).toBe(true);
  });

  it('ignores repeated presses while a fix is already in flight', () => {
    // The defect this guards: each extra tap queued another GPS request, so the
    // control got slower the more impatiently it was pressed.
    expect(shouldStartLocate('locating')).toBe(false);
  });
});

describe('isFixFresh', () => {
  const now = 1_000_000;

  it('reuses a just-obtained fix so re-opening feels instant', () => {
    expect(isFixFresh({ lat: 24.7, lng: 46.6, at: now - 1_000 }, now)).toBe(true);
    expect(isFixFresh({ lat: 24.7, lng: 46.6, at: now }, now)).toBe(true);
  });

  it('treats a fix at exactly the freshness bound as still usable', () => {
    expect(isFixFresh({ lat: 24.7, lng: 46.6, at: now - FIX_FRESH_MS }, now)).toBe(true);
  });

  it('discards a stale fix so a customer who moved does not get the old pin', () => {
    expect(isFixFresh({ lat: 24.7, lng: 46.6, at: now - FIX_FRESH_MS - 1 }, now)).toBe(false);
  });

  it('has no fix to reuse when none was taken', () => {
    expect(isFixFresh(null, now)).toBe(false);
  });

  it('treats a future timestamp as stale rather than fresh', () => {
    // A device clock change must not make an arbitrarily old fix look current.
    expect(isFixFresh({ lat: 24.7, lng: 46.6, at: now + 5_000 }, now)).toBe(false);
  });
});

describe('isUsableFix', () => {
  it('accepts a real Riyadh coordinate', () => {
    expect(isUsableFix(24.7136, 46.6753)).toBe(true);
  });

  it('rejects the 0,0 null island some emulators report as success', () => {
    expect(isUsableFix(0, 0)).toBe(false);
  });

  it('accepts a genuine zero on one axis only', () => {
    expect(isUsableFix(0, 46.6753)).toBe(true);
    expect(isUsableFix(24.7136, 0)).toBe(true);
  });

  it('rejects out-of-range, non-finite and non-numeric values', () => {
    expect(isUsableFix(91, 0)).toBe(false);
    expect(isUsableFix(-91, 0)).toBe(false);
    expect(isUsableFix(0, 181)).toBe(false);
    expect(isUsableFix(0, -181)).toBe(false);
    expect(isUsableFix(NaN, 46)).toBe(false);
    expect(isUsableFix(Infinity, 46)).toBe(false);
    expect(isUsableFix('24.7', 46)).toBe(false);
    expect(isUsableFix(undefined, undefined)).toBe(false);
  });
});

describe('roundCoord', () => {
  it('rounds to the 6 decimals place_order stores', () => {
    expect(roundCoord(24.71364857123)).toBe(24.713649);
    expect(roundCoord(46.6753)).toBe(46.6753);
  });
});

describe('classifyLocateFailure', () => {
  it('maps browser GeolocationPositionError codes', () => {
    expect(classifyLocateFailure({ code: 1 })).toBe('permission_denied');
    expect(classifyLocateFailure({ code: 2 })).toBe('unavailable');
    expect(classifyLocateFailure({ code: 3 })).toBe('timeout');
  });

  it('maps Expo permission status strings', () => {
    expect(classifyLocateFailure('denied')).toBe('permission_denied');
    expect(classifyLocateFailure('Location permission not granted')).toBe('permission_denied');
  });

  it('maps thrown Errors by message', () => {
    expect(classifyLocateFailure(new Error('Location request timed out'))).toBe('timeout');
    expect(classifyLocateFailure(new Error('Network request failed'))).toBe('network');
    expect(classifyLocateFailure(new Error('Location services are unavailable'))).toBe('unavailable');
  });

  it('falls back to unknown rather than throwing on odd input', () => {
    expect(classifyLocateFailure(null)).toBe('unknown');
    expect(classifyLocateFailure(undefined)).toBe('unknown');
    expect(classifyLocateFailure(42)).toBe('unknown');
    expect(classifyLocateFailure({})).toBe('unknown');
    expect(classifyLocateFailure(new Error('something odd'))).toBe('unknown');
  });
});

describe('locateFailureMessage', () => {
  const failures = ['permission_denied', 'unavailable', 'timeout', 'network', 'unknown'] as const;

  it('has a message for every failure in both languages', () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const f of failures) {
        expect(locateFailureMessage(f, lang)).toBeTruthy();
      }
    }
  });

  it('always leaves the customer a way forward (dragging the pin)', () => {
    // No location failure is fatal — the map still works by hand, and the copy
    // must say so instead of dead-ending.
    for (const f of failures) {
      expect(locateErrorCopy.en[f].toLowerCase()).toContain('pin');
      expect(locateErrorCopy.ar[f]).toContain('الدبوس');
    }
  });

  it('keeps every message short enough for one inline line', () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const f of failures) {
        expect(locateFailureMessage(f, lang).length).toBeLessThanOrEqual(90);
      }
    }
  });

  it('never leaks map credentials or provider internals into customer copy', () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const f of failures) {
        const m = locateFailureMessage(f, lang).toLowerCase();
        expect(m).not.toContain('aiza');
        expect(m).not.toContain('api key');
        expect(m).not.toContain('googleapis');
        expect(m).not.toContain('referer');
      }
    }
  });
});
