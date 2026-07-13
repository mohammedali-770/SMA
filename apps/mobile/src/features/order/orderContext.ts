/**
 * Order context — the single source of truth for the customer's ordering
 * decision (pickup vs delivery + the branch/address it resolves to). This module
 * is PURE and framework-free (no React Native / Expo / Supabase), so the validity
 * + branch-resolution rules are unit-tested under Node (orderContext.test.ts) and
 * reused verbatim by OrderContextProvider and the selection screen.
 *
 * The client decision is a UX gate only — place_order / begin_checkout_session
 * re-validate the branch (is_active) and the delivery zone (PostGIS) server-side,
 * so a stale or spoofed context can never actually create an out-of-zone order.
 */
import { deliveryEligibleBranches, distanceKm, pointInPolygon, type GeoPoint } from '../../lib/geo';
import type { Branch, DeliveryZone, OrderType } from '../../types/models';

export interface OrderContext {
  orderType: OrderType;                 // 'pickup' | 'delivery'
  branchId: string;                     // selected (pickup) or resolved (delivery) branch
  branchNameEn: string;
  branchNameAr: string;
  addressId: string | null;             // saved-address id when delivery uses one
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryDescription: string | null;   // free-text location description / landmark
  deliveryLandmark: string | null;      // reserved; folded into description today
  deliveryFee: number | null;            // delivery only (from branch policy)
  minOrder: number | null;               // delivery minimum (from branch policy)
  lastValidatedAt: number;               // epoch ms of the last successful validation
}

/** "Open" == the branch is active (mirrors CatalogProvider.branchIsOpen exactly). */
export function isBranchOpen(b: Branch | null | undefined): boolean {
  return Boolean(b?.isActive);
}

function branchPoint(b: Branch): GeoPoint {
  return { lat: b.latitude, lng: b.longitude };
}

/**
 * Pickup-eligible branches, nearest-first when the user's location is known.
 * Closed (inactive) branches are INCLUDED so the UI can show them disabled; only
 * pickup-enabled branches are listed. Never mutates the input array.
 */
export function pickupBranches(branches: Branch[], location: GeoPoint | null): Branch[] {
  const list = branches.filter((b) => b.pickupEnabled ?? true);
  if (!location) return list;
  return [...list].sort((a, b) => distanceKm(location, branchPoint(a)) - distanceKm(location, branchPoint(b)));
}

/**
 * The nearest OPEN branch whose active delivery zone covers `point`, or null when
 * no eligible branch exists. Delegates to the shared deliveryEligibleBranches so
 * the "open + delivery-enabled + not temporarily closed + inside an active zone"
 * rule matches the checkout pre-check and the server.
 */
export function resolveDeliveryBranch(point: GeoPoint, branches: Branch[], zones: DeliveryZone[]): Branch | null {
  const eligible = deliveryEligibleBranches(point, branches, zones);
  const top = eligible[0];
  return top ? (branches.find((b) => b.id === top.id) ?? null) : null;
}

/**
 * Is a stored context still valid against the CURRENT catalog? Pickup needs an
 * open, pickup-enabled branch; delivery additionally needs a location still
 * covered by that branch's active zone (and delivery on). Returns false for a
 * missing/closed/removed branch or an out-of-zone delivery point, so a change in
 * branch hours or zones can never leave a silently-invalid context in place.
 */
export function isOrderContextValid(
  ctx: OrderContext | null,
  branches: Branch[],
  zones: DeliveryZone[],
): boolean {
  if (!ctx) return false;
  const branch = branches.find((b) => b.id === ctx.branchId);
  if (!branch || !isBranchOpen(branch)) return false;

  if (ctx.orderType === 'pickup') {
    return branch.pickupEnabled ?? true;
  }

  // delivery
  if (ctx.deliveryLat == null || ctx.deliveryLng == null) return false;
  if (!(branch.deliveryEnabled ?? true) || (branch.deliveryTemporarilyClosed ?? false)) return false;
  const point: GeoPoint = { lat: ctx.deliveryLat, lng: ctx.deliveryLng };
  return zones
    .filter((z) => z.branchId === branch.id && z.isActive)
    .some((z) => pointInPolygon(point, z.geojson));
}

/** Build a fresh pickup context from a chosen branch. */
export function makePickupContext(branch: Branch, at: number): OrderContext {
  return {
    orderType: 'pickup',
    branchId: branch.id,
    branchNameEn: branch.nameEn,
    branchNameAr: branch.nameAr,
    addressId: null,
    deliveryLat: null,
    deliveryLng: null,
    deliveryDescription: null,
    deliveryLandmark: null,
    deliveryFee: null,
    minOrder: null, // pickup has no delivery minimum
    lastValidatedAt: at,
  };
}

/** Build a fresh delivery context from a resolved branch + chosen location. */
export function makeDeliveryContext(
  branch: Branch,
  loc: { addressId: string | null; lat: number; lng: number; description?: string | null },
  at: number,
): OrderContext {
  return {
    orderType: 'delivery',
    branchId: branch.id,
    branchNameEn: branch.nameEn,
    branchNameAr: branch.nameAr,
    addressId: loc.addressId,
    deliveryLat: loc.lat,
    deliveryLng: loc.lng,
    deliveryDescription: (loc.description ?? '').trim() || null,
    deliveryLandmark: null,
    deliveryFee: branch.deliveryFee ?? null,
    minOrder: branch.minDeliveryOrder ?? null,
    lastValidatedAt: at,
  };
}
