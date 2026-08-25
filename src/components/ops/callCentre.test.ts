import { describe, expect, it } from 'vitest';
import {
  BranchClosureSummary, buildClosureSummaries, compareSummaries, newlyClosedBranchIds,
  nonBlockingOptions, optionOnlyBranches, returnLabel, severityBand,
} from './callCentre';
import type { Branch, Modifier, ModifierGroup, Product } from '../../types';
import type { DeliveryArea } from '../../lib/branchConfigApi';

const branch = (id: string, over: Partial<Branch> = {}): Branch => ({
  id, nameEn: `Branch ${id}`, nameAr: `فرع ${id}`,
  addressAr: '', addressEn: '', phone: '',
  latitude: 0, longitude: 0, isActive: true,
  deliveryFee: 0, minDeliveryOrder: 0,
  ...over,
});

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, categoryId: 'c1', nameAr: id, nameEn: id,
  descriptionAr: '', descriptionEn: '', price: 10,
  imageUrl: '', calories: 0, isActive: true, modifierGroupIds: [], variants: [],
  ...over,
});

const modifier = (id: string, groupId: string): Modifier =>
  ({ id, groupId, nameAr: id, nameEn: id, price: 0 });

const group = (id: string, over: Partial<ModifierGroup> = {}): ModifierGroup => ({
  id, nameAr: id, nameEn: id,
  minSelection: 1, maxSelection: 1, isRequired: true,
  modifiers: [modifier(`${id}-m1`, id), modifier(`${id}-m2`, id)],
  ...over,
});

const modAvail = (
  branchId: string, modifierId: string, isAvailable: boolean, snoozedUntil: string | null = null,
) => ({ branchId, modifierId, isAvailable, snoozedUntil, reasonCode: null });

const avail = (branchId: string, productId: string, isAvailable: boolean, snoozedUntil: string | null = null) =>
  ({ branchId, productId, isAvailable, snoozedUntil, reasonCode: null });

const area = (id: string, branchId: string, isDisabled: boolean): DeliveryArea => ({
  id, branchId, nameAr: id, nameEn: id, sortOrder: 1, isDisabled, disabledUntil: null,
});

const base = {
  branches: [branch('a'), branch('b')],
  products: [product('p1'), product('p2')],
  modifierGroups: [] as ModifierGroup[],
  modifierAvailability: [] as ReturnType<typeof modAvail>[],
};

describe('buildClosureSummaries', () => {
  it('omits healthy branches entirely', () => {
    // A board that lists twelve healthy branches to find the one that is not
    // has stopped answering the question it exists for.
    const out = buildClosureSummaries({ ...base, availability: [], areas: [] });
    expect(out).toEqual([]);
  });

  it('includes a branch with a closed item', () => {
    const out = buildClosureSummaries({
      ...base, availability: [avail('a', 'p1', false)], areas: [],
    });
    expect(out.map((s) => s.branch.id)).toEqual(['a']);
    expect(out[0].closedProducts.map((c) => c.product.id)).toEqual(['p1']);
  });

  it('includes a branch whose only problem is paused delivery', () => {
    const out = buildClosureSummaries({
      ...base,
      branches: [branch('a', { deliveryTemporarilyClosed: true }), branch('b')],
      availability: [], areas: [],
    });
    expect(out.map((s) => s.branch.id)).toEqual(['a']);
    expect(out[0].deliveryPaused).toBe(true);
  });

  it('carries the pause timer onto the summary', () => {
    // It was hardcoded null, so the panel could say delivery was off but never
    // when it comes back.
    const until = '2026-08-20T18:00:00Z';
    const out = buildClosureSummaries({
      ...base,
      branches: [branch('a', { deliveryTemporarilyClosed: true, deliveryClosedUntil: until })],
      availability: [], areas: [],
    });
    expect(out[0].deliveryUntil).toBe(until);
  });

  it('reports no pause timer for the admin\u2019s untimed toggle', () => {
    const out = buildClosureSummaries({
      ...base,
      branches: [branch('a', { deliveryTemporarilyClosed: true })],
      availability: [], areas: [],
    });
    expect(out[0].deliveryPaused).toBe(true);
    expect(out[0].deliveryUntil).toBeNull();
  });

  it('ignores a stale timer left on a branch whose delivery is RUNNING', () => {
    // A countdown for something that already came back is worse than none. The
    // branches trigger nulls the column on resume, but the board must not
    // depend on that having happened yet.
    const out = buildClosureSummaries({
      ...base,
      branches: [branch('a', {
        deliveryTemporarilyClosed: false, deliveryClosedUntil: '2026-08-20T18:00:00Z',
      })],
      availability: [avail('a', 'p1', false)],
      areas: [],
    });
    expect(out[0].deliveryPaused).toBe(false);
    expect(out[0].deliveryUntil).toBeNull();
  });

  it('includes a branch whose only problem is a disabled area', () => {
    const out = buildClosureSummaries({
      ...base, availability: [], areas: [area('ar1', 'a', true)],
    });
    expect(out.map((s) => s.branch.id)).toEqual(['a']);
  });

  it('ranks paused delivery above a couple of sold-out items', () => {
    // Delivery being off is a bigger operational fact than one missing item.
    const out = buildClosureSummaries({
      ...base,
      branches: [branch('a'), branch('b', { deliveryTemporarilyClosed: true })],
      availability: [avail('a', 'p1', false), avail('a', 'p2', false)],
      areas: [],
    });
    expect(out.map((s) => s.branch.id)).toEqual(['b', 'a']);
  });

  it('sorts a branch\'s closed items by soonest return, untimed last', () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 600_000).toISOString();
    const out = buildClosureSummaries({
      ...base,
      products: [product('p1'), product('p2'), product('p3')],
      availability: [
        avail('a', 'p1', false, later),
        avail('a', 'p2', false, null),
        avail('a', 'p3', false, soon),
      ],
      areas: [],
    });
    expect(out[0].closedProducts.map((c) => c.product.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('ignores available rows and rows whose product left the catalog', () => {
    const out = buildClosureSummaries({
      ...base,
      availability: [avail('a', 'p1', true), avail('a', 'ghost', false)],
      areas: [],
    });
    expect(out).toEqual([]);
  });

  it('breaks ties by branch name so the board does not reshuffle each poll', () => {
    const out = buildClosureSummaries({
      ...base,
      branches: [branch('z', { nameEn: 'Zed' }), branch('a', { nameEn: 'Alpha' })],
      availability: [avail('z', 'p1', false), avail('a', 'p1', false)],
      areas: [],
    });
    expect(out.map((s) => s.branch.nameEn)).toEqual(['Alpha', 'Zed']);
  });
});

describe('buildClosureSummaries — the options gap', () => {
  // A required heat group with two options, on product p1.
  const heat = group('heat');
  const withGroup = { ...base, products: [product('p1', { modifierGroupIds: ['heat'] }), product('p2')], modifierGroups: [heat] };

  it('THE GAP: a branch whose products are all "available" appears once a required group runs out', () => {
    // This is the case the board could not see. branch_product_availability
    // still says p1 is on sale; no customer can order it.
    const out = buildClosureSummaries({
      ...withGroup,
      availability: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
      areas: [],
    });
    expect(out.map((s) => s.branch.id)).toEqual(['a']);
    expect(out[0].blockedProducts.map((b) => b.product.id)).toEqual(['p1']);
    expect(out[0].closedProducts).toEqual([]);
  });

  it('closing ONE option of two leaves the product orderable and the branch off the board', () => {
    const out = buildClosureSummaries({
      ...withGroup,
      availability: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false)],
      areas: [],
    });
    expect(out).toEqual([]);
  });

  it('an OPTIONAL group never blocks, however many of its options are closed', () => {
    const optional = group('heat', { isRequired: false, minSelection: 0 });
    const out = buildClosureSummaries({
      ...withGroup,
      modifierGroups: [optional],
      availability: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
      areas: [],
    });
    expect(out).toEqual([]);
  });

  it('a group demanding two picks blocks as soon as only one option is left', () => {
    const two = group('heat', { minSelection: 2, maxSelection: 3 });
    const out = buildClosureSummaries({
      ...withGroup,
      modifierGroups: [two],
      availability: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false)],
      areas: [],
    });
    expect(out[0].blockedProducts.map((b) => b.product.id)).toEqual(['p1']);
  });

  it('a product the branch closed outright is reported ONCE, as closed, not also as blocked', () => {
    // Counting it twice would inflate severity and read as two problems.
    const out = buildClosureSummaries({
      ...withGroup,
      availability: [avail('a', 'p1', false)],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
      areas: [],
    });
    expect(out[0].closedProducts.map((c) => c.product.id)).toEqual(['p1']);
    expect(out[0].blockedProducts).toEqual([]);
    expect(out[0].severity).toBe(1);
  });

  it('one closed group blocks every product that uses it, but is ONE incident', () => {
    // Fan-out: the cause is one sentence, the effects are many. A list of
    // forty product rows describes one incident forty times.
    const products = [
      product('p1', { modifierGroupIds: ['heat'] }),
      product('p2', { modifierGroupIds: ['heat'] }),
      product('p3', { modifierGroupIds: ['heat'] }),
    ];
    const out = buildClosureSummaries({
      ...withGroup, products,
      availability: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
      areas: [],
    });
    expect(out[0].blockedProducts).toHaveLength(3);
    expect(out[0].blockingIncidents).toHaveLength(1);
    expect(out[0].blockingIncidents[0].affected.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(out[0].blockingIncidents[0].required).toBe(1);
    expect(out[0].blockingIncidents[0].remaining).toBe(0);
  });

  it('a delisted product is never reported as blocked', () => {
    const out = buildClosureSummaries({
      ...withGroup,
      products: [product('p1', { modifierGroupIds: ['heat'], isActive: false })],
      availability: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
      areas: [],
    });
    expect(out).toEqual([]);
  });

  it('a group that blocks nothing anyone sells is not an incident', () => {
    const out = buildClosureSummaries({
      ...withGroup,
      products: [product('p2')],                    // nothing uses the heat group
      availability: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
      areas: [],
    });
    expect(out).toEqual([]);
  });

  it('a required group nobody can satisfy anywhere is a CATALOG defect, not a branch closure', () => {
    // Deliberate: reporting it would pin every branch to the board forever with
    // nothing a call-centre operator could do, and the board would stop
    // answering its one question. Catalog validation owns this.
    //
    // The branch must have a closure SOMEWHERE, or the scan short-circuits
    // before reaching the rule and the test proves nothing. Here `sauce` is
    // closed but satisfiable, so the scan runs and the empty `heat` group is
    // still not reported.
    const empty = group('heat', { modifiers: [] });
    const sauce = group('sauce');
    const out = buildClosureSummaries({
      ...withGroup,
      products: [product('p1', { modifierGroupIds: ['heat', 'sauce'] })],
      modifierGroups: [empty, sauce],
      availability: [],
      modifierAvailability: [modAvail('a', 'sauce-m1', false)],
      areas: [],
    });
    expect(out).toEqual([]);
  });

  it('ignores an option row whose modifier left the catalog', () => {
    const out = buildClosureSummaries({
      ...withGroup, availability: [],
      modifierAvailability: [modAvail('a', 'ghost', false)], areas: [],
    });
    expect(out).toEqual([]);
  });

  it('counts a blocked product in severity exactly like a closed one', () => {
    // To the customer they are the same disappointment, and the sort depends on
    // this term being there at all.
    const out = buildClosureSummaries({
      ...withGroup,
      products: [product('p1', { modifierGroupIds: ['heat'] }), product('p2')],
      availability: [avail('a', 'p2', false)],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
      areas: [],
    });
    expect(out[0].closedProducts).toHaveLength(1);
    expect(out[0].blockedProducts).toHaveLength(1);
    expect(out[0].severity).toBe(2);
  });

  it('orders blocked products by SOONEST predicted return, not catalog order', () => {
    // The tile reads blockedProducts[0]'s time out as the branch's earliest
    // return. In catalog order that is an arbitrary row, and an operator
    // repeats the number to a caller as a promise.
    const at = (mins: number) =>
      new Date(Date.parse('2026-08-20T10:00:00Z') + mins * 60_000).toISOString();
    const sauce = group('sauce');
    const out = buildClosureSummaries({
      ...withGroup,
      products: [
        product('p1', { modifierGroupIds: ['heat'] }),   // first in the catalog
        product('p2', { modifierGroupIds: ['sauce'] }),  // but back much sooner
      ],
      modifierGroups: [heat, sauce],
      availability: [],
      modifierAvailability: [
        modAvail('a', 'heat-m1', false, at(360)), modAvail('a', 'heat-m2', false, at(360)),
        modAvail('a', 'sauce-m1', false, at(10)), modAvail('a', 'sauce-m2', false, at(10)),
      ],
      areas: [],
    });
    expect(out[0].blockedProducts.map((b) => b.product.id)).toEqual(['p2', 'p1']);
    expect(out[0].blockedProducts[0].earliestReturn).toBe(at(10));
    expect(out[0].blockingIncidents.map((i) => i.group.id)).toEqual(['sauce', 'heat']);
  });

  it('an untimed blocking group sorts LAST, so it cannot hide a soon return', () => {
    const at = (mins: number) =>
      new Date(Date.parse('2026-08-20T10:00:00Z') + mins * 60_000).toISOString();
    const sauce = group('sauce');
    const out = buildClosureSummaries({
      ...withGroup,
      products: [
        product('p1', { modifierGroupIds: ['heat'] }),
        product('p2', { modifierGroupIds: ['sauce'] }),
      ],
      modifierGroups: [heat, sauce],
      availability: [],
      modifierAvailability: [
        modAvail('a', 'heat-m1', false, null), modAvail('a', 'heat-m2', false, null),
        modAvail('a', 'sauce-m1', false, at(10)), modAvail('a', 'sauce-m2', false, at(10)),
      ],
      areas: [],
    });
    expect(out[0].blockedProducts.map((b) => b.product.id)).toEqual(['p2', 'p1']);
  });

  it('carries every closed option on the summary, blocking or not', () => {
    const out = buildClosureSummaries({
      ...withGroup,
      availability: [avail('a', 'p2', false)],      // on the board for another reason
      modifierAvailability: [modAvail('a', 'heat-m1', false)],
      areas: [],
    });
    expect(out[0].closedOptions.map((o) => o.modifier.id)).toEqual(['heat-m1']);
    expect(out[0].blockedProducts).toEqual([]);
  });
});

describe('buildClosureSummaries — earliestReturn is Nth-soonest, not first', () => {
  const at = (mins: number) => new Date(Date.parse('2026-08-20T10:00:00Z') + mins * 60_000).toISOString();
  const heat = group('heat');
  const withGroup = {
    ...base,
    products: [product('p1', { modifierGroupIds: ['heat'] })],
    modifierGroups: [heat],
  };

  it('a one-pick group returns when the FIRST closed option returns', () => {
    const out = buildClosureSummaries({
      ...withGroup, availability: [], areas: [],
      modifierAvailability: [
        modAvail('a', 'heat-m1', false, at(30)),
        modAvail('a', 'heat-m2', false, at(10)),
      ],
    });
    expect(out[0].blockedProducts[0].earliestReturn).toBe(at(10));
  });

  it('a group demanding TWO picks returns when the second returns, not the first', () => {
    // The tempting bug. One option back still leaves the group unsatisfiable.
    const two = group('heat', {
      minSelection: 2, maxSelection: 3,
      modifiers: [modifier('heat-m1', 'heat'), modifier('heat-m2', 'heat'), modifier('heat-m3', 'heat')],
    });
    const out = buildClosureSummaries({
      ...withGroup, modifierGroups: [two], availability: [], areas: [],
      modifierAvailability: [
        modAvail('a', 'heat-m1', false, at(10)),
        modAvail('a', 'heat-m2', false, at(30)),
        modAvail('a', 'heat-m3', false, at(50)),
      ],
    });
    expect(out[0].blockedProducts[0].earliestReturn).toBe(at(30));
  });

  it('is null when an option that must return has no timer', () => {
    const out = buildClosureSummaries({
      ...withGroup, availability: [], areas: [],
      modifierAvailability: [
        modAvail('a', 'heat-m1', false, null),
        modAvail('a', 'heat-m2', false, null),
      ],
    });
    expect(out[0].blockedProducts[0].earliestReturn).toBeNull();
  });

  it('a product blocked by TWO groups returns at the later of the two', () => {
    const sauce = group('sauce');
    const out = buildClosureSummaries({
      ...withGroup,
      products: [product('p1', { modifierGroupIds: ['heat', 'sauce'] })],
      modifierGroups: [heat, sauce],
      availability: [], areas: [],
      modifierAvailability: [
        modAvail('a', 'heat-m1', false, at(10)), modAvail('a', 'heat-m2', false, at(10)),
        modAvail('a', 'sauce-m1', false, at(40)), modAvail('a', 'sauce-m2', false, at(40)),
      ],
    });
    expect(out[0].blockedProducts[0].earliestReturn).toBe(at(40));
  });
});

describe('optionOnlyBranches', () => {
  const heat = group('heat');
  const withGroup = { ...base, products: [product('p1', { modifierGroupIds: ['heat'] })], modifierGroups: [heat] };

  it('reports a branch whose closed option blocks nothing', () => {
    // Not board-worthy — every item is still orderable — but "can I get garlic
    // sauce at Jeddah?" is a real call and needs an answer somewhere.
    const out = optionOnlyBranches({
      ...withGroup, availability: [], areas: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false)],
    });
    expect(out.map((b) => b.branch.id)).toEqual(['a']);
    expect(out[0].closedOptions.map((o) => o.modifier.id)).toEqual(['heat-m1']);
  });

  it('skips a branch already on the board, whose panel shows its options', () => {
    const out = optionOnlyBranches({
      ...withGroup, availability: [avail('a', 'p1', false)], areas: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false)],
    });
    expect(out).toEqual([]);
  });

  it('is empty when nothing is closed', () => {
    expect(optionOnlyBranches({ ...withGroup, availability: [], areas: [], modifierAvailability: [] }))
      .toEqual([]);
  });
});

describe('nonBlockingOptions', () => {
  const heat = group('heat');
  const withGroup = { ...base, products: [product('p1', { modifierGroupIds: ['heat'] })], modifierGroups: [heat] };

  it('drops options the incident rows already name, so nothing is said twice', () => {
    const out = buildClosureSummaries({
      ...withGroup, availability: [], areas: [],
      modifierAvailability: [modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false)],
    });
    expect(out[0].closedOptions).toHaveLength(2);
    expect(nonBlockingOptions(out[0])).toEqual([]);
  });

  it('keeps an option that blocks nothing', () => {
    const sauce = group('sauce');
    const out = buildClosureSummaries({
      ...withGroup,
      products: [product('p1', { modifierGroupIds: ['heat'] })],
      modifierGroups: [heat, sauce],
      availability: [], areas: [],
      modifierAvailability: [
        modAvail('a', 'heat-m1', false), modAvail('a', 'heat-m2', false),
        modAvail('a', 'sauce-m1', false),
      ],
    });
    expect(nonBlockingOptions(out[0]).map((o) => o.modifier.id)).toEqual(['sauce-m1']);
  });
});

describe('severityBand', () => {
  const summary = (over: Partial<BranchClosureSummary>): BranchClosureSummary => ({
    branch: branch('a'), closedProducts: [], blockedProducts: [], blockingIncidents: [],
    closedOptions: [], deliveryPaused: false,
    deliveryUntil: null, disabledAreas: [], severity: 0, ...over,
  });

  it('treats paused delivery as critical whatever else is true', () => {
    expect(severityBand(summary({ deliveryPaused: true, severity: 5 }))).toBe('critical');
  });

  it('warns once several things are closed', () => {
    expect(severityBand(summary({ severity: 3 }))).toBe('warning');
  });

  it('stays informational for a single closure', () => {
    expect(severityBand(summary({ severity: 1 }))).toBe('info');
  });

  it('warns on a SINGLE blocked product, unlike a single closure', () => {
    // The branch closed the item deliberately and knows about it. Nobody
    // decided to take a blocked item off the menu, so nobody is dealing with it.
    const blocked = { product: product('p1'), groups: [], earliestReturn: null };
    expect(severityBand(summary({ severity: 1, blockedProducts: [blocked] }))).toBe('warning');
  });

  it('keeps paused delivery critical whatever is blocked', () => {
    const blocked = { product: product('p1'), groups: [], earliestReturn: null };
    expect(severityBand(summary({ deliveryPaused: true, blockedProducts: [blocked] })))
      .toBe('critical');
  });
});

describe('compareSummaries', () => {
  const at = (over: Partial<BranchClosureSummary>): BranchClosureSummary => ({
    branch: branch('a'), closedProducts: [], blockedProducts: [], blockingIncidents: [],
    closedOptions: [], deliveryPaused: false, deliveryUntil: null, disabledAreas: [],
    severity: 0, ...over,
  });

  it('a paused branch outranks a branch with MORE closures', () => {
    // Sorting on severity alone let colour and position disagree: six closures
    // (severity 6, amber) rendered above delivery being off (severity 5, red).
    const paused = at({ branch: branch('z'), deliveryPaused: true, severity: 5 });
    const busy = at({ branch: branch('a'), severity: 6 });
    expect([busy, paused].sort(compareSummaries).map((s) => s.branch.id)).toEqual(['z', 'a']);
  });

  it('an amber blocked branch outranks a louder-looking info branch', () => {
    const blocked = at({
      branch: branch('z'), severity: 1,
      blockedProducts: [{ product: product('p1'), groups: [], earliestReturn: null }],
    });
    const noisy = at({ branch: branch('a'), severity: 2 });
    expect([noisy, blocked].sort(compareSummaries).map((s) => s.branch.id)).toEqual(['z', 'a']);
  });

  it('falls back to severity, then to branch name, so the board does not reshuffle', () => {
    const a = at({ branch: branch('a', { nameEn: 'Alpha' }), severity: 1 });
    const z = at({ branch: branch('z', { nameEn: 'Zed' }), severity: 1 });
    const big = at({ branch: branch('m', { nameEn: 'Mid' }), severity: 2 });
    expect([z, a, big].sort(compareSummaries).map((s) => s.branch.nameEn))
      .toEqual(['Mid', 'Alpha', 'Zed']);
  });
});

describe('returnLabel', () => {
  it('counts down while time remains', () => {
    const now = Date.parse('2026-08-20T10:00:00Z');
    expect(returnLabel(new Date(now + 90_000).toISOString(), now)).toBe('1:30');
  });

  it('is null for an untimed closure or a lapsed timer', () => {
    const now = Date.parse('2026-08-20T10:00:00Z');
    expect(returnLabel(null, now)).toBeNull();
    expect(returnLabel(new Date(now - 1).toISOString(), now)).toBeNull();
  });
});

describe('newlyClosedBranchIds', () => {
  const s = (
    id: string, severity: number, over: Partial<BranchClosureSummary> = {},
  ): BranchClosureSummary => ({
    branch: branch(id), closedProducts: [], blockedProducts: [], blockingIncidents: [],
    closedOptions: [], deliveryPaused: false,
    deliveryUntil: null, disabledAreas: [], severity, ...over,
  });

  it('reports a branch that has just appeared on the board', () => {
    expect(newlyClosedBranchIds([], [s('a', 1)])).toEqual(['a']);
  });

  it('reports a branch that got worse', () => {
    expect(newlyClosedBranchIds([s('a', 1)], [s('a', 2)])).toEqual(['a']);
  });

  it('stays quiet when a branch improves or is unchanged', () => {
    expect(newlyClosedBranchIds([s('a', 2)], [s('a', 2)])).toEqual([]);
    expect(newlyClosedBranchIds([s('a', 2)], [s('a', 1)])).toEqual([]);
  });

  it('still alerts when one branch improves as another worsens', () => {
    // A net-count comparison would cancel these out and stay silent, which is
    // exactly when an operator most needs to be told.
    expect(newlyClosedBranchIds([s('a', 3)], [s('a', 1), s('b', 1)])).toEqual(['b']);
  });

  it('alerts when a closed product becomes a BLOCKED one, though severity is flat', () => {
    // The transition this whole change exists to catch, and the one a
    // severity-only comparison is silent for: the branch reopens the burger and
    // its sauce group empties in the same poll. Count stays at 1; nobody knows
    // the item is still off the menu.
    const before = s('a', 1, {
      closedProducts: [{ product: product('p1'), snoozedUntil: null }],
    });
    const after = s('a', 1, {
      blockedProducts: [{ product: product('p1'), groups: [], earliestReturn: null }],
    });
    expect(newlyClosedBranchIds([before], [after])).toEqual(['a']);
  });

  it('alerts when the band improves but the branch loses far more items', () => {
    // Delivery came back (critical -> warning) while ten more items went off in
    // the same poll. Checking the band FIRST and returning early made the board
    // silent for that, which is a branch getting materially worse.
    const before = s('a', 5, { deliveryPaused: true });
    const after = s('a', 12, {
      blockedProducts: [{ product: product('p1'), groups: [], earliestReturn: null }],
    });
    expect(newlyClosedBranchIds([before], [after])).toEqual(['a']);
  });

  it('stays quiet when the band improves even if severity is unchanged', () => {
    const before = s('a', 1, {
      blockedProducts: [{ product: product('p1'), groups: [], earliestReturn: null }],
    });
    const after = s('a', 1, { closedProducts: [{ product: product('p1'), snoozedUntil: null }] });
    expect(newlyClosedBranchIds([before], [after])).toEqual([]);
  });
});
