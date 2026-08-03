import { useEffect, useState } from 'react';

/**
 * Whether the browser currently believes it has a network connection.
 *
 * Why this exists: with no offline signal, a dropped connection and a broken app
 * look identical. Branch wifi drops during service, and the failure mode is a
 * staff member watching a stale order list, concluding the console is broken,
 * and reloading — which on a dead connection replaces a stale-but-useful screen
 * with a blank one.
 *
 * `navigator.onLine` is a weak signal: true means "the device has a network
 * interface", not "the internet is reachable", so it produces false positives
 * (captive portal, upstream down). It has essentially no false NEGATIVES though
 * — if it reports offline, the connection really is gone. That asymmetry is why
 * this is only ever used to SHOW a warning, never to block an action or to
 * suppress a real error.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Re-read on mount: the events only fire on a TRANSITION, so a console
    // opened while already offline would otherwise never learn about it.
    setOnline(navigator.onLine !== false);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
