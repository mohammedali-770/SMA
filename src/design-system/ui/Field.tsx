/**
 * Design-system Field (admin console): label + control + at most ONE line
 * underneath.
 *
 * Voice rule ("Say less"): no instructional helper text explaining what to
 * type. `resolveFieldState` guarantees an error REPLACES the hint.
 *
 * Direction: layout uses logical properties (ps-/pe-, text-start) so the field
 * mirrors from `dir` on an ancestor. Numeric fields opt into `.num`, which
 * pins the value LTR and isolates it so Arabic copy cannot reorder digits.
 */
import React, { useId, useState } from 'react';

import { resolveFieldState } from '../generated/fieldState';
import { useDsFontClass } from './useDsLang';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  /** Optional stable id; one is generated when omitted. */
  id?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Money, phone, OTP, national short address, POS reference. */
  numeric?: boolean;
  className?: string;
}

export function Field({
  label,
  value,
  onValueChange,
  id,
  hint,
  error,
  required,
  disabled,
  numeric,
  className = '',
  ...inputProps
}: Props) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [focused, setFocused] = useState(false);
  const state = resolveFieldState({ id: fieldId, hint, error, focused, disabled, required });
  // `.num` (not font-ds-num) preserves the existing numeric class, which the
  // stylesheet already binds to --font-ds-num. Prose follows the language.
  const langFamily = useDsFontClass();
  const valueFamily = numeric ? 'num' : langFamily;

  const border =
    state.tone === 'error'
      ? 'border-danger-ds'
      : state.tone === 'focus'
        ? 'border-ember'
        : 'border-con-line';

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* The required asterisk sits OUTSIDE the element `aria-labelledby`
          points at. Inside it, the field's accessible name becomes "Name *"
          and a screen reader announces "Name star" — the required state is
          already carried by the `required` / aria-required attributes. */}
      <label htmlFor={fieldId} className="text-start text-[13px] font-semibold text-con-text-2">
        <span id={state.labelId}>{label}</span>
        {required ? (
          <span className="text-danger-ds" aria-hidden="true">
            {' *'}
          </span>
        ) : null}
      </label>

      <input
        {...inputProps}
        id={fieldId}
        value={value}
        disabled={state.disabled}
        required={state.accessibility.required}
        aria-invalid={state.accessibility.invalid}
        aria-describedby={state.describedById ?? undefined}
        aria-labelledby={state.labelId}
        // Guard as well as setting `disabled`, mirroring Button: the DOM
        // attribute is removable in devtools and does not stop a synthetic or
        // programmatic change event.
        onChange={(e) => {
          if (state.disabled) return;
          onValueChange(e.target.value);
        }}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
        className={[
          'ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border-[1.5px] px-4',
          'bg-white text-con-text transition-colors duration-150',
          'disabled:bg-disabled-bg disabled:text-disabled-fg disabled:cursor-not-allowed',
          // Follows the ACTIVE language; `numeric` still wins, because a
          // structured number is mono in both.
          `${valueFamily} text-start`,
          border,
        ].join(' ')}
      />

      {state.message ? (
        <p
          id={state.describedById ?? undefined}
          // Errors are announced when they appear; a silently-rendered error is
          // invisible to a screen-reader user who has already left the field.
          role={state.messageIsError ? 'alert' : undefined}
          aria-live={state.accessibility.liveRegion === 'polite' ? 'polite' : undefined}
          className={`text-start text-[11.5px] ${
            state.messageIsError ? 'text-danger-ds' : 'text-con-text-3'
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
