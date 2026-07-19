import { describe, expect, it } from 'vitest';

import { closeRing, geometryToPolygons, openRing, polygonsToGeometry, type LngLat } from './googleMaps';

const openSquare: LngLat[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const closedSquare: LngLat[] = [...openSquare, [0, 0]];

describe('closeRing / openRing — GeoJSON rings are closed, editor paths are open', () => {
  it('closes an open ring and leaves a closed ring alone', () => {
    expect(closeRing(openSquare)).toEqual(closedSquare);
    expect(closeRing(closedSquare)).toEqual(closedSquare);
    expect(closeRing([])).toEqual([]);
  });
  it('opens a closed ring and leaves an open ring alone', () => {
    expect(openRing(closedSquare)).toEqual(openSquare);
    expect(openRing(openSquare)).toEqual(openSquare);
  });
  it('round-trips exactly (drawn shape saves and reloads unchanged)', () => {
    expect(openRing(closeRing(openSquare))).toEqual(openSquare);
    expect(closeRing(openRing(closedSquare))).toEqual(closedSquare);
  });
});

describe('polygonsToGeometry — what Save sends to the delivery-zone RPC', () => {
  it('one polygon → Polygon with closed rings', () => {
    const geom = polygonsToGeometry([[openSquare]]);
    expect(geom).toEqual({ type: 'Polygon', coordinates: [closedSquare] });
  });
  it('several polygons → MultiPolygon', () => {
    const other: LngLat[] = [[5, 5], [6, 5], [6, 6]];
    const geom = polygonsToGeometry([[openSquare], [other]]);
    expect(geom?.type).toBe('MultiPolygon');
    expect((geom as { coordinates: number[][][][] }).coordinates).toHaveLength(2);
    expect((geom as { coordinates: number[][][][] }).coordinates[1][0]).toEqual(closeRing(other));
  });
  it('nothing drawn (or degenerate <3-point rings) → null, never an invalid geometry', () => {
    expect(polygonsToGeometry([])).toBeNull();
    expect(polygonsToGeometry([[[[0, 0], [1, 1]]]])).toBeNull();
  });
  it('keeps holes (inner rings) with the outer ring', () => {
    const hole: LngLat[] = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];
    const geom = polygonsToGeometry([[openSquare, hole]]);
    expect(geom).toEqual({ type: 'Polygon', coordinates: [closedSquare, closeRing(hole)] });
  });
});

describe('geometryToPolygons — loading a saved zone back into the editor', () => {
  it('Polygon → one polygon of open rings', () => {
    expect(geometryToPolygons({ type: 'Polygon', coordinates: [closedSquare] }))
      .toEqual([[openSquare]]);
  });
  it('MultiPolygon → per-polygon open rings', () => {
    const other = closeRing([[5, 5], [6, 5], [6, 6]]);
    const polys = geometryToPolygons({ type: 'MultiPolygon', coordinates: [[closedSquare], [other]] });
    expect(polys).toHaveLength(2);
    expect(polys[1][0]).toEqual(openRing(other));
  });
  it('unknown geometry types load as nothing (no crash)', () => {
    expect(geometryToPolygons({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });
  it('full round-trip: stored geometry → editor → saved geometry is identical', () => {
    const stored = { type: 'MultiPolygon' as const, coordinates: [[closedSquare.map(p => [...p])], [[...closeRing([[5, 5], [6, 5], [6, 6]]).map(p => [...p])]]] };
    const roundTripped = polygonsToGeometry(geometryToPolygons(stored));
    expect(roundTripped).toEqual(stored);
  });
});
