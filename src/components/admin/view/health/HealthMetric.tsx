/**
 * One labelled figure inside a health card — PRESENTATION ONLY.
 *
 * Values render mono. Every one of these is a count, a timestamp or an
 * identifier, and a grid of them is scanned vertically rather than read.
 */
import React from 'react';

import { Text } from '../../../../design-system/ui/Text';

export function HealthMetric({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-ds-sm)] border border-con-line bg-con-surface-2 px-2 py-1.5">
      <Text variant="caption" tone="tertiary" as="p">{label}</Text>
      <Text variant="label" numeric as="p" className="break-words">{value}</Text>
    </div>
  );
}
