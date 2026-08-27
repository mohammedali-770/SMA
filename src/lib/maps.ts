/**
 * Map deep links for delivery addresses.
 *
 * Delivery orders DO reach the POS as of 2026-08-27, and the ticket carries the
 * address twice (`delivery_address` plus a DELIVER TO line in the note). There
 * is still no driver or dispatch feature, so the last leg is coordinated by a
 * human reading the address off this console and phoning or driving it — and
 * coordinates are still not sent to the POS at all, because the contract has no
 * field for them. A tappable map link therefore remains the difference between
 * reading coordinates aloud and opening the destination.
 *
 * Pure and framework-free so it is unit-tested under Node.
 */

/** Riyadh is ~24.7N 46.7E; these are the global bounds, not Saudi-specific. */
const LAT_MAX = 90;
const LNG_MAX = 180;

export function isPlottable(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= LAT_MAX
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= LNG_MAX
    // (0,0) is in the Atlantic. It is never a real Saudi delivery address and is
    // the classic "coordinates failed to load" value, so treat it as absent
    // rather than sending a driver to the Gulf of Guinea.
    && !(lat === 0 && lng === 0)
  );
}

/**
 * A universal maps URL for the given point, or null when the coordinates are
 * unusable.
 *
 * Uses Google's cross-platform `?api=1` search form deliberately: the admin
 * console runs in a browser on whatever device the branch has, and this one URL
 * opens the Google Maps app on Android and iOS when installed and falls back to
 * the web map otherwise. A geo: URI would be Android-only; an Apple Maps URL
 * would be iOS-only.
 */
export function mapsUrlFor(lat: unknown, lng: unknown): string | null {
  if (!isPlottable(lat, lng)) return null;
  // Coordinates are numbers validated above, so this cannot inject into the URL.
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
