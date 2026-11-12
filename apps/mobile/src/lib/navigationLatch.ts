/**
 * A one-shot latch for navigation presses.
 *
 * A double tap, or a double click on the web build, fired a navigation twice:
 * "Sign in" stacked two login screens, so the first "Not now" left the
 * customer on login; "Not now" ran `router.back()` twice and overshot to Home;
 * and Choose, Change and the cart bar each left a duplicate screen that needed
 * a second Back. The second press arrives before the first navigation has
 * finished, so nothing on screen has changed to stop it.
 *
 * The first `tryAcquire` wins and every later one is refused until the latch
 * is released: by the screen regaining focus (the customer came back), or by
 * the timeout, a safety net for a navigation that never happened (pushing the
 * route already shown, say), so a press is never swallowed for longer than a
 * blink.
 *
 * Deliberately a call-site latch and not a debounce on the design-system
 * Button: most of the measured offenders are not Buttons, a time-based
 * debounce would also throttle legitimate rapid presses such as a quantity
 * stepper, and `design-system/` is shared with the console.
 *
 * Framework-free, so it is unit tested under Node; `useNavigationLatch` is the
 * React wrapper.
 */

/** How long a press holds the latch when no focus event releases it. */
export const NAVIGATION_LATCH_TIMEOUT_MS = 800;

export interface NavigationLatch {
  /** True for the first call; false while the latch is held. */
  tryAcquire(): boolean;
  /** Release now. Safe to call when not held. */
  release(): void;
  isHeld(): boolean;
  /** Clear any pending timer, for unmount. */
  dispose(): void;
}

export interface NavigationLatchOptions {
  timeoutMs?: number;
  /** Injected for tests; default to the globals. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createNavigationLatch(options: NavigationLatchOptions = {}): NavigationLatch {
  const timeoutMs = options.timeoutMs ?? NAVIGATION_LATCH_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let held = false;
  let timer: unknown = null;

  const release = () => {
    held = false;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      timer = setTimer(release, timeoutMs);
      return true;
    },
    release,
    isHeld: () => held,
    dispose: release,
  };
}
