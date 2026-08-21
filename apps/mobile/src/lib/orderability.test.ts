import { describe, expect, it } from 'vitest';

import { blockingGroups, productOrderable, requiredCount } from './orderability';
import type { Modifier, ModifierGroup } from '../types/models';

function mod(id: string): Modifier {
  return { id, groupId: 'g1', nameEn: id, nameAr: id, price: 0 };
}
function group(over: Partial<ModifierGroup> = {}): ModifierGroup {
  return {
    id: 'g1', nameEn: 'Heat', nameAr: 'الحرارة',
    minSelection: 0, maxSelection: 1, isRequired: false,
    modifiers: [mod('m1'), mod('m2')],
    ...over,
  };
}

const allOpen = () => true;
const closed = (...ids: string[]) => (id: string) => !ids.includes(id);

describe('requiredCount', () => {
  it('a required group needs at least one even when minSelection is 0', () => {
    // The data does not keep isRequired and min_selection in step; this is the
    // one place that resolution is written down.
    expect(requiredCount(group({ isRequired: true, minSelection: 0 }))).toBe(1);
  });
  it('honours a higher minSelection on a required group', () => {
    expect(requiredCount(group({ isRequired: true, minSelection: 2 }))).toBe(2);
  });
  it('an optional group needs nothing', () => {
    expect(requiredCount(group({ isRequired: false, minSelection: 0 }))).toBe(0);
  });
  it('an optional group with a minimum still needs that many', () => {
    expect(requiredCount(group({ isRequired: false, minSelection: 2 }))).toBe(2);
  });
});

describe('blockingGroups', () => {
  it('nothing blocks while every option is open', () => {
    expect(blockingGroups([group({ isRequired: true })], allOpen)).toEqual([]);
  });

  it('a required group with one option left does NOT block', () => {
    // Closing one sauce is not closing the burger — the whole point of
    // option-level snoozing.
    expect(blockingGroups([group({ isRequired: true })], closed('m1'))).toEqual([]);
  });

  it('a required group with every option closed blocks', () => {
    const out = blockingGroups([group({ isRequired: true })], closed('m1', 'm2'));
    expect(out.map((g) => g.id)).toEqual(['g1']);
  });

  it('an OPTIONAL group never blocks, however many options are closed', () => {
    // "No sauce" stays a valid answer.
    expect(blockingGroups([group({ isRequired: false })], closed('m1', 'm2'))).toEqual([]);
  });

  it('blocks when fewer options remain than a multi-select minimum demands', () => {
    const g = group({ isRequired: true, minSelection: 2, maxSelection: 3 });
    expect(blockingGroups([g], closed('m1')).map((x) => x.id)).toEqual(['g1']);
  });

  it('reports every blocking group, not just the first', () => {
    const a = group({ id: 'a', isRequired: true, modifiers: [mod('m1')] });
    const b = group({ id: 'b', isRequired: true, modifiers: [mod('m2')] });
    expect(blockingGroups([a, b], closed('m1', 'm2')).map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('a product with no groups is never blocked', () => {
    expect(blockingGroups([], closed('m1'))).toEqual([]);
  });
});

describe('productOrderable', () => {
  it('open product, open options → orderable', () => {
    expect(productOrderable({
      productAvailable: true, groups: [group({ isRequired: true })], isModifierAvailable: allOpen,
    })).toBe(true);
  });

  it('a closed product is not orderable even with every option open', () => {
    expect(productOrderable({
      productAvailable: false, groups: [group()], isModifierAvailable: allOpen,
    })).toBe(false);
  });

  it('an open product whose required group is fully closed is NOT orderable', () => {
    // This is the case the server enforces indirectly: a required group forces
    // a selection and place_order refuses any closed option, so there is no
    // order the customer could place.
    expect(productOrderable({
      productAvailable: true,
      groups: [group({ isRequired: true })],
      isModifierAvailable: closed('m1', 'm2'),
    })).toBe(false);
  });

  it('an open product whose OPTIONAL group is fully closed stays orderable', () => {
    expect(productOrderable({
      productAvailable: true,
      groups: [group({ isRequired: false })],
      isModifierAvailable: closed('m1', 'm2'),
    })).toBe(true);
  });
});
