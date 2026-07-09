import { describe, it, expect } from 'vitest';
import {
  pointInPolygon, deliveryEligibleBranches,
  type GeoJSONGeometry, type BranchLike, type ZoneLike,
} from './geo';

// A square around Riyadh Olaya (lng 46.65–46.70, lat 24.69–24.73).
const square: GeoJSONGeometry = {
  type: 'Polygon',
  coordinates: [[[46.65, 24.69], [46.70, 24.69], [46.70, 24.73], [46.65, 24.73], [46.65, 24.69]]],
};

// Same square but with a hole in the middle (46.67–46.68, 24.705–24.715).
const squareWithHole: GeoJSONGeometry = {
  type: 'Polygon',
  coordinates: [
    [[46.65, 24.69], [46.70, 24.69], [46.70, 24.73], [46.65, 24.73], [46.65, 24.69]],
    [[46.67, 24.705], [46.68, 24.705], [46.68, 24.715], [46.67, 24.715], [46.67, 24.705]],
  ],
};

const multi: GeoJSONGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    [[[46.65, 24.69], [46.70, 24.69], [46.70, 24.73], [46.65, 24.73], [46.65, 24.69]]],
    [[[39.10, 21.45], [39.25, 21.45], [39.25, 21.55], [39.10, 21.55], [39.10, 21.45]]], // Jeddah patch
  ],
};

describe('pointInPolygon (UX pre-check)', () => {
  it('point inside the polygon → true', () => {
    expect(pointInPolygon({ lat: 24.7136, lng: 46.6753 }, square)).toBe(true);
  });
  it('point outside the polygon → false', () => {
    expect(pointInPolygon({ lat: 24.60, lng: 46.50 }, square)).toBe(false);
  });
  it('point inside a hole → false (not covered)', () => {
    expect(pointInPolygon({ lat: 24.71, lng: 46.675 }, squareWithHole)).toBe(false);
  });
  it('point inside outer ring but outside the hole → true', () => {
    expect(pointInPolygon({ lat: 24.695, lng: 46.66 }, squareWithHole)).toBe(true);
  });
  it('MultiPolygon: inside either sub-polygon → true', () => {
    expect(pointInPolygon({ lat: 24.7136, lng: 46.6753 }, multi)).toBe(true);
    expect(pointInPolygon({ lat: 21.50, lng: 39.18 }, multi)).toBe(true);
  });
  it('MultiPolygon: outside all sub-polygons → false', () => {
    expect(pointInPolygon({ lat: 25.5, lng: 45.0 }, multi)).toBe(false);
  });
  it('null geometry → false', () => {
    expect(pointInPolygon({ lat: 24.7, lng: 46.6 }, null)).toBe(false);
  });
});

describe('deliveryEligibleBranches', () => {
  const riyadh: BranchLike = { id: 'r', latitude: 24.7136, longitude: 46.6753, isActive: true, deliveryEnabled: true };
  const closed: BranchLike = { id: 'c', latitude: 24.71, longitude: 46.67, isActive: true, deliveryEnabled: true, deliveryTemporarilyClosed: true };
  const noDelivery: BranchLike = { id: 'n', latitude: 24.71, longitude: 46.67, isActive: true, deliveryEnabled: false };
  const inactive: BranchLike = { id: 'i', latitude: 24.71, longitude: 46.67, isActive: false, deliveryEnabled: true };

  const zones: ZoneLike[] = [
    { branchId: 'r', isActive: true, geojson: square },
    { branchId: 'c', isActive: true, geojson: square },
    { branchId: 'n', isActive: true, geojson: square },
    { branchId: 'i', isActive: true, geojson: square },
  ];
  const point = { lat: 24.7136, lng: 46.6753 };

  it('returns only branches that are active, delivery-enabled, not closed, and cover the point', () => {
    const eligible = deliveryEligibleBranches(point, [riyadh, closed, noDelivery, inactive], zones);
    expect(eligible.map(b => b.id)).toEqual(['r']);
  });

  it('excludes a branch whose zone does not contain the point', () => {
    const far: BranchLike = { id: 'f', latitude: 21.5, longitude: 39.18, isActive: true, deliveryEnabled: true };
    const farZone: ZoneLike = { branchId: 'f', isActive: true, geojson: multi };
    const eligible = deliveryEligibleBranches({ lat: 25.5, lng: 45.0 }, [far], [farZone]);
    expect(eligible).toEqual([]);
  });

  it('excludes a branch whose only zone is inactive', () => {
    const eligible = deliveryEligibleBranches(point, [riyadh], [{ branchId: 'r', isActive: false, geojson: square }]);
    expect(eligible).toEqual([]);
  });

  it('sorts eligible branches nearest-first', () => {
    const near: BranchLike = { id: 'near', latitude: 24.7136, longitude: 46.6753, isActive: true, deliveryEnabled: true };
    const farther: BranchLike = { id: 'far', latitude: 24.73, longitude: 46.70, isActive: true, deliveryEnabled: true };
    const z: ZoneLike[] = [
      { branchId: 'near', isActive: true, geojson: square },
      { branchId: 'far', isActive: true, geojson: square },
    ];
    const eligible = deliveryEligibleBranches(point, [farther, near], z);
    expect(eligible.map(b => b.id)).toEqual(['near', 'far']);
  });
});
