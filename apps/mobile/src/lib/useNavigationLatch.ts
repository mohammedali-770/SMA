/**
 * `createNavigationLatch` for a screen: released whenever the screen regains
 * focus, and on unmount.
 *
 * Returns `guardNavigation(fn)`, which runs `fn` only if this press won the
 * latch. Wrap the navigation itself, not the whole handler, so a press that
 * does something else (adding an item without opening a page) is never
 * throttled.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { createNavigationLatch, type NavigationLatch } from './navigationLatch';

export function useNavigationLatch(): (navigate: () => void) => void {
  const latch = useRef<NavigationLatch | null>(null);
  if (latch.current === null) latch.current = createNavigationLatch();

  useFocusEffect(
    useCallback(() => {
      latch.current?.release();
    }, []),
  );
  useEffect(() => () => latch.current?.dispose(), []);

  return useCallback((navigate: () => void) => {
    if (latch.current?.tryAcquire()) navigate();
  }, []);
}
