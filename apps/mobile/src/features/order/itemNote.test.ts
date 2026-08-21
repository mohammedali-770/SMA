import { describe, expect, it } from 'vitest';

import { ITEM_NOTE_MAX_LENGTH, ORDER_NOTE_MAX_LENGTH } from './orderNote';
import { makeCartItemId } from '../../utils/format';
import type { Modifier } from '../../types/models';

const mod = (id: string): Modifier => ({
  id, groupId: 'g1', nameEn: id, nameAr: id, price: 1, isActive: true,
} as unknown as Modifier);

const NONE: { [groupId: string]: Modifier[] } = {};
const WITH_MODS = { g1: [mod('m2'), mod('m1')] };

/**
 * The line note is part of the cart line's IDENTITY. Two portions of the same
 * dish where one says "no onion" are two different things to a cook; if they
 * share an id they collapse into one line and whichever note was added last
 * silently applies to both.
 */
describe('makeCartItemId — the note is part of the identity', () => {
  it('is unchanged when there is no note', () => {
    expect(makeCartItemId('p1', NONE)).toBe('p1');
    expect(makeCartItemId('p1', NONE, undefined)).toBe('p1');
    expect(makeCartItemId('p1', NONE, null)).toBe('p1');
    expect(makeCartItemId('p1', NONE, '')).toBe('p1');
  });

  it('treats a whitespace-only note as no note', () => {
    expect(makeCartItemId('p1', NONE, '   ')).toBe('p1');
    expect(makeCartItemId('p1', NONE, '\n\t ')).toBe('p1');
  });

  it('separates the same dish ordered with different instructions', () => {
    const plain = makeCartItemId('p1', NONE);
    const noOnion = makeCartItemId('p1', NONE, 'no onion');
    const extraHot = makeCartItemId('p1', NONE, 'extra hot');
    expect(new Set([plain, noOnion, extraHot]).size).toBe(3);
  });

  it('merges two lines carrying the SAME instruction', () => {
    expect(makeCartItemId('p1', NONE, 'no onion'))
      .toBe(makeCartItemId('p1', NONE, 'no onion'));
    // Trimming is applied before comparison, so spacing is not an identity.
    expect(makeCartItemId('p1', NONE, '  no onion  '))
      .toBe(makeCartItemId('p1', NONE, 'no onion'));
  });

  it('still separates by modifiers, note or not', () => {
    expect(makeCartItemId('p1', WITH_MODS)).not.toBe(makeCartItemId('p1', NONE));
    expect(makeCartItemId('p1', WITH_MODS, 'no onion'))
      .not.toBe(makeCartItemId('p1', NONE, 'no onion'));
    // Modifier order must remain irrelevant — the ids are sorted.
    expect(makeCartItemId('p1', { g1: [mod('m1'), mod('m2')] }, 'x'))
      .toBe(makeCartItemId('p1', { g1: [mod('m2'), mod('m1')] }, 'x'));
  });

  it('does not let a note collide with a modifier list', () => {
    // A note that looks like the modifier separator must not forge another
    // line's identity.
    expect(makeCartItemId('p1', NONE, 'm1,m2')).not.toBe(makeCartItemId('p1', WITH_MODS));
  });
});

describe('ITEM_NOTE_MAX_LENGTH', () => {
  it('is shorter than the whole-order note', () => {
    // A line note is read by a cook glancing at one row while assembling it.
    // Ten lines at the order-note length is not a ticket anyone can work from.
    expect(ITEM_NOTE_MAX_LENGTH).toBeLessThan(ORDER_NOTE_MAX_LENGTH);
  });

  it('matches the bound the database enforces', () => {
    // Mirrors order_item_note_is_acceptable in
    // supabase/migrations/20260821170000_order_item_notes.sql — change together.
    expect(ITEM_NOTE_MAX_LENGTH).toBe(140);
  });
});
