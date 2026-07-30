/**
 * CANONICAL SOURCE — Button behaviour, framework-free.
 * Mirrored by `scripts/sync-design-system.mjs`.
 *
 * The visual layer differs per platform (React Native StyleSheet vs Tailwind
 * classes) but the RULES must not. Keeping the decisions here means the
 * disabled/loading/accessibility semantics are unit-tested once, under Node,
 * for both apps — `vitest.config.ts` forbids React Native imports in mobile
 * test files, so this is also the only way to test them at all.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonInput {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
}

export interface ButtonState {
  variant: ButtonVariant;
  size: ButtonSize;
  /** True when the press handler must NOT fire. */
  inert: boolean;
  /** Spinner shown in place of nothing — the label stays for layout stability. */
  showSpinner: boolean;
  /** Renders in the muted disabled treatment. */
  muted: boolean;
  /** Pressed feedback is suppressed while inert. */
  allowPressFeedback: boolean;
  accessibility: {
    role: 'button';
    disabled: boolean;
    busy: boolean;
  };
}

/**
 * A loading button is disabled. This is deliberate and is the single most
 * important rule here: a button that still fires while its spinner is up
 * double-submits orders and double-charges cards.
 */
export function resolveButtonState(input: ButtonInput = {}): ButtonState {
  const variant = input.variant ?? 'primary';
  const size = input.size ?? 'lg';
  const loading = Boolean(input.loading);
  const disabled = Boolean(input.disabled);
  const inert = disabled || loading;

  return {
    variant,
    size,
    inert,
    showSpinner: loading,
    // A loading button keeps its live colour: it is working, not unavailable.
    // Only an explicitly disabled button reads as muted.
    muted: disabled && !loading,
    allowPressFeedback: !inert,
    accessibility: {
      role: 'button',
      disabled: inert,
      busy: loading,
    },
  };
}

/**
 * Guard for the press handler. Components must route every press through this
 * rather than relying on the platform's `disabled` prop alone — on web a
 * `disabled` attribute is easy to defeat, and RN `Pressable` still fires
 * `onPress` if `disabled` is not threaded through correctly.
 */
export function shouldInvokePress(state: ButtonState): boolean {
  return !state.inert;
}
