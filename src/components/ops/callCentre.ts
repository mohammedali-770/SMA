/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Branch, Product } from '../../types';
import type { BranchAvailabilityRow } from '../../lib/opsApi';
import type { DeliveryArea } from '../../lib/branchConfigApi';
import { formatRemaining } from './branchConsole';

/**
 * Pure logic for the call-centre board, kept out of the component so it can be
 * tested directly — the same split as `branchConsole.ts`.
 */

export interface BranchClosureSummary {
  branch: Branch;
  /** Products closed at this branch right now. */
  closedProducts: { product: Product; snoozedUntil: string | null }[];
  deliveryPaused: boolean;
  deliveryUntil: string | null;
  disabledAreas: DeliveryArea[];
  /**
   * How loud this branch should be on the board. Delivery being off is a bigger
   * operational fact than one sold-out item, so it counts for more than a single
   * closure without drowning out a branch that has lost half its menu.
   */
  severity: number;
}

export interface BuildSummariesInput {
  branches: Branch[];
  products: Product[];
  availability: (BranchAvailabilityRow & { branchId: string })[];
  areas: DeliveryArea[];
}

/**
 * One summary per branch that currently has something wrong, worst first.
 *
 * Branches with nothing closed are omitted entirely — the board answers "what
 * needs attention", and listing twelve healthy branches to find the one that
 * does not is the failure mode of a dashboard.
 */
export function buildClosureSummaries(input: BuildSummariesInput): BranchClosureSummary[] {
  const { branches, products, availability, areas } = input;
  const productById = new Map(products.map((p) => [p.id, p]));

  const closedByBranch = new Map<string, { product: Product; snoozedUntil: string | null }[]>();
  for (const row of availability) {
    if (row.isAvailable) continue;
    const product = productById.get(row.productId);
    if (!product) continue;                       // catalog row gone; nothing to name
    const list = closedByBranch.get(row.branchId) ?? [];
    list.push({ product, snoozedUntil: row.snoozedUntil });
    closedByBranch.set(row.branchId, list);
  }

  const disabledByBranch = new Map<string, DeliveryArea[]>();
  for (const area of areas) {
    if (!area.isDisabled) continue;
    const list = disabledByBranch.get(area.branchId) ?? [];
    list.push(area);
    disabledByBranch.set(area.branchId, list);
  }

  const summaries: BranchClosureSummary[] = [];
  for (const branch of branches) {
    const closedProducts = (closedByBranch.get(branch.id) ?? []).sort(bySoonestReturn);
    const disabledAreas = disabledByBranch.get(branch.id) ?? [];
    const deliveryPaused = branch.deliveryTemporarilyClosed ?? false;

    if (closedProducts.length === 0 && !deliveryPaused && disabledAreas.length === 0) continue;

    summaries.push({
      branch,
      closedProducts,
      deliveryPaused,
      deliveryUntil: null,
      disabledAreas,
      severity: closedProducts.length + disabledAreas.length + (deliveryPaused ? 5 : 0),
    });
  }

  return summaries.sort((a, b) => b.severity - a.severity
    || a.branch.nameEn.localeCompare(b.branch.nameEn));
}

/** Soonest to return first; an untimed closure has no return time and sorts last. */
function bySoonestReturn(
  a: { snoozedUntil: string | null },
  b: { snoozedUntil: string | null },
): number {
  if (!a.snoozedUntil && !b.snoozedUntil) return 0;
  if (!a.snoozedUntil) return 1;
  if (!b.snoozedUntil) return -1;
  return Date.parse(a.snoozedUntil) - Date.parse(b.snoozedUntil);
}

/**
 * Board tile emphasis. Three bands rather than a continuous scale: an operator
 * scanning a wall of tiles reads "which colour", not "which number".
 */
export function severityBand(summary: BranchClosureSummary): 'critical' | 'warning' | 'info' {
  if (summary.deliveryPaused) return 'critical';
  if (summary.severity >= 3) return 'warning';
  return 'info';
}

/** Countdown text for a closed row, or null when it has no timer. */
export function returnLabel(snoozedUntil: string | null, now: number): string | null {
  return formatRemaining(snoozedUntil, now);
}

/**
 * Branch ids that gained a closure between two board states.
 *
 * Drives the toast and the alert sound. Comparing ids rather than counts means
 * an operator reopening one item while another closes elsewhere still alerts —
 * a net-count comparison would cancel those out and stay silent.
 */
export function newlyClosedBranchIds(
  before: BranchClosureSummary[],
  after: BranchClosureSummary[],
): string[] {
  const beforeBy = new Map(before.map((s) => [s.branch.id, s.severity]));
  return after
    .filter((s) => !beforeBy.has(s.branch.id) || s.severity > (beforeBy.get(s.branch.id) ?? 0))
    .map((s) => s.branch.id);
}
