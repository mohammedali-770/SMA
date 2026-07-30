import { describe, expect, it } from 'vitest';

import { resolveButtonState, shouldInvokePress } from './generated/buttonState';

/**
 * The rule that matters most here: a LOADING button must not fire. A button
 * that still submits while its spinner is up double-places orders and
 * double-charges cards, and that is exactly the state a slow network produces.
 */
describe('resolveButtonState', () => {
  it('defaults to an enabled primary', () => {
    const s = resolveButtonState();
    expect(s.variant).toBe('primary');
    expect(s.inert).toBe(false);
    expect(s.accessibility).toEqual({ role: 'button', disabled: false, busy: false });
  });

  it('treats loading as inert', () => {
    const s = resolveButtonState({ loading: true });
    expect(s.inert).toBe(true);
    expect(shouldInvokePress(s)).toBe(false);
  });

  it('treats disabled as inert', () => {
    const s = resolveButtonState({ disabled: true });
    expect(s.inert).toBe(true);
    expect(shouldInvokePress(s)).toBe(false);
  });

  it('allows a press only when idle', () => {
    expect(shouldInvokePress(resolveButtonState())).toBe(true);
  });

  it('announces busy while loading, so assistive tech is not silent', () => {
    const s = resolveButtonState({ loading: true });
    expect(s.accessibility.busy).toBe(true);
    expect(s.accessibility.disabled).toBe(true);
    expect(s.showSpinner).toBe(true);
  });

  it('does not announce busy when merely disabled', () => {
    const s = resolveButtonState({ disabled: true });
    expect(s.accessibility.busy).toBe(false);
    expect(s.showSpinner).toBe(false);
  });

  it('keeps a loading button in its live colour, not the muted one', () => {
    // Loading means "working", not "unavailable" — grey would read as broken.
    expect(resolveButtonState({ loading: true }).muted).toBe(false);
    expect(resolveButtonState({ disabled: true }).muted).toBe(true);
  });

  it('mutes a button that is both disabled and loading only via disabled rules', () => {
    const s = resolveButtonState({ disabled: true, loading: true });
    expect(s.inert).toBe(true);
    expect(s.showSpinner).toBe(true);
    expect(s.muted).toBe(false);
  });

  it('suppresses press feedback while inert', () => {
    expect(resolveButtonState({ loading: true }).allowPressFeedback).toBe(false);
    expect(resolveButtonState({ disabled: true }).allowPressFeedback).toBe(false);
    expect(resolveButtonState().allowPressFeedback).toBe(true);
  });

  it('carries the requested variant and size through', () => {
    const s = resolveButtonState({ variant: 'danger', size: 'md' });
    expect(s.variant).toBe('danger');
    expect(s.size).toBe('md');
  });
});
