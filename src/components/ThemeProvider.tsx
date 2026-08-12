/** Owns the admin console's System / Light / Dark appearance preference. */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import {
  applyTheme,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '../lib/theme';

interface ThemeValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  cycle: () => void;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => { applyTheme(resolved); }, [resolved]);

  const setPreference = (next: ThemePreference) => {
    storePreference(next);
    setPreferenceState(next);
  };

  const value = useMemo<ThemeValue>(() => ({
    preference,
    resolved,
    setPreference,
    cycle: () => setPreference(nextPreference(preference)),
  }), [preference, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeValue | null {
  return useContext(ThemeContext);
}
