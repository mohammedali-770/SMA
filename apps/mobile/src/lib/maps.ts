/**
 * Deep links into the device's maps app for branch directions.
 *
 * Pure and framework-free apart from `Platform`, so the URL shapes are unit
 * tested rather than trusted. Each platform gets the link its users expect:
 *
 *   iOS      Apple Maps (`maps.apple.com`) — a universal link, so it opens the
 *            app when installed and Safari when not. Never the `maps://`
 *            scheme, which fails outright if Apple Maps has been removed.
 *   Android  the `geo:` intent, which lets the customer pick whichever maps
 *            app they actually use rather than forcing one.
 *   web      Google Maps directions.
 *
 * `dirflg=d` asks for driving directions specifically, since the customer is
 * travelling to a branch to collect an order.
 *
 * FRAMEWORK-FREE ON PURPOSE. The mobile unit suite runs under the Node
 * environment and cannot import `react-native`, so the platform-aware wrapper
 * lives in `mapsLink.ts` and only the URL shapes — the part worth testing —
 * are here.
 */

/** Coordinates are only usable when both are finite and in range. */
export function hasUsableCoordinates(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
    // 0,0 is the Atlantic. It is what an unset column looks like, and sending a
    // customer there is worse than hiding the button.
    && !(lat === 0 && lng === 0)
  );
}

/** Build the directions URL for a platform. Exported for tests. */
export function buildDirectionsUrl(
  platform: 'ios' | 'android' | 'web',
  lat: number,
  lng: number,
  label?: string,
): string {
  const coords = `${lat},${lng}`;
  if (platform === 'ios') {
    const q = label ? `&q=${encodeURIComponent(label)}` : '';
    return `https://maps.apple.com/?daddr=${coords}&dirflg=d${q}`;
  }
  if (platform === 'android') {
    // The label in parentheses is what the picker shows as the destination.
    return label ? `geo:${coords}?q=${coords}(${encodeURIComponent(label)})` : `geo:${coords}?q=${coords}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=driving`;
}
