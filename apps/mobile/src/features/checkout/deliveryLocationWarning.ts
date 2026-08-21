/**
 * The "you are not where you are ordering to" rule — FRAMEWORK-FREE and fully
 * unit-tested.
 *
 * Checkout confirms a delivery location the customer chose earlier rather than
 * asking for it again. That removes the re-pick, but it also removes the moment
 * where a customer would have noticed a stale choice — so this restores exactly
 * that one signal, and nothing more.
 *
 * IT IS A WARNING AND NEVER A BLOCK, and that is a product rule, not a
 * threshold to tune. Ordering to somewhere you are not standing is the ordinary
 * case: home while at work, a parent's house, an office, a friend's flat.
 * Treating distance as an error would reject the majority of legitimate
 * delivery orders. `checkoutGuards` is where blocking lives; this returns copy.
 *
 * The device position is OPTIONAL in the strongest sense: permission refused,
 * location services off, an indoor fix that never arrives, a desktop web
 * export — all of them mean "no opinion", never "warn". Silence is the correct
 * output for an unknown position.
 */
import { distanceKm, type GeoPoint } from '../../lib/geo';

/**
 * Distance beyond which the mismatch is worth mentioning, in km.
 *
 * Deliberately generous. A phone's fix drifts by tens or hundreds of metres
 * indoors, and a customer standing in the next street is not making a mistake.
 * This is set to catch "you are in a different part of town / a different
 * city", which is the case where a stale saved location actually costs someone
 * their food. Lowering it turns a useful signal into noise the customer learns
 * to dismiss, which is worse than not showing it at all.
 */
export const GPS_MISMATCH_THRESHOLD_KM = 2;

/** Below this the reading is not trustworthy enough to warn on. Metres. */
export const MIN_TRUSTED_ACCURACY_M = 500;

export interface DeviceFix {
  lat: number;
  lng: number;
  /** Reported horizontal accuracy in metres, when the platform provides one. */
  accuracyM?: number | null;
}

function usable(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Distance in km when the device is far enough from the delivery pin to be
 * worth mentioning, or `null` for "say nothing".
 *
 * Null is returned for every uncertain case by design: no fix, a fix at the
 * null island, a non-finite coordinate, an accuracy so poor the distance would
 * be guesswork, or a pin that has not resolved.
 */
export function mismatchDistanceKm(
  device: DeviceFix | null | undefined,
  pin: { lat: number | null | undefined; lng: number | null | undefined },
  thresholdKm: number = GPS_MISMATCH_THRESHOLD_KM,
): number | null {
  if (!device) return null;
  if (!usable(device.lat) || !usable(device.lng)) return null;
  if (!usable(pin.lat) || !usable(pin.lng)) return null;
  // (0,0) is the classic "no fix" sentinel, not a location in Saudi Arabia.
  if (device.lat === 0 && device.lng === 0) return null;
  if (pin.lat === 0 && pin.lng === 0) return null;
  // A fix known to be vague cannot support a claim about distance.
  if (usable(device.accuracyM) && device.accuracyM > MIN_TRUSTED_ACCURACY_M) return null;

  const a: GeoPoint = { lat: device.lat, lng: device.lng };
  const b: GeoPoint = { lat: pin.lat, lng: pin.lng };
  const d = distanceKm(a, b);
  if (!Number.isFinite(d) || d <= thresholdKm) return null;
  return d;
}

/**
 * One decimal below 10km, whole numbers above — a courier does not care whether
 * it is 23.4km or 23km, but 2.4km and 2km read differently at short range.
 */
export function formatDistanceKm(km: number, lang: 'ar' | 'en'): string {
  const value = km < 10 ? km.toFixed(1) : String(Math.round(km));
  // Arabic-Indic digits so the number matches every other figure in the AR UI.
  const digits = lang === 'ar'
    ? value.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]).replace('.', '٫')
    : value;
  return lang === 'ar' ? `${digits} كم` : `${digits} km`;
}

/** The warning copy, or null when there is nothing to say. */
export function mismatchWarning(
  device: DeviceFix | null | undefined,
  pin: { lat: number | null | undefined; lng: number | null | undefined },
  lang: 'ar' | 'en',
): { title: string; body: string } | null {
  const km = mismatchDistanceKm(device, pin);
  if (km == null) return null;
  const d = formatDistanceKm(km, lang);
  return lang === 'ar'
    ? {
      title: `موقعك الحالي يبعد ${d} عن موقع التوصيل`,
      body: 'سنوصل إلى الموقع المحدّد أعلاه. غيّره فقط إذا لم يكن صحيحاً.',
    }
    : {
      title: `You are ${d} away from the delivery location`,
      body: 'We will deliver to the location shown above. Change it only if it is wrong.',
    };
}
