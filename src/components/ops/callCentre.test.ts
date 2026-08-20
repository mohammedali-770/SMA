import { describe, expect, it } from 'vitest';
import {
  BranchClosureSummary, buildClosureSummaries, newlyClosedBranchIds, returnLabel, severityBand,
} from './callCentre';
import type { Branch, Product } from '../../types';
import type { DeliveryArea } from '../../lib/branchConfigApi';

const branch = (id: string, over: Partial<Branch> = {}): Branch => ({
  id, nameEn: `Branch ${id}`, nameAr: `فرع ${id}`,
  addressAr: '', addressEn: '', phone: '',
  latitude: 0, longitude: 0, isActive: true,
  deliveryFee: 0, minDeliveryOrder: 0,
  ...over,
});

const product = (id: string): Product => ({
  id, categoryId: 'c1', nameAr: id, nameEn: id,
  descriptionAr: '', descriptionEn: '', price: 10,
  imageUrl: '', calories: 0, isActive: true, modifierGroupIds: [],
});

const avail = (branchId: string, productId: string, isAvailable: boolean, snoozedUntil: string | null = null) =>
  ({ branchId, productId, isAvailable, snoozedUntil, reasonCode: null });

const area = (id: string, branchId: string, isDisabled: boolean): DeliveryArea => ({
  id, branchId, nameAr: id, nameEn: id, sortOrder: 1, isDisabled, disabledUntil: null,
});

const base = { branches: [branch('a'), branch('b')], products: [product('p1'), product('p2')] };

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

describe('severityBand', () => {
  const summary = (over: Partial<BranchClosureSummary>): BranchClosureSummary => ({
    branch: branch('a'), closedProducts: [], deliveryPaused: false,
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
  const s = (id: string, severity: number): BranchClosureSummary => ({
    branch: branch(id), closedProducts: [], deliveryPaused: false,
    deliveryUntil: null, disabledAreas: [], severity,
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
});
