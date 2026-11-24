import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { opsT, type OpsLang } from './ops/opsStrings';
import { useTheme } from './ThemeProvider';

/** `lang` is the language of the surface the toggle sits on (F-X14-001): the
 *  accessible name is spoken, so it follows the console rather than the code. */
export const AppearanceToggle: React.FC<{ lang?: OpsLang }> = ({ lang = 'en' }) => {
  const theme = useTheme();
  if (!theme) return null;

  const label = opsT(
    lang,
    theme.preference === 'system' ? 'appearanceSystem' : theme.preference === 'light' ? 'appearanceLight' : 'appearanceDark',
  );
  const name = opsT(lang, 'appearanceLabel');
  const Icon = theme.preference === 'system' ? Monitor : theme.preference === 'light' ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={theme.cycle}
      aria-label={`${name}: ${label}. ${opsT(lang, 'appearanceHint')}`}
      title={`${name}: ${label}`}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-con-line bg-con-surface px-2.5 py-1.5 text-xs font-bold text-con-text-2 transition-colors hover:border-ember hover:text-ember"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
};
