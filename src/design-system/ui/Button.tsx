/**
 * Design-system Button (admin console).
 *
 * ADDITIVE: the existing `.glass-btn-*` classes still back every shipped
 * panel. This is the "Ember on Cream" button — red is the only interactive
 * colour. Panels migrate in a follow-up PR.
 *
 * Behaviour comes from the framework-free `buttonState` module, so the mobile
 * and web buttons cannot disagree about what "disabled" or "loading" means.
 */
import React, { useCallback } from 'react';

import {
  resolveButtonState,
  shouldInvokePress,
  type ButtonSize,
  type ButtonVariant,
} from '../generated/buttonState';
import { useDsFontClass } from './useDsLang';

interface Props {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  leading?: React.ReactNode;
  'data-testid'?: string;
}

/** Tailwind classes per variant. Colours resolve to design-system @theme tokens. */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ember text-white border-transparent hover:bg-ember-deep',
  secondary: 'bg-white text-ember border-ember hover:bg-app-surface-2',
  ghost: 'bg-transparent text-con-text border-transparent hover:bg-app-surface-2',
  danger: 'bg-danger-ds text-white border-transparent hover:brightness-95',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 text-[15px]',
  lg: 'min-h-13 px-6 text-base',
};

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="ds-motion inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Button({
  label,
  onClick,
  variant,
  size,
  disabled,
  loading,
  type = 'button',
  className = '',
  leading,
  'data-testid': testId,
}: Props) {
  const state = resolveButtonState({ variant, size, disabled, loading });
  // Follows the ACTIVE language. This used to hardcode the Latin family, so
  // every Arabic label fell through to a system font instead of IBM Plex Sans
  // Arabic. The guard in consolePrimitives.test.ts scans for the literal, which
  // is why this comment describes it rather than naming it.
  const family = useDsFontClass();

  // Guard the handler as well as setting `disabled`: the DOM attribute is
  // trivially removable in devtools and does not stop a programmatic click.
  // `state.inert`, not `state`: resolveButtonState returns a new object every
  // render, so depending on the object never memoises anything.
  const handleClick = useCallback(() => {
    if (shouldInvokePress(state)) onClick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.inert, onClick]);

  return (
    <button
      type={type}
      data-testid={testId}
      onClick={handleClick}
      disabled={state.inert}
      aria-disabled={state.accessibility.disabled}
      aria-busy={state.accessibility.busy}
      className={[
        'ds-motion inline-flex items-center justify-center gap-2 rounded-[var(--radius-ds-md)]',
        `border ${family} font-bold transition-colors duration-150`,
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        SIZE[state.size],
        state.muted
          ? 'bg-disabled-bg text-disabled-fg border-transparent cursor-not-allowed'
          : VARIANT[state.variant],
        state.inert && !state.muted ? 'cursor-progress' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {state.showSpinner ? <Spinner /> : leading}
      <span>{label}</span>
    </button>
  );
}
