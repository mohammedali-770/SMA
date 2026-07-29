/**
 * Colour-scheme state for the app.
 *
 * Three settings, not two: 'system' follows the device and is the default, so a
 * phone on its evening schedule dims the app without anyone configuring
 * anything. 'light' and 'dark' pin it, and the choice is persisted so it
 * survives a relaunch.
 *
 * Screens do not read this directly. They declare their styles once through
 * `makeStyles`, which resolves the active palette — see makeStyles.ts for why
 * that indirection exists at all (StyleSheet.create captures colours at module
 * evaluation, so a static stylesheet can never change theme).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type Palette } from './index';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sm.theme';

/** Narrow an unknown stored value; anything unrecognised falls back to system. */
export function parsePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** What a preference actually renders as, given the device setting. */
export function resolveTheme(pref: ThemePreference, deviceDark: boolean): ResolvedTheme {
  return pref === 'system' ? (deviceDark ? 'dark' : 'light') : pref;
}

interface ThemeValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  colors: Palette;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const device = useColorScheme();
  const [preference, setPref] = useState<ThemePreference>('system');

  // Hydrate the stored preference. Until it lands the app renders 'system',
  // which is the right guess and matches what the OS is already showing — so a
  // dark-mode device never flashes a light frame while storage is read.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => { if (alive) setPref(parsePreference(v)); })
      .catch(() => { /* storage unavailable — 'system' is a safe default */ });
    return () => { alive = false; };
  }, []);

  const setPreference = (pref: ThemePreference) => {
    setPref(pref);
    // Fire-and-forget: a failed write must not block the visual change.
    void AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
  };

  const resolved = resolveTheme(preference, device === 'dark');

  const value = useMemo<ThemeValue>(() => ({
    preference,
    resolved,
    colors: resolved === 'dark' ? darkColors : lightColors,
    setPreference,
  }), [preference, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The full theme value. Returns a light-mode default outside a provider rather
 * than throwing, so a component can be rendered in isolation (unit tests, the
 * dev preview harness) without the theme plumbing.
 */
export function useTheme(): ThemeValue {
  return useContext(ThemeContext) ?? {
    preference: 'system',
    resolved: 'light',
    colors: lightColors,
    setPreference: () => {},
  };
}

/** Just the active palette — what a screen needs for inline colour props. */
export function useThemeColors(): Palette {
  return useTheme().colors;
}
