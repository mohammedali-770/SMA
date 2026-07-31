/**
 * Design-system status pill (admin console) — the mirror of the mobile one.
 *
 * A read-only state pill: order status, sync state, health. NEVER ember —
 * ember is the one interactive colour, so a state can never be mistaken for
 * something you can press. That rule matters more in the console than in the
 * app, because an operations table is mostly states and a few actions, and the
 * eye needs to separate them at a glance.
 *
 * Tones are the same semantic set as `ConfirmationTone` on the customer side,
 * so an order that reads "danger" on the receipt reads "danger" here too.
 */
import React from 'react';

import { Text } from './Text';

export type PillTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

const TONE: Record<PillTone, { box: string; text: 'secondary' | 'success' | 'danger' | 'warning' | 'info' }> = {
  neutral: { box: 'bg-con-surface-2', text: 'secondary' },
  success: { box: 'bg-mint-tint', text: 'success' },
  danger: { box: 'bg-danger-tint', text: 'danger' },
  warning: { box: 'bg-warn-tint', text: 'warning' },
  info: { box: 'bg-info-tint', text: 'info' },
};

export function StatusPill({
  label,
  tone = 'neutral',
  className = '',
}: {
  label: string;
  tone?: PillTone;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className={[
        'inline-flex items-center justify-center rounded-full px-3 py-1',
        t.box,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Text variant="caption" tone={t.text} as="span">{label}</Text>
    </span>
  );
}
