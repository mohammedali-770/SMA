/**
 * Design-system Notice (admin console) — the mirror of the mobile one.
 *
 * The hierarchy is the point: `title` says what happened, `action` says what to
 * do about it, and nothing else competes with them. Keeping those as separate,
 * differently weighted slots is what stops an operator scanning a wall of
 * equally-loud banners and missing the one that matters.
 *
 * A leading bar rather than a full border: it reads as severity without boxing
 * the message in and competing with the card edges around it. `border-s-4` sits
 * on the reading edge, so it mirrors in Arabic.
 */
import React from 'react';

import { Text } from './Text';

export type NoticeTone = 'blocking' | 'warning' | 'info' | 'success';

const TONE: Record<NoticeTone, { box: string; title: 'danger' | 'warning' | 'info' | 'success' }> = {
  blocking: { box: 'bg-danger-tint border-s-danger-ds', title: 'danger' },
  warning: { box: 'bg-warn-tint border-s-warn', title: 'warning' },
  info: { box: 'bg-info-tint border-s-sky', title: 'info' },
  success: { box: 'bg-mint-tint border-s-mint', title: 'success' },
};

interface Props {
  /** The problem or state, in the operator's words. Always required. */
  title: string;
  /** The single next step. Omit when the title is self-evident. */
  action?: string | null;
  tone?: NoticeTone;
  className?: string;
  /** Rendered after the copy — a retry button, a link. */
  children?: React.ReactNode;
}

export function Notice({ title, action, tone = 'blocking', className = '', children }: Props) {
  const t = TONE[tone];
  return (
    <div
      role="alert"
      className={[
        'rounded-[var(--radius-ds-md)] border-s-4 px-3 py-3',
        t.box,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Text variant="heading" tone={t.title} as="p">{title}</Text>
      {action ? <Text variant="body" tone="secondary" as="p">{action}</Text> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
