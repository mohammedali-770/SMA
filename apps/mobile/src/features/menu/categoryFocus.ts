/**
 * Which category chip is highlighted on the menu, and who gets to decide.
 *
 * TWO THINGS SET IT AND THEY FOUGHT. Tapping a chip sets it directly; scrolling
 * sets it from whichever section is in view. A tap does both — it sets the chip
 * AND starts an animated scroll — and the scroll spy fires repeatedly on the way,
 * reporting every section it passes. The last such report won, so the highlight
 * landed on the section being LEFT rather than the one tapped, and a second tap
 * was needed to make it stick (the list was already there by then, so the spy
 * agreed).
 *
 * Reported on a real device against build 25, 2026-09-20: tapping "Side dishes"
 * scrolled to Side dishes and highlighted "sandwich".
 *
 * The rule is that a TAP WINS UNTIL THE LIST STOPS MOVING. Scroll reports are
 * ignored while a tap-driven scroll is in flight, and accepted again once it
 * settles — so dragging the list still moves the highlight, which is the whole
 * point of having a spy.
 *
 * Kept as a pure reducer, out of the screen, because the bug is entirely about
 * event ORDER and that is otherwise only reproducible on a device.
 */

export interface CategoryFocus {
  /** The highlighted chip, or null before anything has been decided. */
  activeCatId: string | null;
  /**
   * True from a tap until the list settles. While true, scroll reports are
   * ignored — they are describing the journey, not the destination.
   */
  awaitingSettle: boolean;
}

export type CategoryFocusEvent =
  /** A chip was tapped. Authoritative, and starts the animated scroll. */
  | { kind: 'tap'; catId: string }
  /** The scroll spy reported the section now in view. */
  | { kind: 'spy'; catId: string }
  /**
   * The user put a finger on the list.
   *
   * THIS OUTRANKS THE TAP AND ENDS THE HOLD AT ONCE. Without it, a drag started
   * inside the hold had every one of its reports discarded, and a SLOW drag
   * emits no momentum event — so only the timer ended the hold, and the timer
   * merely unmutes the spy rather than replaying what it missed. Viewability
   * reports fire on CHANGE, so once the user stopped there were no more, and
   * the chip stayed on the tapped category until the next scroll. Caught in
   * review on #409.
   *
   * Cancelling is the right repair rather than replaying the last report on
   * settle: the last in-flight report is exactly the wrong section, which is
   * the bug this reducer exists to fix.
   */
  | { kind: 'drag' }
  /**
   * The list stopped moving.
   *
   * Sent on momentum end AND on a timer, because `scrollToLocation` has no
   * completion callback and fires no momentum event at all when the target is
   * already on screen — without the timer the spy would stay muted for good.
   */
  | { kind: 'settled' };

export const INITIAL_CATEGORY_FOCUS: CategoryFocus = { activeCatId: null, awaitingSettle: false };

export function categoryFocusReducer(state: CategoryFocus, event: CategoryFocusEvent): CategoryFocus {
  switch (event.kind) {
    case 'tap':
      // Re-tapping the same chip still re-arms the hold: it scrolls again, so
      // the spy is about to start reporting the journey again.
      return { activeCatId: event.catId, awaitingSettle: true };
    case 'spy':
      if (state.awaitingSettle) return state;
      if (state.activeCatId === event.catId) return state;
      return { ...state, activeCatId: event.catId };
    case 'drag':
      // Releases the spy WITHOUT touching the chip. Resetting it here would
      // make the highlight jump backwards before the user has scrolled
      // anywhere; the first report of their drag will move it honestly.
      if (!state.awaitingSettle) return state;
      return { ...state, awaitingSettle: false };
    case 'settled':
      if (!state.awaitingSettle) return state;
      return { ...state, awaitingSettle: false };
    default:
      return state;
  }
}
