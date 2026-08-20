/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

export type OpsLiveMode = 'realtime' | 'polling' | 'off';

/** One refetch per this window at most, however fast events arrive. */
export const OPS_BUMP_FLOOR_MS = 3_000;
const FAST_POLL_MS = 12_000;
const SLOW_POLL_MS = 60_000;
const CONNECT_TIMEOUT_MS = 6_000;

/**
 * Refetch-on-change for the operations consoles.
 *
 * Deliberately a near-copy of the admin order feed (`AppContext.tsx`), because
 * every property that effect earned the hard way applies here too:
 *
 *  - It subscribes to the narrow signal table, never the data tables. The
 *    payload is ignored entirely; an event means "something changed, go look".
 *  - Realtime is an enhancement, never a dependency. If the channel has not
 *    connected within six seconds it falls back to a fast poll, and a slow
 *    backstop runs regardless — that one covers a channel that connects but
 *    never delivers, which is what a missing publication looks like from here.
 *  - Refetches are throttled to a floor rather than debounced, so a busy evening
 *    cannot turn into several fetches a second.
 *  - The trailing run is KEPT. An event arriving mid-refresh may describe a
 *    change the in-flight query already passed; dropping it would leave that
 *    change invisible until the backstop.
 *  - Polls skip a hidden tab, and a returning tab catches up immediately.
 */
export function useOpsChangeFeed(
  refresh: () => Promise<void>,
  options: { enabled?: boolean; channelKey?: string } = {},
): OpsLiveMode {
  const { enabled = true, channelKey = 'ops' } = options;
  const [mode, setMode] = useState<OpsLiveMode>('off');
  const modeRef = useRef<OpsLiveMode>('off');
  // Kept in a ref so a changing callback identity cannot tear down the channel.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) { setMode('off'); modeRef.current = 'off'; return; }

    let disposed = false;
    let running = false;
    let bumpT: ReturnType<typeof setTimeout> | null = null;
    let connectT: ReturnType<typeof setTimeout> | null = null;
    let fastPoll: ReturnType<typeof setInterval> | null = null;
    let lastRefreshAt = 0;

    const setLive = (next: OpsLiveMode) => { modeRef.current = next; setMode(next); };

    const doRefresh = async () => {
      if (disposed || running) return;
      running = true;
      try { await refreshRef.current(); } catch { /* a failed refresh must not kill the feed */ }
      finally { running = false; }
    };

    const bump = () => {
      if (bumpT) return;                       // a run is already scheduled
      const wait = Math.max(0, OPS_BUMP_FLOOR_MS - (Date.now() - lastRefreshAt));
      bumpT = setTimeout(() => {
        bumpT = null;
        lastRefreshAt = Date.now();
        void doRefresh();
      }, wait);
    };

    const startFastPoll = () => {
      if (fastPoll) return;
      fastPoll = setInterval(() => { if (!document.hidden) void doRefresh(); }, FAST_POLL_MS);
    };
    const stopFastPoll = () => { if (fastPoll) { clearInterval(fastPoll); fastPoll = null; } };

    const slowPoll = setInterval(() => { if (!document.hidden) void doRefresh(); }, SLOW_POLL_MS);

    const channel = supabase
      .channel(`ops-changes-${channelKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops_change_events' }, () => bump())
      .subscribe((status: string) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          if (connectT) { clearTimeout(connectT); connectT = null; }
          setLive('realtime');
          stopFastPoll();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setLive('polling');
          startFastPoll();
        }
      });

    connectT = setTimeout(() => {
      if (!disposed && modeRef.current !== 'realtime') { setLive('polling'); startFastPoll(); }
    }, CONNECT_TIMEOUT_MS);

    const onVisible = () => { if (!document.hidden && !disposed) void doRefresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (bumpT) clearTimeout(bumpT);
      if (connectT) clearTimeout(connectT);
      if (fastPoll) clearInterval(fastPoll);
      clearInterval(slowPoll);
      void supabase.removeChannel(channel);
    };
  }, [enabled, channelKey]);

  return mode;
}
