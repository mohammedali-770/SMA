/**
 * Google Maps JS API — loader + pure geometry converters (web).
 *
 * The loader injects the official script once (per page) with the browser key
 * from mapConfig and resolves when `window.google.maps` is ready. Components
 * never load it unless the provider is 'google', so the Mapbox path ships no
 * Google bytes and vice versa.
 *
 * The converters are PURE (no google.* types — plain number arrays) so they are
 * unit-tested under Vitest: GeoJSON rings are closed (first point repeated at
 * the end) while Google polygon paths are open, and delivery-zone geometry must
 * round-trip exactly or the server-side RPC rejects it.
 */
import { mapConfig } from './map';

declare global {
  interface Window {
    google?: typeof google;
    __gmapsReady?: Promise<void>;
  }
}

/** [lng, lat] pair as used by GeoJSON. */
export type LngLat = [number, number];

/** Close an open ring GeoJSON-style (append first point when not already closed). */
export function closeRing(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

/** Drop the closing point of a GeoJSON ring for editors that want open paths. */
export function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 2) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring.slice(0, -1) : ring;
}

/**
 * Collect one GeoJSON geometry from a set of drawn polygons (each polygon =
 * array of open rings, ring 0 = outer boundary). One polygon → Polygon; more →
 * MultiPolygon; none → null. Mirrors the Mapbox editor's collectGeometry.
 */
export function polygonsToGeometry(
  polygons: LngLat[][][],
): { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] } | null {
  const cleaned = polygons
    .map(rings => rings.filter(r => r.length >= 3).map(r => closeRing(r).map(p => [...p] as number[])))
    .filter(rings => rings.length > 0);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return { type: 'Polygon', coordinates: cleaned[0] };
  return { type: 'MultiPolygon', coordinates: cleaned };
}

/** Normalize a stored Polygon/MultiPolygon into per-polygon OPEN ring lists. */
export function geometryToPolygons(geometry: { type: string; coordinates: unknown }): LngLat[][][] {
  if (geometry.type === 'Polygon') {
    return [(geometry.coordinates as number[][][]).map(r => openRing(r.map(p => [p[0], p[1]] as LngLat)))];
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as number[][][][]).map(poly =>
      poly.map(r => openRing(r.map(p => [p[0], p[1]] as LngLat))));
  }
  return [];
}

/**
 * Load the Google Maps JS API once. Language follows the admin UI so control
 * tooltips localize; street names themselves are rendered by Google with
 * correct Arabic shaping in every language (the reason for this provider).
 */
function loadCore(isRTL: boolean): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsReady) return window.__gmapsReady;
  window.__gmapsReady = new Promise<void>((resolve, reject) => {
    const cb = '__gmapsOnReady';
    (window as unknown as Record<string, unknown>)[cb] = () => resolve();
    const s = document.createElement('script');
    const params = new URLSearchParams({
      key: mapConfig.googleKey,
      v: 'weekly',
      loading: 'async',
      language: isRTL ? 'ar' : 'en',
      callback: cb,
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onerror = () => { window.__gmapsReady = undefined; reject(new Error('google maps failed to load')); };
    document.head.appendChild(s);
  });
  return window.__gmapsReady;
}

export async function loadGoogleMaps(isRTL: boolean, libraries: string[] = []): Promise<void> {
  await loadCore(isRTL);
  // importLibrary is the officially guaranteed way to have a library ready
  // before use with async loading — URL `libraries=` + callback can race,
  // which surfaced as "google.maps.drawing is undefined" after the map drew.
  await Promise.all(['maps', ...libraries].map(name => window.google!.maps.importLibrary(name)));
}

/**
 * Browser geolocation as a small promise helper. Rejects when unsupported,
 * denied, or when the page's Permissions-Policy blocks it (the vercel.json
 * header must allow `geolocation=(self)`).
 */
export function locateMe(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}
