// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { useOpsLang } from './useOpsLang';

const KEY = 'sm-ops-lang-v2';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('useOpsLang', () => {
  it('is Arabic and RTL on a first-ever visit', () => {
    const { result } = renderHook(() => useOpsLang());
    expect(result.current.lang).toBe('ar');
    expect(result.current.isRTL).toBe(true);
    expect(result.current.dir).toBe('rtl');
  });

  it('writes NOTHING until somebody actually chooses', () => {
    // This is the whole defect. Persisting on mount meant the sign-in screen's
    // 'en' fallback was stamped into storage before anyone touched the toggle,
    // and the console read it back as a preference.
    renderHook(() => useOpsLang('en'));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('the sign-in screen no longer decides the console for the operator', () => {
    // The owner's English branch console, reproduced as a sequence: land on the
    // sign-in screen (English fallback), then open the console (Arabic
    // fallback). The console must be Arabic.
    const auth = renderHook(() => useOpsLang('en'));
    expect(auth.result.current.lang).toBe('en');
    cleanup();

    const console_ = renderHook(() => useOpsLang('ar'));
    expect(console_.result.current.lang).toBe('ar');
  });

  it('remembers a real choice across mounts, in both directions', () => {
    const first = renderHook(() => useOpsLang('ar'));
    act(() => first.result.current.toggle());
    expect(first.result.current.lang).toBe('en');
    expect(window.localStorage.getItem(KEY)).toBe('en');
    cleanup();

    // A cashier who picked English keeps it — the default does not reassert
    // itself at the start of every shift.
    const second = renderHook(() => useOpsLang('ar'));
    expect(second.result.current.lang).toBe('en');
    act(() => second.result.current.toggle());
    expect(window.localStorage.getItem(KEY)).toBe('ar');
  });

  it('ignores the pre-2026-09-16 key, whose values may have been written by the bug', () => {
    window.localStorage.setItem('sm-ops-lang', 'en');
    const { result } = renderHook(() => useOpsLang('ar'));
    expect(result.current.lang).toBe('ar');
  });

  it('falls back rather than trusting a corrupt stored value', () => {
    window.localStorage.setItem(KEY, 'fr');
    const { result } = renderHook(() => useOpsLang('ar'));
    expect(result.current.lang).toBe('ar');
  });

  it('translates through the active language', () => {
    const { result } = renderHook(() => useOpsLang('en'));
    const english = result.current.t('branchConsole');
    act(() => result.current.toggle());
    expect(result.current.t('branchConsole')).not.toBe(english);
  });
});
