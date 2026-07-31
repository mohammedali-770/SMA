/**
 * The live/auto-refresh indicator — PRESENTATION ONLY.
 *
 * Three states, and the distinction between the first two is the point:
 *
 *   realtime  the websocket subscription is up. Mint.
 *   polling   realtime failed or is unavailable and the console is falling
 *             back to timed refreshes. AMBER, not mint — an operator watching
 *             a kitchen screen needs to know the difference between "this is
 *             live" and "this is up to a few seconds stale".
 *   off       nothing renders at all.
 *
 * The timestamp is a structured number, so it renders mono and stays LTR in
 * both languages.
 */
import React from 'react';

import { StatusPill } from '../../../design-system/ui/StatusPill';
import { Text } from '../../../design-system/ui/Text';

export type LiveMode = 'realtime' | 'polling' | 'off' | string;

export function LiveModeBadge({
  mode,
  lastUpdated,
  lang,
}: {
  mode: LiveMode;
  /** Epoch ms of the last successful refresh, when known. */
  lastUpdated: number | null | undefined;
  lang: 'en' | 'ar';
}) {
  if (mode === 'off') return null;

  const isRealtime = mode === 'realtime';
  const label = isRealtime
    ? (lang === 'ar' ? 'مباشر' : 'Live')
    : (lang === 'ar' ? 'تحديث تلقائي' : 'Auto-refreshing');

  const stamp = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : null;

  const title = lastUpdated
    ? `${lang === 'ar' ? 'آخر تحديث' : 'Last updated'} ${new Date(lastUpdated).toLocaleTimeString()}`
    : undefined;

  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <StatusPill label={label} tone={isRealtime ? 'success' : 'warning'} />
      {stamp ? (
        <Text variant="caption" tone="tertiary" numeric as="span">{stamp}</Text>
      ) : null}
    </span>
  );
}
