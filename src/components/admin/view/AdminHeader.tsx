/**
 * Console header — PRESENTATION ONLY.
 *
 * Title and live indicator on one side, session controls on the other. Every
 * handler is supplied; this component decides nothing.
 *
 * The role chip is deliberately a STATUS PILL, never a button: the signed-in
 * role comes from `profiles.role` and is not switchable here. Styling it like
 * a control was an invitation to click something that does nothing.
 */
import React from 'react';
import { BarChart3, Languages, Volume2, VolumeX } from 'lucide-react';

import { StatusPill } from '../../../design-system/ui/StatusPill';
import { Text } from '../../../design-system/ui/Text';
import { LiveModeBadge, type LiveMode } from './LiveModeBadge';

export function AdminHeader({
  title,
  subtitle,
  roleLabel,
  roleValue,
  lang,
  onToggleLang,
  soundMuted,
  onToggleSound,
  soundOnLabel,
  soundOffLabel,
  liveMode,
  lastUpdated,
}: {
  title: string;
  subtitle: string;
  roleLabel: string;
  /** Already-composed "Name (role)" string — the shell owns that formatting. */
  roleValue: string;
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  soundMuted: boolean;
  onToggleSound: () => void;
  soundOnLabel: string;
  soundOffLabel: string;
  liveMode: LiveMode;
  lastUpdated: number | null | undefined;
}) {
  return (
    <header className="flex flex-col items-start justify-between gap-3 border-b border-con-line bg-con-surface p-4 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="size-5 shrink-0 text-ember" aria-hidden="true" />
          <Text variant="title" as="h2">{title}</Text>
          <LiveModeBadge mode={liveMode} lastUpdated={lastUpdated} lang={lang} />
        </div>
        <Text variant="caption" tone="tertiary" className="mt-1">{subtitle}</Text>
      </div>

      <div className="flex flex-wrap items-center gap-3 self-end sm:self-auto">
        <button
          type="button"
          onClick={onToggleSound}
          title={soundMuted ? soundOffLabel : soundOnLabel}
          aria-label={soundMuted ? soundOffLabel : soundOnLabel}
          aria-pressed={soundMuted}
          className={[
            'ds-motion inline-flex size-11 items-center justify-center rounded-[var(--radius-ds-md)]',
            'border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
            soundMuted
              ? 'border-danger-line bg-danger-tint text-danger-ds'
              : 'border-mint-line bg-mint-tint text-mint',
          ].join(' ')}
        >
          {soundMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>

        {/* Read-only: the role comes from profiles.role and is not switchable. */}
        <span className="inline-flex items-center gap-2">
          <Text variant="caption" tone="tertiary" as="span">{roleLabel}</Text>
          <StatusPill label={roleValue} tone="info" />
        </span>

        <button
          type="button"
          onClick={onToggleLang}
          aria-label={lang === 'en' ? 'Switch language to Arabic' : 'التبديل إلى اللغة الإنجليزية'}
          className={[
            'ds-motion inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-ds-md)]',
            'border border-con-line bg-con-surface-2 px-3 transition-colors duration-150',
            'hover:bg-app-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2',
          ].join(' ')}
        >
          <Languages className="size-3.5" aria-hidden="true" />
          <Text variant="label" as="span">{lang.toUpperCase()}</Text>
        </button>
      </div>
    </header>
  );
}
