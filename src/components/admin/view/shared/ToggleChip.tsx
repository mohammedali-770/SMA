/**
 * An on/off switch that reads as a state, not just as a button.
 *
 * The console is full of these — delivery on, pickup on, branch open, product
 * available — and an operator scanning a row needs to know the CURRENT state
 * before they know it is pressable. So the label always carries the state in
 * words, and `aria-pressed` says the same thing to a screen reader.
 *
 * Mint when on, neutral when off. Never ember: ember is reserved for the one
 * primary action on a surface, and a row of six ember chips would say
 * everything is the important thing.
 */
import React from 'react';

import { Text } from '../../../../design-system/ui/Text';

export function ToggleChip({
  on,
  label,
  onLabel = 'ON',
  offLabel = 'OFF',
  disabled,
  onToggle,
  className = '',
}: {
  on: boolean;
  label: string;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      // Guard the handler as well as the attribute, mirroring Button and Field:
      // `disabled` is removable in devtools and does not stop a synthetic click.
      onClick={() => { if (!disabled) onToggle(); }}
      className={[
        'ds-motion inline-flex min-h-9 w-full items-center justify-center rounded-[var(--radius-ds-md)] border px-2',
        'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        on ? 'border-mint-line bg-mint-tint' : 'border-con-line bg-con-surface-2',
        className,
      ].filter(Boolean).join(' ')}
    >
      <Text variant="caption" tone={on ? 'success' : 'tertiary'} as="span">
        {label} {on ? onLabel : offLabel}
      </Text>
    </button>
  );
}
