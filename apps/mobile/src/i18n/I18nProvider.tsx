/**
 * Language + direction context. Provides `t(key)` for the active language, a
 * `setLang` toggle (persisted to AsyncStorage), and RTL foundation flags.
 *
 * RTL note: we expose `isRTL` / `dir` so components can align text and rows
 * correctly today. Full native layout mirroring via I18nManager.forceRTL needs
 * an app reload to take effect and is deliberately left as a follow-up so a
 * language toggle never leaves the UI half-mirrored mid-session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { LANGUAGE_STORAGE_KEY as STORAGE_KEY } from '../lib/storageKeys';
import { rtlRow, rtlText } from './rtl';
import { STRINGS, type Lang, type StringKey } from './strings';

interface I18nValue {
  lang: Lang;
  isRTL: boolean;
  dir: 'rtl' | 'ltr';
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: StringKey) => string;
  /** Pick the locale-appropriate field from an EN/AR pair. */
  pick: (en: string, ar: string) => string;
  /** Compose into text styles: aligns to the reading edge (right in Arabic). */
  rtlText: { textAlign: 'left' | 'right' };
  /** Compose into row styles: mirrors the row in Arabic. */
  rtlRow: { flexDirection: 'row' | 'row-reverse' };
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'en' || v === 'ar') setLangState(v);
      })
      .catch(() => {});
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  }, []);

  const value = useMemo<I18nValue>(() => {
    const isRTL = lang === 'ar';
    return {
      lang,
      isRTL,
      dir: isRTL ? 'rtl' : 'ltr',
      setLang,
      toggle: () => setLang(lang === 'en' ? 'ar' : 'en'),
      t: (key: StringKey) => STRINGS[lang][key] ?? STRINGS.en[key] ?? String(key),
      pick: (en: string, ar: string) => (isRTL ? ar : en) || en,
      rtlText: rtlText(isRTL),
      rtlRow: rtlRow(isRTL),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
