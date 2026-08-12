/** Admin-console colour scheme. */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sm-admin-theme';

export function parsePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark ? 'dark' : 'light') : pref;
}

export function nextPreference(pref: ThemePreference): ThemePreference {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

export function readStoredPreference(): ThemePreference {
  try {
    return parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function storePreference(pref: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage can be unavailable; the current session still themes correctly.
  }
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}
