import { describe, expect, it } from 'vitest';

import {
  categoryFocusReducer,
  INITIAL_CATEGORY_FOCUS,
  type CategoryFocus,
  type CategoryFocusEvent,
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
    const out = run([{ kind: 'tap', catId: 'sides' }, { kind: 'settled' }, { kind: 'spy', catId: 'drinks' }]);
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

  /**
   * A DRAG IS THE USER TAKING OVER, AND IT OUTRANKS THE TAP IMMEDIATELY.
   *
   * Review caught this on #409, and it is the failure mode this reducer was
   * most at risk of creating: tap a category, then start dragging inside the
   * 700 ms hold. Every report from that drag was discarded, and a SLOW drag
   * produces no momentum event, so nothing but the timer ended the hold -- and
   * the timer only unmutes the spy, it does not replay what was missed.
   * Viewability reports fire on CHANGE, so once the user stops there are no
   * more, and the chip stayed on the tapped category until they scrolled again.
   *
   * The narrow fix is to cancel the hold the moment a drag begins rather than
   * to replay reports on settle. Replaying would re-introduce the original bug:
   * the last in-flight report is precisely the wrong section.
   */
  it('a user drag cancels the hold immediately', () => {
    const out = run([{ kind: 'tap', catId: 'sides' }, { kind: 'drag' }, { kind: 'spy', catId: 'drinks' }]);
    expect(out.activeCatId).toBe('drinks');
    expect(out.awaitingSettle).toBe(false);
  });

  it('a drag with no momentum event still leaves the spy live', () => {
    // The exact reported sequence: tap, drag, spy, and only then the timer.
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'drag' },
      { kind: 'spy', catId: 'drinks' },
      { kind: 'settled' },
      { kind: 'spy', catId: 'sauces' },
    ]);
    expect(out.activeCatId).toBe('sauces');
  });

  it('a drag BEFORE any tap changes nothing', () => {
    const idle: CategoryFocus = { activeCatId: 'meals', awaitingSettle: false };
    expect(categoryFocusReducer(idle, { kind: 'drag' })).toBe(idle);
  });

  it('does not let a drag undo the tapped category itself', () => {
    // Cancelling the hold releases the spy; it must not also reset the chip,
    // or the highlight would jump back before the user has scrolled anywhere.
    const out = run([{ kind: 'tap', catId: 'sides' }, { kind: 'drag' }]);
    expect(out.activeCatId).toBe('sides');
  });

  /**
   * A RE-ISSUED SCROLL MUST RE-ARM THE HOLD.
   *
   * Reported on build 26: the very FIRST tap after opening the menu did not
   * highlight, the second did, and from then on the first tap always worked.
   * The cause is the virtualized list. `scrollToLocation` fails when the target
   * section has not been measured yet -- which is true only until the list has
   * scrolled once -- and `onScrollToIndexFailed` then jumps raw and re-issues
   * the animated scroll 120 ms later. That second scroll was travelling with no
   * hold in place, so its in-flight reports moved the chip: the original bug,
   * surviving on the one path where the scroll happens twice.
   */
  it('a re-issued scroll re-arms the hold without changing the chip', () => {
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'settled' },
      { kind: 'rescroll' },
      { kind: 'spy', catId: 'sandwich' },
    ]);
    expect(out.activeCatId).toBe('sides');
    expect(out.awaitingSettle).toBe(true);
  });

  it('a rescroll with nothing selected at all is ignored', () => {
    // Only `activeCatId === null` is genuinely "nothing to protect". A
    // rescroll can ONLY follow a programmatic scroll, which can only follow a
    // tap -- so a non-null category always has a destination worth holding,
    // and the reducer cannot tell a tap-set value from a spy-set one anyway.
    // An earlier version of this test asserted the opposite and was wrong
    // about the semantics, not about the code.
    expect(categoryFocusReducer(INITIAL_CATEGORY_FOCUS, { kind: 'rescroll' })).toBe(
      INITIAL_CATEGORY_FOCUS,
    );
  });

  it('re-arms even when the hold had already lapsed — the whole point', () => {
    // The 700 ms timer can expire before a retry lands. Without re-arming, the
    // retry travels unprotected and the spy steals the chip.
    const lapsed: CategoryFocus = { activeCatId: 'sides', awaitingSettle: false };
    expect(categoryFocusReducer(lapsed, { kind: 'rescroll' })).toEqual({
      activeCatId: 'sides',
      awaitingSettle: true,
    });
  });

  it('a drag still beats a re-issued scroll', () => {
    // The user's finger outranks the retry, exactly as it outranks the tap.
    const out = run([
      { kind: 'tap', catId: 'sides' },
      { kind: 'rescroll' },
      { kind: 'drag' },
      { kind: 'spy', catId: 'drinks' },
    ]);
    expect(out.activeCatId).toBe('drinks');
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
    const out = run([{ kind: 'spy', catId: 'meals' }, { kind: 'settled' }, { kind: 'spy', catId: 'drinks' }]);
    expect(out.activeCatId).toBe('drinks');
  });
});
