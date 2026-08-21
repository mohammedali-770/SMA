/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import { Text } from '../../design-system/ui/Text';

/**
 * A labelled row of single-select chips, sized for a thumb on POS hardware
 * rather than a mouse.
 *
 * Extracted from CloseItemDialog so the delivery-pause dialog renders the same
 * control instead of a second copy of it. Both dialogs ask the same two
 * questions — how long, and why — and they should not be able to drift apart in
 * size, spacing or focus behaviour.
 */
export interface OpsChoice<T> {
  value: T;
  label: string;
}

const chipClass = (selected: boolean) =>
  [
    'ds-motion inline-flex min-h-11 items-center justify-center rounded-[var(--radius-ds-md)]',
    'border px-4 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
    selected ? 'border-ember bg-ember' : 'border-con-line bg-con-surface hover:bg-con-surface-2',
  ].join(' ');

interface OpsChoiceChipsProps<T extends string | number> {
  legend: string;
  options: OpsChoice<T>[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function OpsChoiceChips<T extends string | number>({
  legend,
  options,
  value,
  disabled,
  onChange,
}: OpsChoiceChipsProps<T>) {
  return (
    <div className="space-y-2">
      <Text variant="label" as="p">{legend}</Text>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              // Guard the handler as well as the attribute: `disabled` is
              // removable in devtools and does not stop a synthetic click.
              onClick={() => { if (!disabled) onChange(o.value); }}
              className={chipClass(on)}
            >
              <Text variant="label" tone={on ? 'onEmber' : 'secondary'} as="span">{o.label}</Text>
            </button>
          );
        })}
      </div>
    </div>
  );
}
