/**
 * Owns the console's colour scheme for the whole session.
 *
 * This lives above the router-ish screen switch in App rather than inside the
 * dashboard header, because the attribute has to be maintained on every screen
 * — the sign-in screen, the loading state and the database console all render
 * outside AdminDashboard, and a theme controller mounted next to the toggle
 * would leave those three rendering light on a dark machine.
 *
 * The FIRST paint is handled by the inline script in index.html; this takes
 * over from there and keeps following the OS while the preference is 'system'.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import {
  applyTheme, nextPreference, readStoredPreference, resolveTheme, storePreference,
  type ResolvedTheme, type ThemePreference,
} from '../lib/theme';

interface ThemeValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  );

  // The listener stays attached whatever the preference is, so switching back to
  // 'system' picks up the current OS value immediately instead of waiting for
  // the next OS change.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => { applyTheme(resolved); }, [resolved]);

  const value = useMemo<ThemeValue>(() => ({
    preference,
    resolved,
    cycle: () => setPreference((p) => {
      const next = nextPreference(p);
      storePreference(next);
      return next;
    }),
  }), [preference, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Returns null outside a provider rather than throwing, so a component can be
 * rendered in isolation (tests, the screenshot harness) without the theme
 * plumbing — the caller simply renders nothing.
 */
export function useTheme(): ThemeValue | null {
  return useContext(ThemeContext);
}
