/**
 * A numeric admin input that persists on COMMIT, not on keystroke.
 *
 * The fields this replaces wrote straight through to the database from
 * `onChange`, coercing every unparseable value to `0` (see
 * `src/lib/numericField.ts` for the full account). This component keeps the
 * half-typed value local and calls `onCommit` only on blur or Enter, and only
 * when the value actually parses and is in range. An invalid entry is reverted
 * to the stored value rather than written.
 */
import React, { useEffect, useRef, useState } from 'react';

import { numericFieldDisplay, parseNumericCommit, type NumericCommitOptions } from '../../../lib/numericField';
import { Text } from '../../../design-system/ui/Text';

interface Props extends NumericCommitOptions {
  label: string;
  value: number | null | undefined;
  /** Called ONLY with a validated value. Never called for a rejected entry. */
  onCommit: (value: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Rendered after the input — e.g. a currency or unit hint. */
  suffix?: string;
}

export const NumericCommitField: React.FC<Props> = ({
  label, value, onCommit, disabled, placeholder, className, suffix,
  min = 0, max, allowEmpty = false, integer = false,
}) => {
  const [draft, setDraft] = useState<string>(() => numericFieldDisplay(value));
  const [rejected, setRejected] = useState(false);
  const focused = useRef(false);
  /**
   * The draft string we last resolved. Enter commits directly rather than
   * relying on a programmatic blur (which does not fire if the field was never
   * focused), so Enter-then-blur would otherwise commit the same edit twice —
   * and a double write of a delivery fee is exactly what this component exists
   * to prevent. Comparing against the resolved draft makes commit idempotent.
   */
  const settled = useRef<string>(numericFieldDisplay(value));

  // Re-sync from the server value, but never while the operator is typing —
  // a realtime refresh mid-edit would otherwise wipe the entry.
  useEffect(() => {
    if (!focused.current) {
      const next = numericFieldDisplay(value);
      setDraft(next);
      settled.current = next;
    }
  }, [value]);

  const commit = () => {
    if (draft === settled.current) return; // nothing new to resolve
    const result = parseNumericCommit(draft, { min, max, allowEmpty, integer });
    if (!result.ok) {
      // Reject: restore what is actually stored. Crucially NOT a write of 0.
      const restored = numericFieldDisplay(value);
      setDraft(restored);
      settled.current = restored;
      setRejected(true);
      return;
    }
    setRejected(false);
    settled.current = numericFieldDisplay(result.value);
    const current = value === undefined ? null : value;
    if (result.value !== current) onCommit(result.value);
  };

  return (
    <div className={`flex items-center justify-between gap-2 ${className ?? ''}`}>
      <Text variant="caption" tone="secondary" as="span">{label}</Text>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          disabled={disabled}
          value={draft}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={rejected || undefined}
          onFocus={() => { focused.current = true; }}
          onChange={(e) => { setDraft(e.target.value); if (rejected) setRejected(false); }}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') {
              const restored = numericFieldDisplay(value);
              setDraft(restored);
              settled.current = restored;
              setRejected(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={`ds-motion min-h-9 w-24 rounded-[var(--radius-ds-sm)] border bg-con-surface px-2 text-right text-[13px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${
            rejected ? 'border-danger' : 'border-con-line'
          }`}
        />
        {suffix ? <Text variant="caption" tone="tertiary" as="span">{suffix}</Text> : null}
      </div>
    </div>
  );
};
