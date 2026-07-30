/**
 * The LEGACY mobile Button now derives its rules from the shared
 * `buttonState` module instead of restating them, and guards `onPress`.
 *
 * These tests pin the two properties that matter:
 *   1. the resolved state is IDENTICAL to what the old inline logic produced,
 *      so all 42 legacy call sites are pixel- and behaviour-unchanged;
 *   2. a disabled or loading button cannot execute, including via a direct
 *      handler call — the double-submit vector on payment-retry and
 *      place-order.
 *
 * Framework-free on purpose: vitest.config.ts runs mobile tests under Node and
 * forbids React Native imports here, so this exercises the shared module the
 * component delegates to rather than rendering the component.
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveButtonState, shouldInvokePress } from '../design-system/generated/buttonState';

/** What apps/mobile/src/components/Button.tsx computed BEFORE this change. */
function legacyRules(disabled?: boolean, loading?: boolean) {
  const isDisabled = disabled || loading;
  return {
    isDisabled: !!isDisabled,
    a11y: { disabled: !!isDisabled, busy: !!loading },
    pressFeedback: !isDisabled,
  };
}

const CASES: Array<[string, boolean | undefined, boolean | undefined]> = [
  ['idle', undefined, undefined],
  ['disabled', true, undefined],
  ['loading', undefined, true],
  ['disabled + loading', true, true],
  ['explicitly not disabled', false, false],
];

describe('legacy Button — behaviour is unchanged by the consolidation', () => {
  it.each(CASES)('%s resolves exactly as the old inline logic did', (_name, disabled, loading) => {
    const legacy = legacyRules(disabled, loading);
    const state = resolveButtonState({ disabled, loading });

    // `isDisabled` drives the grey background and the muted label colour, so
    // this equality is what guarantees the 42 call sites look identical.
    expect(state.inert).toBe(legacy.isDisabled);
    expect(state.accessibility.disabled).toBe(legacy.a11y.disabled);
    expect(state.accessibility.busy).toBe(legacy.a11y.busy);
    expect(state.allowPressFeedback).toBe(legacy.pressFeedback);
  });
});

describe('disabled and loading controls cannot execute', () => {
  /** Mirrors the component's guarded handler. */
  const guarded = (onPress: () => void, opts: { disabled?: boolean; loading?: boolean }) => {
    const state = resolveButtonState(opts);
    return () => {
      if (shouldInvokePress(state)) onPress();
    };
  };

  it('a loading button does not fire — even called directly', () => {
    const onPress = vi.fn();
    const handler = guarded(onPress, { loading: true });
    handler();
    handler();
    handler();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a disabled button does not fire — even called directly', () => {
    const onPress = vi.fn();
    guarded(onPress, { disabled: true })();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('an idle button fires exactly once per invocation', () => {
    const onPress = vi.fn();
    const handler = guarded(onPress, {});
    handler();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('repeated presses while loading cannot double-submit', () => {
    // The payment-retry scenario: user taps, request is in flight, user taps
    // again. Before the guard, only Pressable's `disabled` prop stood in the way.
    const submit = vi.fn();
    let loading = false;
    const press = () => {
      const state = resolveButtonState({ loading });
      if (shouldInvokePress(state)) {
        loading = true;
        submit();
      }
    };
    press();
    press();
    press();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
