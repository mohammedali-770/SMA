/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { OPS_STRINGS, OpsLang, OpsStringKey, opsT } from './opsStrings';

/**
 * Language state for the operations consoles.
 *
 * Arabic by default and PERSISTED, unlike the admin console's `adminLang`,
 * which is English-first and resets on every reload (`AppContext.tsx`). A
 * cashier should not have to switch language at the start of every shift.
 */
const KEY = 'sm-ops-lang';

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

  useEffect(() => {
    try { window.localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  }, [lang]);

  const toggle = useCallback(() => setLang((p) => (p === 'ar' ? 'en' : 'ar')), []);
  const t = useCallback((key: OpsStringKey) => opsT(lang, key), [lang]);

  return useMemo(
    () => ({ lang, isRTL: lang === 'ar', dir: lang === 'ar' ? 'rtl' : 'ltr', t, toggle }),
    [lang, t, toggle],
  );
}

export { OPS_STRINGS };
export type { OpsLang, OpsStringKey };
