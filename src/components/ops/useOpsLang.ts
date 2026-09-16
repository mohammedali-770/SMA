/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OPS_STRINGS, OpsLang, OpsStringKey, opsT } from './opsStrings';

/**
 * Language state for the operations consoles.
 *
 * Arabic by default and PERSISTED, unlike the admin console's `adminLang`,
 * which is English-first and resets on every reload (`AppContext.tsx`). A
 * cashier should not have to switch language at the start of every shift.
 *
 * ARABIC WAS THE DEFAULT ONLY ON PAPER UNTIL 2026-09-16, AND THIS IS WHERE IT
 * WENT WRONG. Persistence was a mount effect keyed on `lang`, which fires on
 * the FIRST render as well as after a toggle — so it wrote whatever the
 * fallback happened to be. `AuthScreen` passes `'en'`, and every operator
 * reaches the console through it, so simply loading the sign-in page stamped
 * `en` into storage before anybody chose anything. The console then read that
 * back and dutifully rendered English, which is exactly what the owner's
 * screenshot showed.
 *
 * The rule now: PERSIST A CHOICE, NEVER A DEFAULT. Only `toggle` marks the
 * language as chosen, and only a chosen language is written.
 *
 * THE KEY IS VERSIONED BECAUSE THE OLD VALUES CANNOT BE TRUSTED. A stored
 * `sm-ops-lang` is indistinguishable between "this person picked English" and
 * "the bug wrote English", so the old key is abandoned rather than read. The
 * cost is that anyone who genuinely wanted English picks it once more; the
 * alternative is leaving every existing device wrong.
 */
const KEY = 'sm-ops-lang-v2';

function readStored(fallback: OpsLang): OpsLang {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'en' || v === 'ar' ? v : fallback;
  } catch {
    return fallback;
  }
}

export interface OpsLangValue {
  lang: OpsLang;
  isRTL: boolean;
  dir: 'rtl' | 'ltr';
  t: (key: OpsStringKey) => string;
  toggle: () => void;
}

/**
 * @param fallback language to use when nothing has been chosen yet. The ops
 * consoles pass 'ar'; the shared sign-in screen passes 'en' so that adding a
 * language toggle there does not change what existing admins see on first run.
 * Once anyone picks a language it is remembered for both.
 */
export function useOpsLang(fallback: OpsLang = 'ar'): OpsLangValue {
  const [lang, setLang] = useState<OpsLang>(() => readStored(fallback));
  const chosen = useRef(false);

  useEffect(() => {
    if (!chosen.current) return;
    try { window.localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  }, [lang]);

  const toggle = useCallback(() => {
    chosen.current = true;
    setLang((p) => (p === 'ar' ? 'en' : 'ar'));
  }, []);
  const t = useCallback((key: OpsStringKey) => opsT(lang, key), [lang]);

  return useMemo(
    () => ({ lang, isRTL: lang === 'ar', dir: lang === 'ar' ? 'rtl' : 'ltr', t, toggle }),
    [lang, t, toggle],
  );
}

export { OPS_STRINGS };
export type { OpsLang, OpsStringKey };
