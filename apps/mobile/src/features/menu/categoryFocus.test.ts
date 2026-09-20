import { describe, expect, it } from 'vitest';

import {
  categoryFocusReducer, INITIAL_CATEGORY_FOCUS,
  type CategoryFocus, type CategoryFocusEvent,
} from './categoryFocus';

const run = (events: CategoryFocusEvent[], from: CategoryFocus = INITIAL_CATEGORY_FOCUS) =>
  events.reduce(categoryFocusReducer, from);

describe('categoryFocusReducer', () => {
  /**
   * THE REPORTED BUG, as the exact event sequence a device produces.
   *
   * Tapping "sides" scrolls from "sandwich"; the spy fires mid-flight naming
   * every section it passes. Before this reducer the last report won and the
   * chip showed "sandwich" — the section being left — so a second tap was
   * needed.
   */
  it('keeps the TAPPED category while the scroll is still travelling', () => {
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'spy', catId: 'meals' },
      { kind: 'spy', catId: 'sandwich' },
    ]);
    expect(out.activeCatId).toBe('sides');
  });

  it('still shows the tapped category once the list settles', () => {
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'spy', catId: 'sandwich' },
      { kind: 'settled' },
    ]);
    expect(out.activeCatId).toBe('sides');
    expect(out.awaitingSettle).toBe(false);
  });

  it('lets the spy drive again after the list settles — a drag must move it', () => {
    // The spy is muted for one journey, not disabled. Losing this would trade
    // one bug for a worse one: a highlight that never follows the menu.
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'settled' },
      { kind: 'spy', catId: 'drinks' },
    ]);
    expect(out.activeCatId).toBe('drinks');
  });

  it('follows the spy when nothing was tapped at all', () => {
    const out = run([{ kind: 'spy', catId: 'meals' }]);
    expect(out.activeCatId).toBe('meals');
  });

  it('re-arms the hold on a SECOND tap mid-flight', () => {
    // Tapping again before the first scroll lands must not leave the spy live:
    // a new scroll has started, so a new journey is about to be reported.
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'settled' },
      { kind: 'tap', catId: 'drinks' },
      { kind: 'spy', catId: 'sandwich' },
    ]);
    expect(out.activeCatId).toBe('drinks');
    expect(out.awaitingSettle).toBe(true);
  });

  it('re-arms even when the same chip is tapped twice', () => {
    // It scrolls again, so the spy is about to report the journey again.
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'settled' },
      { kind: 'tap', catId: 'sides' },
      { kind: 'spy', catId: 'meals' },
    ]);
    expect(out.activeCatId).toBe('sides');
  });

  it('returns the SAME object when a spy report changes nothing', () => {
    // Identity matters: this feeds a chip-strip effect that scrolls the strip
    // sideways, and a new object every scroll frame would re-run it constantly.
    const settled: CategoryFocus = { activeCatId: 'meals', awaitingSettle: false };
    expect(categoryFocusReducer(settled, { kind: 'spy', catId: 'meals' })).toBe(settled);
  });

  it('returns the SAME object for a stray settle', () => {
    const idle: CategoryFocus = { activeCatId: 'meals', awaitingSettle: false };
    expect(categoryFocusReducer(idle, { kind: 'settled' })).toBe(idle);
  });

  it('a settle from a drag the user started does not strand the spy', () => {
    // momentum-end fires for user drags too. That is fine: it only clears a
    // hold, and with no hold set it is a no-op.
    const out = run([
      { kind: 'spy', catId: 'meals' },
      { kind: 'settled' },
      { kind: 'spy', catId: 'drinks' },
    ]);
    expect(out.activeCatId).toBe('drinks');
  });
});
