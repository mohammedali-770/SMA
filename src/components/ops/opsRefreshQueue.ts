/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serialises board refreshes, keeping ONE trailing run.
 *
 * Extracted from `useOpsChangeFeed` so the rule can be tested directly rather
 * than through a websocket, three timers and a React effect.
 *
 * The rule it enforces: a change that arrives while a refresh is already in
 * flight must not be dropped. The running queries may already have read past the
 * changed row, so discarding the event leaves the board stale until the next
 * backstop poll a minute later. Exactly one extra run is remembered, however
 * many events arrive — a burst collapses into a single trailing refresh instead
 * of one per event.
 */
export interface RefreshQueue {
  /** Run now, or remember to run once the in-flight refresh settles. */
  run: () => Promise<void>;
  /** Abandon any queued run and refuse further ones. */
  dispose: () => void;
}

export function makeRefreshQueue(refresh: () => Promise<void>): RefreshQueue {
  let running = false;
  let pending = false;
  let disposed = false;

  const run = async (): Promise<void> => {
    if (disposed) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      await refresh();
    } catch {
      // A failed refresh must not kill the feed, and must not wedge the queue:
      // the feed is what recovers the board after a transient error.
    } finally {
      running = false;
    }
    // One disposal check, at the top of `run`, re-read after the await — so a
    // queue torn down mid-refresh drops its trailing run instead of firing it
    // against an unmounted board. Repeating the check here would be dead code.
    if (pending) {
      pending = false;
      await run();
    }
  };

  return {
    run,
    dispose: () => { disposed = true; },
  };
}
