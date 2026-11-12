import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NAVIGATION_LATCH_TIMEOUT_MS, createNavigationLatch } from './navigationLatch';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createNavigationLatch', () => {
  it('lets the first press through and refuses the second', () => {
    const latch = createNavigationLatch();
    const navigate = vi.fn();
    for (let i = 0; i < 2; i++) if (latch.tryAcquire()) navigate();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(latch.isHeld()).toBe(true);
  });

  it('releases on focus, so a press after coming back works at once', () => {
    const latch = createNavigationLatch();
    expect(latch.tryAcquire()).toBe(true);
    latch.release();
    expect(latch.tryAcquire()).toBe(true);
  });

  it('releases by itself after the safety-net timeout', () => {
    const latch = createNavigationLatch();
    expect(latch.tryAcquire()).toBe(true);
    vi.advanceTimersByTime(NAVIGATION_LATCH_TIMEOUT_MS - 1);
    expect(latch.tryAcquire()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(latch.tryAcquire()).toBe(true);
  });

  it('holds for under a second', () => {
    expect(NAVIGATION_LATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(500);
    expect(NAVIGATION_LATCH_TIMEOUT_MS).toBeLessThanOrEqual(1000);
  });

  it('a release clears the pending timer, and dispose leaves none behind', () => {
    const latch = createNavigationLatch();
    latch.tryAcquire();
    expect(vi.getTimerCount()).toBe(1);
    latch.release();
    expect(vi.getTimerCount()).toBe(0);
    latch.tryAcquire();
    latch.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an early release does not let the old timer cut a later hold short', () => {
    const latch = createNavigationLatch();
    latch.tryAcquire();
    vi.advanceTimersByTime(NAVIGATION_LATCH_TIMEOUT_MS - 100);
    latch.release();
    latch.tryAcquire();
    vi.advanceTimersByTime(200);
    expect(latch.isHeld()).toBe(true);
  });

  it('release when not held is harmless', () => {
    const latch = createNavigationLatch();
    latch.release();
    expect(latch.tryAcquire()).toBe(true);
  });
});

describe('wiring — the measured double-press offenders are latched', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = (rel: string) => strip(readFileSync(resolve(__dirname, '..', rel), 'utf8'));

  it('the hook releases on focus and on unmount', () => {
    const hook = code('lib/useNavigationLatch.ts');
    expect(hook).toMatch(/useFocusEffect\(\s*useCallback\(\(\) => \{\s*latch\.current\?\.release\(\);/);
    expect(hook).toContain('useEffect(() => () => latch.current?.dispose(), []);');
    expect(hook).toContain('if (latch.current?.tryAcquire()) navigate();');
  });

  it('SignInPrompt: Sign in', () => {
    const src = code('features/auth/SignInPrompt.tsx');
    expect(src).toContain('onPress={() => guardNavigation(() => router.push(loginHref(returnTo)))}');
    expect(src).not.toMatch(/onPress=\{\(\) => router\.push/);
  });

  it('LoginScreen: Not now', () => {
    const src = code('features/auth/LoginScreen.tsx');
    expect(src).toMatch(
      /const keepBrowsing = \(\) =>\s*guardNavigation\(\(\) => \(router\.canGoBack\(\) \? router\.back\(\) : router\.replace\(HOME_ROUTE\)\)\);/,
    );
  });

  it('HomeMenuScreen: Choose, Change and the cart bar, but not a one-tap Add', () => {
    const src = code('features/menu/HomeMenuScreen.tsx');
    expect(src).toContain('if (needsChoice) guardNavigation(() => router.push(`/product/${product.id}`));');
    expect(src).toContain('else addItem(product, {}, 1);');
    expect(src).toContain("onPress={() => guardNavigation(() => router.push('/select'))}");
    expect(src).toContain("onPress={() => guardNavigation(() => router.push('/cart'))}");
    expect(src).not.toMatch(/onPress=\{\(\) => router\.push\('\/(select|cart)'\)\}/);
  });

  it('the design-system Button is not where the guard lives', () => {
    expect(code('design-system/ui/Button.tsx')).not.toMatch(/NavigationLatch|guardNavigation/);
  });
});
