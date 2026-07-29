/**
 * Console colour scheme.
 *
 * Three settings, not two: 'system' follows the operating system and is the
 * default, so a machine set to dark at 22:00 does not blind whoever is watching
 * the live-orders board. 'light' and 'dark' pin it.
 *
 * The choice is applied by stamping `data-theme` on <html>; every colour in the
 * console resolves from CSS custom properties keyed off that attribute (see
 * src/index.css), so there is no per-component wiring and no flash of the wrong
 * palette once the attribute is set.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sm-admin-theme';

/** Narrow an unknown stored value; anything unrecognised falls back to system. */
export function parsePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** What a preference actually renders as, given the OS setting. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/** The next value in the System → Light → Dark cycle. */
export function nextPreference(pref: ThemePreference): ThemePreference {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

/** Reads the stored preference. Safe in SSR/tests where storage is absent. */
export function readStoredPreference(): ThemePreference {
  try {
    return parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Persists the preference. A storage failure must never break the toggle. */
export function storePreference(pref: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* private browsing / storage disabled — the session still themes correctly */
  }
}

/** Stamps the resolved theme on <html>. Light is the absence of the attribute. */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}
