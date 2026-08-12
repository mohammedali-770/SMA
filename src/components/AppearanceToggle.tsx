import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from './ThemeProvider';

export const AppearanceToggle: React.FC = () => {
  const theme = useTheme();
  if (!theme) return null;

  const label = theme.preference === 'system' ? 'System' : theme.preference === 'light' ? 'Light' : 'Dark';
  const Icon = theme.preference === 'system' ? Monitor : theme.preference === 'light' ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={theme.cycle}
      aria-label={`Appearance: ${label}. Activate to change.`}
      title={`Appearance: ${label}`}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-con-line bg-con-surface px-2.5 py-1.5 text-xs font-bold text-con-text-2 transition-colors hover:border-ember hover:text-ember"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
};
