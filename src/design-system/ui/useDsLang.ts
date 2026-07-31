/**
 * The active console language, read DEFENSIVELY.
 *
 * Design-system primitives must render anywhere: inside the app, in a unit
 * test, in isolation. `useApp()` throws without a provider — correct for
 * application code, wrong for a primitive — so this reads the context directly
 * and falls back to English rather than crashing.
 *
 * Why it exists at all: `Button` and `Field` hardcoded `font-ds-en`, so every
 * Arabic label inside them fell through to a system font instead of IBM Plex
 * Sans Arabic. The font must follow the ACTIVE LANGUAGE, not the string's
 * content — content sniffing gets mixed strings wrong and produces a different
 * face per label.
 */
import { useContext } from 'react';

import { AppContext } from '../../context/AppContext';

export type DsLang = 'en' | 'ar';

/** The console language, or 'en' when rendered outside a provider. */
export function useDsLang(): DsLang {
  return useContext(AppContext)?.adminLang ?? 'en';
}

/**
 * Tailwind family class for the active language.
 * `numeric` wins: structured numbers are mono in both languages.
 */
export function useDsFontClass(numeric?: boolean): string {
  const lang = useDsLang();
  if (numeric) return 'font-ds-num';
  return lang === 'ar' ? 'font-ds-ar' : 'font-ds-en';
}
