import { describe, expect, it } from 'vitest';

import {
  isBranchOpen,
  isOrderContextValid,
  makeDeliveryContext,
  makePickupContext,
  pickupBranches,
  resolveDeliveryBranch,
  shouldForceSelection,
  type OrderContext,
} from './orderContext';
import type { Branch, DeliveryZone } from '../../types/models';

// A square zone around (lng 46.6, lat 24.7). GeoJSON is [lng, lat].
const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [[[46.5, 24.6], [46.7, 24.6], [46.7, 24.8], [46.5, 24.8], [46.5, 24.6]]],
};
const INSIDE = { lat: 24.7, lng: 46.6 };
const OUTSIDE = { lat: 25.9, lng: 50.0 };

function branch(over: Partial<Branch> = {}): Branch {
  return {
    id: 'b1', nameEn: 'Branch 1', nameAr: 'فرع 1', addressEn: '', addressAr: '', phone: '',
    latitude: 24.7, longitude: 46.6, isActive: true, deliveryFee: 10, minDeliveryOrder: 30,
    deliveryEnabled: true, pickupEnabled: true, deliveryTemporarilyClosed: false, estimatedDeliveryMinutes: 30,
    ...over,
  };
}
function zone(branchId: string, over: Partial<DeliveryZone> = {}): DeliveryZone {
  return { id: `z-${branchId}`, branchId, isActive: true, geojson: SQUARE, ...over };
}

describe('isBranchOpen', () => {
  it('is true only for an active branch', () => {
    expect(isBranchOpen(branch({ isActive: true }))).toBe(true);
    expect(isBranchOpen(branch({ isActive: false }))).toBe(false);
    expect(isBranchOpen(null)).toBe(false);
  });
});

describe('pickupBranches', () => {
  const near = branch({ id: 'near', latitude: 24.70, longitude: 46.60 });
  const far = branch({ id: 'far', latitude: 26.40, longitude: 50.10 });
  it('sorts nearest-first when a location is known', () => {
    const out = pickupBranches([far, near], { lat: 24.71, lng: 46.61 });
    expect(out.map((b) => b.id)).toEqual(['near', 'far']);
  });
  it('keeps input order (no sort) when location is unknown, and never mutates input', () => {
    const input = [far, near];
    const out = pickupBranches(input, null);
    expect(out.map((b) => b.id)).toEqual(['far', 'near']);
    expect(input.map((b) => b.id)).toEqual(['far', 'near']);
  });
  it('includes CLOSED branches (UI disables them) but excludes pickup-disabled ones', () => {
    const closed = branch({ id: 'closed', isActive: false });
    const noPickup = branch({ id: 'nopick', pickupEnabled: false });
    const ids = pickupBranches([near, closed, noPickup], null).map((b) => b.id);
    expect(ids).toContain('closed');
    expect(ids).not.toContain('nopick');
  });
});

describe('resolveDeliveryBranch', () => {
  it('returns the nearest OPEN covering branch', () => {
    const b1 = branch({ id: 'b1', latitude: 24.70, longitude: 46.60 });
    const b2 = branch({ id: 'b2', latitude: 24.75, longitude: 46.65 });
    const got = resolveDeliveryBranch(INSIDE, [b2, b1], [zone('b1'), zone('b2')]);
    expect(got?.id).toBe('b1'); // b1 is nearest to INSIDE
  });
  it('returns null when the point is outside every zone', () => {
    expect(resolveDeliveryBranch(OUTSIDE, [branch()], [zone('b1')])).toBeNull();
  });
  it('ignores closed / delivery-off / temporarily-closed branches', () => {
    expect(resolveDeliveryBranch(INSIDE, [branch({ isActive: false })], [zone('b1')])).toBeNull();
    expect(resolveDeliveryBranch(INSIDE, [branch({ deliveryEnabled: false })], [zone('b1')])).toBeNull();
    expect(resolveDeliveryBranch(INSIDE, [branch({ deliveryTemporarilyClosed: true })], [zone('b1')])).toBeNull();
  });
  it('ignores inactive zones', () => {
    expect(resolveDeliveryBranch(INSIDE, [branch()], [zone('b1', { isActive: false })])).toBeNull();
  });
});

describe('isOrderContextValid', () => {
  const pickupCtx = (over: Partial<OrderContext> = {}): OrderContext => ({ ...makePickupContext(branch(), 1), ...over });
  const deliveryCtx = (over: Partial<OrderContext> = {}): OrderContext =>
    ({ ...makeDeliveryContext(branch(), { addressId: 'a1', lat: INSIDE.lat, lng: INSIDE.lng, description: 'x' }, 1), ...over });

  it('null context is invalid', () => {
    expect(isOrderContextValid(null, [branch()], [zone('b1')])).toBe(false);
  });
  it('pickup is valid only with an open, pickup-enabled branch', () => {
    expect(isOrderContextValid(pickupCtx(), [branch()], [])).toBe(true);
    expect(isOrderContextValid(pickupCtx(), [branch({ isActive: false })], [])).toBe(false);
    expect(isOrderContextValid(pickupCtx(), [branch({ pickupEnabled: false })], [])).toBe(false);
    expect(isOrderContextValid(pickupCtx(), [], [])).toBe(false); // branch removed
  });
  it('delivery is valid only with a covered point + open, delivery-on branch', () => {
    expect(isOrderContextValid(deliveryCtx(), [branch()], [zone('b1')])).toBe(true);
    expect(isOrderContextValid(deliveryCtx({ deliveryLat: OUTSIDE.lat, deliveryLng: OUTSIDE.lng }), [branch()], [zone('b1')])).toBe(false);
    expect(isOrderContextValid(deliveryCtx(), [branch()], [])).toBe(false); // no zone → not covered
    expect(isOrderContextValid(deliveryCtx(), [branch({ deliveryEnabled: false })], [zone('b1')])).toBe(false);
    expect(isOrderContextValid(deliveryCtx({ deliveryLat: null, deliveryLng: null }), [branch()], [zone('b1')])).toBe(false);
  });
});

describe('context builders', () => {
  it('makePickupContext has no delivery fields', () => {
    const c = makePickupContext(branch({ id: 'bx', nameEn: 'BX' }), 123);
    expect(c).toMatchObject({ orderType: 'pickup', branchId: 'bx', branchNameEn: 'BX', addressId: null, deliveryLat: null, deliveryFee: null, minOrder: null, lastValidatedAt: 123 });
  });
  it('makeDeliveryContext carries the branch policy + location', () => {
    const c = makeDeliveryContext(branch({ id: 'bd', deliveryFee: 12, minDeliveryOrder: 40 }), { addressId: 'a9', lat: 24.7, lng: 46.6, description: '  near mosque ' }, 99);
    expect(c).toMatchObject({ orderType: 'delivery', branchId: 'bd', addressId: 'a9', deliveryLat: 24.7, deliveryLng: 46.6, deliveryDescription: 'near mosque', deliveryFee: 12, minOrder: 40, lastValidatedAt: 99 });
  });
});

describe('shouldForceSelection (launch/menu gate)', () => {
  const s = (over: Partial<{ ready: boolean; loading: boolean; error: string | null; valid: boolean }> = {}) =>
    ({ ready: true, loading: false, error: null, valid: false, ...over });

  it('fresh launch with NO context forces the /select screen', () => {
    expect(shouldForceSelection(s({ valid: false }))).toBe(true);
  });
  it('a persisted VALID context goes straight to the menu (no gate)', () => {
    expect(shouldForceSelection(s({ valid: true }))).toBe(false);
  });
  it('a persisted context that became INVALID forces re-selection', () => {
    // validity is computed against the live catalog by isOrderContextValid;
    // once it flips false the gate must fire again.
    expect(shouldForceSelection(s({ valid: false }))).toBe(true);
  });
  it('never gates before hydration, during catalog load, or on a load error', () => {
    expect(shouldForceSelection(s({ ready: false }))).toBe(false);
    expect(shouldForceSelection(s({ loading: true }))).toBe(false);
    expect(shouldForceSelection(s({ error: 'network down' }))).toBe(false);
  });
});
