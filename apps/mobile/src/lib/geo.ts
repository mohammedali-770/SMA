/**
 * Pure geometry helpers for delivery-zone UX (mobile). Mirrors the web app's
 * src/lib/geo.ts so both clients pre-check identically.
 *
 * IMPORTANT: CLIENT-SIDE PRE-CHECK for user experience only. The server
 * (place_order + PostGIS `point_in_active_delivery_zone`) is the sole authority
 * on serviceability — never gate order submission on this helper alone.
 * Coordinates are GeoJSON order: [longitude, latitude].
 */
export interface GeoJSONPolygon { type: 'Polygon'; coordinates: number[][][]; }
export interface GeoJSONMultiPolygon { type: 'MultiPolygon'; coordinates: number[][][][]; }
export type GeoJSONGeometry = GeoJSONPolygon | GeoJSONMultiPolygon;

export interface GeoPoint { lat: number; lng: number; }

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = (yi > lat) !== (yj > lat)
      && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInSinglePolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (!rings || rings.length === 0) return false;
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(lng, lat, rings[k])) return false; // in a hole → not covered
  }
  return true;
}

/** True if the point falls within a GeoJSON Polygon/MultiPolygon (UX pre-check only). */
export function pointInPolygon(point: GeoPoint, geojson: GeoJSONGeometry | null | undefined): boolean {
  if (!geojson || !point) return false;
  const { lng, lat } = point;
  if (geojson.type === 'Polygon') {
    return pointInSinglePolygon(lng, lat, geojson.coordinates);
  }
  if (geojson.type === 'MultiPolygon') {
    return geojson.coordinates.some(poly => pointInSinglePolygon(lng, lat, poly));
  }
  return false;
}

/** Great-circle distance in km (Haversine); local so this module is self-contained. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export interface BranchLike {
  id: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  deliveryEnabled?: boolean;
  deliveryTemporarilyClosed?: boolean;
}
export interface ZoneLike {
  branchId: string;
  isActive: boolean;
  geojson: GeoJSONGeometry;
}

/**
 * Branches that could serve a delivery to `point` right now — active, delivery
 * enabled, not temporarily closed, and with an active zone containing the point.
 * Sorted nearest-first. UX pre-check only (server re-checks).
 */
export function deliveryEligibleBranches(
  point: GeoPoint,
  branches: BranchLike[],
  zones: ZoneLike[],
): BranchLike[] {
  const zonesByBranch = new Map<string, GeoJSONGeometry[]>();
  for (const z of zones) {
    if (!z.isActive) continue;
    const arr = zonesByBranch.get(z.branchId) ?? [];
    arr.push(z.geojson);
    zonesByBranch.set(z.branchId, arr);
  }
  return branches
    .filter(b =>
      b.isActive
      && (b.deliveryEnabled ?? true)
      && !(b.deliveryTemporarilyClosed ?? false)
      && (zonesByBranch.get(b.id) ?? []).some(g => pointInPolygon(point, g)))
    .sort((a, b) =>
      distanceKm(point, { lat: a.latitude, lng: a.longitude })
      - distanceKm(point, { lat: b.latitude, lng: b.longitude }));
}
