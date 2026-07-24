/**
 * Current-location control logic — FRAMEWORK-FREE and fully unit-tested.
 *
 * The map's "use my location" action used to be a full-width button below the
 * map that awaited a fresh high-accuracy GPS fix on every press, with no busy
 * state on the control itself and no guard against repeated taps. On a cold GPS
 * that reads as "nothing happened", so customers tapped again and queued more
 * fixes, each slower than the last.
 *
 * The rules live here so they can be tested without a renderer:
 *   - one request in flight at a time (`shouldStartLocate`);
 *   - a recent fix is reused for instant feedback, then refreshed in the
 *     background (`isFixFresh`);
 *   - every failure mode maps to one short bilingual line (`locateErrorCopy`).
 */

/**
 * How long a previously obtained fix stays good enough to show immediately.
 * 60s: long enough to make a re-open feel instant, short enough that a customer
 * who walked to a different building does not get the old pin.
 */
export const FIX_FRESH_MS = 60_000;

/** Give up on a fix after this long and tell the customer, rather than hang. */
export const LOCATE_TIMEOUT_MS = 12_000;

export type LocateState = 'idle' | 'locating' | 'error';

export type LocateFailure =
  | 'permission_denied'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'unknown';

export interface CachedFix {
  lat: number;
  lng: number;
  /** ms epoch when the fix was obtained. */
  at: number;
}

/**
 * Guard against duplicate work. A press is only honoured from `idle`/`error`;
 * while `locating` the control shows a spinner and further presses are ignored
 * (rather than disabled-and-silent, which reads as a broken button).
 */
export function shouldStartLocate(state: LocateState): boolean {
  return state !== 'locating';
}

/** True when a cached fix may be shown immediately. */
export function isFixFresh(fix: CachedFix | null, now: number, maxAgeMs = FIX_FRESH_MS): boolean {
  if (!fix) return false;
  const age = now - fix.at;
  // A negative age means a clock change, not a fresh fix — treat as stale.
  return age >= 0 && age <= maxAgeMs;
}

/**
 * Coordinate sanity. Rejects the null-island 0,0 that some emulators report as
 * a "successful" fix, which would silently move the pin to the Atlantic.
 */
export function isUsableFix(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Round to 6 decimals (~0.1 m) — the precision place_order stores. */
export function roundCoord(n: number): number {
  return Number(n.toFixed(6));
}

/**
 * Classify a thrown value or permission status into one failure. Expo surfaces
 * these inconsistently across platforms (an Error, a rejected status string, or
 * a DOM GeolocationPositionError on web), so all three shapes are handled.
 */
export function classifyLocateFailure(input: unknown): LocateFailure {
  if (typeof input === 'string') {
    const s = input.toLowerCase();
    if (s.includes('denied') || s.includes('permission')) return 'permission_denied';
    if (s.includes('timeout') || s.includes('timed out')) return 'timeout';
    if (s.includes('network')) return 'network';
    if (s.includes('unavailable')) return 'unavailable';
    return 'unknown';
  }
  // Browser geolocation: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT.
  if (input && typeof input === 'object' && 'code' in input) {
    const code = (input as { code?: unknown }).code;
    if (code === 1) return 'permission_denied';
    if (code === 2) return 'unavailable';
    if (code === 3) return 'timeout';
  }
  if (input instanceof Error) return classifyLocateFailure(input.message);
  return 'unknown';
}

/**
 * One short line per failure, both languages. Deliberately actionable: the
 * customer can always still drag the pin, so no failure here is fatal and none
 * of these messages should alarm.
 */
export const locateErrorCopy = {
  en: {
    permission_denied: 'Location is off. Drag the pin instead, or enable location in settings.',
    unavailable: "Couldn't get your location. Drag the pin to your spot.",
    timeout: 'Location is taking too long. Drag the pin instead.',
    network: 'No connection. Drag the pin to your spot.',
    unknown: "Couldn't get your location. Drag the pin to your spot.",
  },
  ar: {
    permission_denied: 'خدمة الموقع مغلقة. حرّك الدبوس يدوياً أو فعّل الموقع من الإعدادات.',
    unavailable: 'لم نتمكن من تحديد موقعك. حرّك الدبوس إلى مكانك.',
    timeout: 'تحديد الموقع يستغرق وقتاً طويلاً. حرّك الدبوس يدوياً.',
    network: 'لا يوجد اتصال. حرّك الدبوس إلى مكانك.',
    unknown: 'لم نتمكن من تحديد موقعك. حرّك الدبوس إلى مكانك.',
  },
} as const;

export type LocateLang = keyof typeof locateErrorCopy;

export function locateFailureMessage(failure: LocateFailure, lang: LocateLang): string {
  return locateErrorCopy[lang][failure];
}
