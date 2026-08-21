/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Category, Modifier, ModifierGroup, Product } from '../../types';
import type {
  BranchAvailabilityRow, BranchModifierAvailabilityRow, DeliveryReasonCode, OpsReasonCode,
} from '../../lib/opsApi';
import type { OpsStringKey } from './opsStrings';

/**
 * Pure logic for the branch console, kept out of the component so it can be
 * tested directly — the same split as `src/components/admin/branchDeletion.ts`.
 */

/**
 * The durations a cashier may choose. There is deliberately NO "until I reopen
 * it" option: everything closed at the counter reopens by itself (owner
 * decision 2026-08-20). An item genuinely withdrawn is an admin action through
 * Branch Management, which is a different control with a different audience.
 *
 * The server independently rejects anything outside 1..1440 minutes, so this
 * list is a convenience, not the boundary.
 */
export const DURATION_OPTIONS: { minutes: number; key: OpsStringKey }[] = [
  { minutes: 30,  key: 'dur30m' },
  { minutes: 60,  key: 'dur1h' },
  { minutes: 180, key: 'dur3h' },
  { minutes: 360, key: 'dur6h' },
  { minutes: 720, key: 'dur12h' },
];

/** Must stay in step with the reason_code CHECK constraint on the table. */
export const REASON_OPTIONS: { code: OpsReasonCode; key: OpsStringKey }[] = [
  { code: 'out_of_stock',   key: 'reason_out_of_stock' },
  { code: 'supplier_delay', key: 'reason_supplier_delay' },
  { code: 'equipment_down', key: 'reason_equipment_down' },
  { code: 'quality_hold',   key: 'reason_quality_hold' },
  { code: 'other',          key: 'reason_other' },
];

export interface ClosedItem {
  product: Product;
  snoozedUntil: string | null;
  reasonCode: OpsReasonCode | null;
}

export interface CategoryGroup {
  categoryId: string | null;
  products: Product[];
}

/**
 * Remaining time as `H:MM:SS` (or `M:SS` under an hour), or null once it has
 * run out. Returning null rather than a zero string lets the caller say
 * "reopening now" instead of showing a stopped clock, which reads as broken.
 */
export function formatRemaining(snoozedUntil: string | null, now: number): string | null {
  if (!snoozedUntil) return null;
  const end = Date.parse(snoozedUntil);
  if (Number.isNaN(end)) return null;
  const ms = end - now;
  if (ms <= 0) return null;

  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/**
 * Products currently closed at this branch, newest-expiring first so the ones
 * about to come back sit at the top where a cashier is looking.
 *
 * An untimed closure (`snoozedUntil` null) sorts last: it is an admin
 * delisting, not something the counter is waiting on.
 */
export function closedItems(
  products: Product[],
  rows: BranchAvailabilityRow[],
): ClosedItem[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows
    .filter((r) => !r.isAvailable && byId.has(r.productId))
    .map((r) => ({
      product: byId.get(r.productId) as Product,
      snoozedUntil: r.snoozedUntil,
      reasonCode: r.reasonCode,
    }))
    .sort((a, b) => {
      if (!a.snoozedUntil && !b.snoozedUntil) return 0;
      if (!a.snoozedUntil) return 1;
      if (!b.snoozedUntil) return -1;
      return Date.parse(a.snoozedUntil) - Date.parse(b.snoozedUntil);
    });
}

/** Ids of products closed at this branch, for marking rows in the full list. */
export function closedProductIds(rows: BranchAvailabilityRow[]): Set<string> {
  return new Set(rows.filter((r) => !r.isAvailable).map((r) => r.productId));
}

/**
 * Active products matching the search, grouped by category in menu order.
 *
 * Inactive products are excluded: a delisted item is not something the counter
 * can close or reopen, and showing it invites a cashier to try. The current
 * admin control instead renders every product in one unfiltered scrolling list,
 * which is unusable at real catalog size.
 */
export function searchableGroups(
  products: Product[],
  categories: Category[],
  query: string,
): CategoryGroup[] {
  const q = query.trim().toLowerCase();
  const matches = products.filter((p) => {
    if (!p.isActive) return false;
    if (!q) return true;
    return `${p.nameAr}\n${p.nameEn}`.toLowerCase().includes(q);
  });

  const order = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const groups: CategoryGroup[] = [];
  for (const c of order) {
    const inCategory = matches.filter((p) => p.categoryId === c.id);
    if (inCategory.length > 0) groups.push({ categoryId: c.id, products: inCategory });
  }

  // Products whose category was deleted or is missing still need a home, or a
  // cashier simply cannot reach them.
  const known = new Set(order.map((c) => c.id));
  const orphans = matches.filter((p) => !known.has(p.categoryId));
  if (orphans.length > 0) groups.push({ categoryId: null, products: orphans });

  return groups;
}

/** Ids of options closed at this branch. */
export function closedModifierIds(rows: BranchModifierAvailabilityRow[]): Set<string> {
  return new Set(rows.filter((r) => !r.isAvailable).map((r) => r.modifierId));
}

export interface ClosedOption {
  modifier: Modifier;
  group: ModifierGroup;
  snoozedUntil: string | null;
}

/**
 * Options currently closed at this branch, soonest-returning first — the same
 * ordering rule as `closedItems`, so the two lists read alike.
 */
export function closedOptions(
  groups: ModifierGroup[],
  rows: BranchModifierAvailabilityRow[],
): ClosedOption[] {
  const closed = closedModifierIds(rows);
  const until = new Map(rows.map((r) => [r.modifierId, r.snoozedUntil]));
  const out: ClosedOption[] = [];
  for (const group of groups) {
    for (const modifier of group.modifiers) {
      if (closed.has(modifier.id)) {
        out.push({ modifier, group, snoozedUntil: until.get(modifier.id) ?? null });
      }
    }
  }
  return out.sort((a, b) => {
    if (!a.snoozedUntil && !b.snoozedUntil) return 0;
    if (!a.snoozedUntil) return 1;
    if (!b.snoozedUntil) return -1;
    return Date.parse(a.snoozedUntil) - Date.parse(b.snoozedUntil);
  });
}

/** The option groups attached to a product, in the product's own order. */
export function groupsForProduct(
  product: Product,
  groups: ModifierGroup[],
): ModifierGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  return product.modifierGroupIds
    .map((id) => byId.get(id))
    .filter((g): g is ModifierGroup => Boolean(g));
}

/**
 * How many options a customer MUST pick from this group — the same resolution
 * of `isRequired` against `minSelection` the customer app makes, because the
 * cashier needs to be told when a close has silently taken the whole item off
 * the menu.
 */
export function requiredCount(group: ModifierGroup): number {
  return group.isRequired ? Math.max(1, group.minSelection) : group.minSelection;
}

/**
 * True when closing options has left a REQUIRED group unsatisfiable, so the
 * product can no longer be ordered at all even though its own row says it is
 * on sale. The customer app renders it as out of stock and `place_order`
 * refuses it, so the console must say so too rather than showing a product as
 * open that nobody can buy.
 */
export function productBlockedByOptions(
  product: Product,
  groups: ModifierGroup[],
  closed: Set<string>,
): boolean {
  return groupsForProduct(product, groups).some(
    (g) => g.modifiers.filter((m) => !closed.has(m.id)).length < requiredCount(g),
  );
}

/**
 * Delivery pauses use the same duration ladder as item closures — same hardware,
 * same hands, same expectations — but their own reasons: what stops delivery is
 * rarely what empties a fryer.
 */
export const DELIVERY_DURATION_OPTIONS = DURATION_OPTIONS;

/** Must stay in step with the reason vocabulary in set_branch_delivery_pause. */
export const DELIVERY_REASON_OPTIONS: { code: DeliveryReasonCode; key: OpsStringKey }[] = [
  { code: 'no_driver',        key: 'dreason_no_driver' },
  { code: 'weather',          key: 'dreason_weather' },
  { code: 'kitchen_overload', key: 'dreason_kitchen_overload' },
  { code: 'area_incident',    key: 'dreason_area_incident' },
  { code: 'other',            key: 'dreason_other' },
];
