/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Branch, Modifier, ModifierGroup, Product } from '../../types';
import type { BranchAvailabilityRow, BranchModifierAvailabilityRow } from '../../lib/opsApi';
import type { DeliveryArea } from '../../lib/branchConfigApi';
import { formatRemaining, groupsForProduct, requiredCount } from './branchConsole';

/**
 * Pure logic for the call-centre board, kept out of the component so it can be
 * tested directly — the same split as `branchConsole.ts`.
 *
 * Two closure causes are modelled separately on purpose, because the answer an
 * operator gives the customer differs and so does the remedy:
 *
 *  - a **closed** product is a branch decision recorded in
 *    `branch_product_availability`; the fix is asking them to reopen the item;
 *  - a **blocked** product is still marked available, but every option in one of
 *    its required groups is closed, so no valid selection exists — the customer
 *    app renders it out of stock and `place_order` refuses it. The fix is
 *    reopening one option, and the branch will deny closing the item if told
 *    otherwise, because they did not.
 *
 * Folding the two into one list would let an operator report the second as the
 * first, confidently and wrongly.
 */

export interface ClosedOption {
  modifier: Modifier;
  group: ModifierGroup;
  snoozedUntil: string | null;
}

/**
 * One closed group, with everything it takes off the menu.
 *
 * This exists because of fan-out: a single closed sauce can block every burger
 * on the menu, and a list of forty product rows describes one incident forty
 * times. The operator needs the cause once — "Sauce, required, 3 of 3 closed,
 * 6 items affected" — which is also the sentence they say down the phone.
 */
export interface BlockingIncident {
  group: ModifierGroup;
  /** The closed options inside this group, soonest-returning first. */
  closed: ClosedOption[];
  /** How many the customer must pick. */
  required: number;
  /** How many are still available. Blocking when `remaining < required`. */
  remaining: number;
  affected: Product[];
  /**
   * When enough options are back for this group to be satisfiable again — a
   * DERIVED PREDICTION, never a time a human set. Null when any option that must
   * return has no timer. It is deliberately not called `snoozedUntil`: nothing
   * in the database says this, and the UI must not render it in the same words
   * as a branch's own timer.
   */
  earliestReturn: string | null;
}

export interface BlockedProduct {
  product: Product;
  /** The required groups that have run out at this branch. */
  groups: ModifierGroup[];
  /** Latest of its blocking groups' `earliestReturn`; null if any is null. */
  earliestReturn: string | null;
}

export interface BranchClosureSummary {
  branch: Branch;
  /** Products closed at this branch right now. */
  closedProducts: { product: Product; snoozedUntil: string | null }[];
  /**
   * Products still marked available that no customer can order, because a
   * required option group has run out at this branch.
   */
  blockedProducts: BlockedProduct[];
  /** The groups causing those blocks, one row per cause rather than per effect. */
  blockingIncidents: BlockingIncident[];
  /** Every closed option at this branch, whether or not it blocks anything. */
  closedOptions: ClosedOption[];
  deliveryPaused: boolean;
  deliveryUntil: string | null;
  disabledAreas: DeliveryArea[];
  /**
   * How loud this branch should be on the board. Delivery being off is a bigger
   * operational fact than one sold-out item, so it counts for more than a single
   * closure without drowning out a branch that has lost half its menu.
   *
   * A blocked product counts exactly as much as a closed one: to the customer
   * they are the same disappointment.
   */
  severity: number;
}

/**
 * A branch whose ONLY issue is options that still leave every product orderable
 * — one sauce out of three. Not board-worthy: the board answers "what needs
 * attention" and nothing here does. But it is a real question on the phone
 * ("can I get garlic sauce at Jeddah?"), so it is exposed separately rather
 * than dropped.
 */
export interface OptionOnlyBranch {
  branch: Branch;
  closedOptions: ClosedOption[];
}

export interface BuildSummariesInput {
  branches: Branch[];
  products: Product[];
  availability: (BranchAvailabilityRow & { branchId: string })[];
  modifierGroups: ModifierGroup[];
  modifierAvailability: (BranchModifierAvailabilityRow & { branchId: string })[];
  areas: DeliveryArea[];
}

/** The same ordering rule for a derived return time. */
function bySoonestPrediction(
  a: { earliestReturn: string | null },
  b: { earliestReturn: string | null },
): number {
  if (!a.earliestReturn && !b.earliestReturn) return 0;
  if (!a.earliestReturn) return 1;
  if (!b.earliestReturn) return -1;
  return Date.parse(a.earliestReturn) - Date.parse(b.earliestReturn);
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
 * When a group whose options have run out becomes satisfiable again.
 *
 * `needed` more options must come back, so the answer is the `needed`-th
 * soonest-returning closed option — not the first, which is the tempting bug: a
 * group demanding two picks is still unsatisfiable when only one has returned.
 * Null when fewer than `needed` of them carry a timer at all.
 */
function groupEarliestReturn(closed: ClosedOption[], needed: number): string | null {
  if (needed <= 0) return null;
  const timed = closed
    .map((c) => c.snoozedUntil)
    .filter((t): t is string => Boolean(t))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return timed.length >= needed ? timed[needed - 1] : null;
}

/** The later of two predicted returns; null if either is unknown. */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * One summary per branch that currently has something wrong, worst first.
 *
 * Branches with nothing wrong are omitted entirely — the board answers "what
 * needs attention", and listing twelve healthy branches to find the one that
 * does not is the failure mode of a dashboard.
 */
export function buildClosureSummaries(input: BuildSummariesInput): BranchClosureSummary[] {
  const { branches, products, availability, modifierGroups, modifierAvailability, areas } = input;
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

  // Closed options, indexed by branch and by modifier id within a branch.
  const groupByModifier = new Map<string, ModifierGroup>();
  for (const group of modifierGroups) {
    for (const modifier of group.modifiers) groupByModifier.set(modifier.id, group);
  }
  const closedOptionsByBranch = new Map<string, ClosedOption[]>();
  const closedOptionIdsByBranch = new Map<string, Set<string>>();
  for (const row of modifierAvailability) {
    if (row.isAvailable) continue;
    const group = groupByModifier.get(row.modifierId);
    if (!group) continue;                         // catalog row gone; nothing to name
    const modifier = group.modifiers.find((m) => m.id === row.modifierId);
    if (!modifier) continue;
    const list = closedOptionsByBranch.get(row.branchId) ?? [];
    list.push({ modifier, group, snoozedUntil: row.snoozedUntil });
    closedOptionsByBranch.set(row.branchId, list);
    const ids = closedOptionIdsByBranch.get(row.branchId) ?? new Set<string>();
    ids.add(row.modifierId);
    closedOptionIdsByBranch.set(row.branchId, ids);
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
    const closedOptions = (closedOptionsByBranch.get(branch.id) ?? []).sort(bySoonestReturn);
    const closedOptionIds = closedOptionIdsByBranch.get(branch.id) ?? new Set<string>();
    const disabledAreas = disabledByBranch.get(branch.id) ?? [];
    const deliveryPaused = branch.deliveryTemporarilyClosed ?? false;

    const { blockedProducts, blockingIncidents } = blockedAtBranch({
      products, modifierGroups, closedOptions, closedOptionIds,
      alreadyClosed: new Set(closedProducts.map((c) => c.product.id)),
    });

    if (closedProducts.length === 0 && blockedProducts.length === 0
        && !deliveryPaused && disabledAreas.length === 0) continue;

    summaries.push({
      branch,
      closedProducts,
      blockedProducts,
      blockingIncidents,
      closedOptions,
      deliveryPaused,
      deliveryUntil: null,
      disabledAreas,
      severity: closedProducts.length + blockedProducts.length + disabledAreas.length
        + (deliveryPaused ? 5 : 0),
    });
  }

  return summaries.sort(compareSummaries);
}

/**
 * Which products this branch has taken off the menu by closing options, and the
 * groups that did it.
 *
 * The unorderability rule is `productBlockedByOptions`' rule exactly — available
 * options fewer than the group demands — so the console, the branch console and
 * the customer app cannot drift apart about what a customer sees.
 *
 * On top of that rule, a group only appears here when the BRANCH closed at least
 * one of its options. A required group nobody can satisfy anywhere (an empty
 * group, or `minSelection` above the number of options that exist) is a catalog
 * defect: it would pin every branch to the board permanently, with nothing a
 * call-centre operator could do about it, and the board would stop answering its
 * one question. That belongs in catalog validation, not here.
 */
function blockedAtBranch(opts: {
  products: Product[];
  modifierGroups: ModifierGroup[];
  closedOptions: ClosedOption[];
  closedOptionIds: Set<string>;
  alreadyClosed: Set<string>;
}): { blockedProducts: BlockedProduct[]; blockingIncidents: BlockingIncident[] } {
  const { products, modifierGroups, closedOptions, closedOptionIds, alreadyClosed } = opts;
  if (closedOptionIds.size === 0) return { blockedProducts: [], blockingIncidents: [] };

  // One pass over the groups that actually lost an option, rather than over the
  // whole catalog: the work stays proportional to what is closed.
  const incidentByGroup = new Map<string, BlockingIncident>();
  for (const group of modifierGroups) {
    const closed = closedOptions.filter((c) => c.group.id === group.id).sort(bySoonestReturn);
    if (closed.length === 0) continue;
    const required = requiredCount(group);
    const remaining = group.modifiers.filter((m) => !closedOptionIds.has(m.id)).length;
    if (remaining >= required) continue;          // still satisfiable; not an incident
    incidentByGroup.set(group.id, {
      group, closed, required, remaining, affected: [],
      earliestReturn: groupEarliestReturn(closed, required - remaining),
    });
  }
  if (incidentByGroup.size === 0) return { blockedProducts: [], blockingIncidents: [] };

  const blockedProducts: BlockedProduct[] = [];
  for (const product of products) {
    if (!product.isActive) continue;              // delisted; not something to explain
    // A product the branch closed outright is reported once, as closed. Listing
    // it twice would inflate the count and read as two separate problems.
    if (alreadyClosed.has(product.id)) continue;
    const hits = groupsForProduct(product, modifierGroups)
      .map((g) => incidentByGroup.get(g.id))
      .filter((i): i is BlockingIncident => Boolean(i));
    if (hits.length === 0) continue;
    for (const hit of hits) hit.affected.push(product);
    blockedProducts.push({
      product,
      groups: hits.map((h) => h.group),
      earliestReturn: hits.reduce<string | null>(
        (acc, h, i) => (i === 0 ? h.earliestReturn : laterOf(acc, h.earliestReturn)), null),
    });
  }

  // A group that blocks nothing anyone sells is not an incident worth showing.
  const blockingIncidents = [...incidentByGroup.values()].filter((i) => i.affected.length > 0);
  // Sorted like every other list here. Left in catalog order, `blockedProducts[0]`
  // is an arbitrary row, and the tile reads its time out as the branch's earliest
  // return — a number an operator repeats to a caller as a promise.
  blockedProducts.sort(bySoonestPrediction);
  blockingIncidents.sort(bySoonestPrediction);
  return { blockedProducts, blockingIncidents };
}

/**
 * Branches whose only issue is options that block nothing.
 *
 * Deliberately NOT folded into `buildClosureSummaries`: that function's contract
 * is "branches needing attention", every caller reads `summaries.length` as that
 * count, and quietly adding zero-severity rows would corrupt the all-clear state
 * and the header count at once.
 */
export function optionOnlyBranches(input: BuildSummariesInput): OptionOnlyBranch[] {
  const onBoard = new Set(buildClosureSummaries(input).map((s) => s.branch.id));
  const groupByModifier = new Map<string, ModifierGroup>();
  for (const group of input.modifierGroups) {
    for (const modifier of group.modifiers) groupByModifier.set(modifier.id, group);
  }

  const byBranch = new Map<string, ClosedOption[]>();
  for (const row of input.modifierAvailability) {
    if (row.isAvailable || onBoard.has(row.branchId)) continue;
    const group = groupByModifier.get(row.modifierId);
    const modifier = group?.modifiers.find((m) => m.id === row.modifierId);
    if (!group || !modifier) continue;
    const list = byBranch.get(row.branchId) ?? [];
    list.push({ modifier, group, snoozedUntil: row.snoozedUntil });
    byBranch.set(row.branchId, list);
  }

  return input.branches
    .filter((b) => byBranch.has(b.id))
    .map((branch) => ({
      branch,
      closedOptions: (byBranch.get(branch.id) ?? []).sort(bySoonestReturn),
    }));
}

/**
 * Closed options that are NOT already named as the cause of a block.
 *
 * The incident rows list every option in the group that ran out, so repeating
 * them in a general "options closed" line says the same fact twice and makes an
 * operator wonder whether it is a second problem. What is left is the genuinely
 * separate case: an option that is off while every item stays orderable.
 */
export function nonBlockingOptions(summary: BranchClosureSummary): ClosedOption[] {
  const named = new Set(
    summary.blockingIncidents.flatMap((i) => i.closed.map((c) => c.modifier.id)),
  );
  return summary.closedOptions.filter((o) => !named.has(o.modifier.id));
}

/**
 * Board tile emphasis. Three bands rather than a continuous scale: an operator
 * scanning a wall of tiles reads "which colour", not "which number".
 *
 * A single blocked product is already a warning, unlike a single closed one: the
 * branch does not know it has happened, so nobody is dealing with it.
 */
export function severityBand(summary: BranchClosureSummary): 'critical' | 'warning' | 'info' {
  if (summary.deliveryPaused) return 'critical';
  if (summary.blockedProducts.length > 0) return 'warning';
  if (summary.severity >= 3) return 'warning';
  return 'info';
}

const BAND_ORDER: Record<'critical' | 'warning' | 'info', number> = {
  critical: 0, warning: 1, info: 2,
};

/**
 * Worst first — by BAND before severity.
 *
 * Sorting on severity alone let colour and position disagree: a branch with six
 * closed items (severity 6, amber) rendered above a branch with delivery off
 * (severity 5, red), and once a single blocked product raises a branch to amber
 * it would also sort below a louder-looking info tile. "Worst first" has to mean
 * the same thing the colours mean, or the board is teaching an operator to
 * distrust one of the two.
 */
export function compareSummaries(a: BranchClosureSummary, b: BranchClosureSummary): number {
  const byBand = BAND_ORDER[severityBand(a)] - BAND_ORDER[severityBand(b)];
  if (byBand !== 0) return byBand;
  if (b.severity !== a.severity) return b.severity - a.severity;
  return a.branch.nameEn.localeCompare(b.branch.nameEn);
}

/** Countdown text for a closed row, or null when it has no timer. */
export function returnLabel(snoozedUntil: string | null, now: number): string | null {
  return formatRemaining(snoozedUntil, now);
}

/**
 * Branch ids that got worse between two board states.
 *
 * Drives the toast and the alert sound. Comparing per branch rather than by a
 * total means an operator reopening one item while another closes elsewhere
 * still alerts — a net-count comparison would cancel those out and stay silent.
 *
 * BAND is checked before severity, because the transition this board exists to
 * catch does not move severity at all: a branch reopens a product and its sauce
 * group empties in the same poll, so one closed product becomes one blocked
 * product, the count stays at 1, and the band rises from info to warning. A
 * severity-only comparison is silent for exactly that.
 */
export function newlyClosedBranchIds(
  before: BranchClosureSummary[],
  after: BranchClosureSummary[],
): string[] {
  const beforeBy = new Map(before.map((s) => [s.branch.id, s]));
  return after
    .filter((s) => {
      const prior = beforeBy.get(s.branch.id);
      if (!prior) return true;                    // newly on the board
      // Either axis worsening is news. Band alone would go quiet on a branch
      // that resumed delivery (critical -> warning) while losing ten more items
      // in the same poll; severity alone goes quiet on the closed-to-blocked
      // swap this board exists to catch, where the count never moves.
      const bandNow = BAND_ORDER[severityBand(s)];
      const bandThen = BAND_ORDER[severityBand(prior)];
      return bandNow < bandThen || s.severity > prior.severity;
    })
    .map((s) => s.branch.id);
}
