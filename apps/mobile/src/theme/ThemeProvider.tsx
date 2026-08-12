import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { darkPalette, lightPalette, type AppPalette } from './palette';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sm.appearance';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, deviceScheme: 'light' | 'dark' | null | undefined): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return deviceScheme === 'dark' ? 'dark' : 'light';
}

interface ThemeValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  colors: AppPalette;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (alive) setPreferenceState(parseThemePreference(stored));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const resolved = resolveTheme(preference, deviceScheme);
  const colors = resolved === 'dark' ? darkPalette : lightPalette;

  const value = useMemo<ThemeValue>(
    () => ({ preference, resolved, colors, setPreference }),
    [preference, resolved, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    return {
      preference: 'system',
      resolved: 'light',
      colors: lightPalette,
      setPreference: () => {},
    };
  }
  return value;
}

export function useThemeColors(): AppPalette {
  return useTheme().colors;
}
