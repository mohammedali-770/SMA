/**
 * Reads the one-shot first-run flags once per mount.
 *
 * `ready` exists so callers can hold navigation until the answer is known —
 * redirecting on a default would flash onboarding at returning customers on
 * every cold start.
 */
import { useEffect, useState } from 'react';

import { DEFAULT_FIRST_RUN, type FirstRunState } from './firstRun';
import { readFirstRun } from './firstRunStore';

export function useFirstRun(): { state: FirstRunState; ready: boolean } {
  const [state, setState] = useState<FirstRunState>(DEFAULT_FIRST_RUN);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void readFirstRun().then((s) => {
      if (!alive) return;
      setState(s);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  return { state, ready };
}
