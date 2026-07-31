/**
 * Design-system surface (admin console).
 *
 * A flat panel on the console ground — no gradient, no glass, no drop shadow.
 * "Ember on Cream" gets its structure from colour boundaries and hairlines
 * rather than elevation, which is also the only thing that renders identically
 * across browsers and at every zoom level.
 *
 * This replaces `.glass-card`, which layered a blur, a translucent fill and a
 * shadow — three effects doing the job one hairline does, and the reason dense
 * admin tables read as soft rather than precise.
 */
import React from 'react';

export type CardTone = 'surface' | 'warning' | 'danger' | 'info' | 'success';

const TONE: Record<CardTone, string> = {
  surface: 'bg-con-surface border-con-line',
  warning: 'bg-warn-tint border-warn-line',
  danger: 'bg-danger-tint border-danger-line',
  info: 'bg-info-tint border-info-line',
  success: 'bg-mint-tint border-mint-line',
};

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  /** Removes the padding for cards that host their own table or list. */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Card({ tone = 'surface', flush, className = '', children, ...rest }: Props) {
  return (
    <div
      {...rest}
      className={[
        'rounded-[var(--radius-ds-lg)] border',
        TONE[tone],
        flush ? '' : 'p-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
