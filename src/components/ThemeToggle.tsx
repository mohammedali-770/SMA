/**
 * Colour-scheme control for the console header.
 *
 * Cycles System → Light → Dark. "System" is a real, distinct state rather than
 * a hidden default: an operator who has never touched this should track their
 * OS, and one who has pinned a scheme should keep it across sessions. The icon
 * shows what is IN EFFECT and the tooltip names the setting, so 'system'
 * resolving to dark is not mistaken for 'dark'.
 *
 * State lives in ThemeProvider, which sits above every screen — see the note
 * there on why the controller cannot live next to this button.
 */
import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from './ThemeProvider';
import type { ThemePreference } from '../lib/theme';

const LABELS: Record<ThemePreference, { en: string; ar: string }> = {
  system: { en: 'Theme: system', ar: 'المظهر: حسب النظام' },
  light: { en: 'Theme: light', ar: 'المظهر: فاتح' },
  dark: { en: 'Theme: dark', ar: 'المظهر: داكن' },
};

export const ThemeToggle: React.FC<{ lang?: 'en' | 'ar' }> = ({ lang = 'en' }) => {
  const theme = useTheme();
  if (!theme) return null;

  const { preference, resolved, cycle } = theme;
  const Icon = preference === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  const label = LABELS[preference][lang];

  return (
    <button
      type="button"
      onClick={cycle}
      title={label}
      aria-label={label}
      className="w-9 h-9 rounded-full glass-card flex items-center justify-center text-slate-600 hover:text-primary transition-colors"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
};
