/**
 * One label/value line in the receipt.
 *
 * The receipt is a column of these — payment provider, card, POS state, VAT —
 * and writing the same flex/justify pair at each site is how they drift apart
 * by a pixel and stop scanning as a column.
 */
import React from 'react';

import { Text } from '../../../../design-system/ui/Text';

export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Text variant="caption" tone="tertiary" as="span">{label}</Text>
      {children}
    </div>
  );
}
