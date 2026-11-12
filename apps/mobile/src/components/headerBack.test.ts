import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HOME_ROUTE } from '../features/auth/returnPath';
import { resolveBack } from './headerBack';

describe('resolveBack', () => {
  it('a screen’s own onBack always wins', () => {
    expect(resolveBack({ hasOnBack: true, canGoBack: true })).toBe('custom');
    expect(resolveBack({ hasOnBack: true, canGoBack: false })).toBe('custom');
  });

  it('goes back when there is somewhere to go', () => {
    expect(resolveBack({ hasOnBack: false, canGoBack: true })).toBe('back');
  });

  it('goes home on a direct load or refresh, instead of doing nothing', () => {
    expect(resolveBack({ hasOnBack: false, canGoBack: false })).toBe('home');
  });
});

describe('wiring', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const header = strip(readFileSync(resolve(__dirname, 'Header.tsx'), 'utf8'));

  it('Header acts on every outcome, home included', () => {
    expect(header).toContain('resolveBack({ hasOnBack: Boolean(onBack), canGoBack: router.canGoBack() })');
    expect(header).toContain("if (action === 'custom') onBack?.();");
    expect(header).toContain("else if (action === 'back') router.back();");
    expect(header).toContain('else router.dismissTo(HOME_ROUTE);');
    expect(header).not.toMatch(/router\.replace\(/);
  });

  it('uses the same home route as the login screen’s fallback', () => {
    expect(HOME_ROUTE).toBe('/(tabs)');
    const login = strip(readFileSync(resolve(__dirname, '../features/auth/LoginScreen.tsx'), 'utf8'));
    expect(login).toContain('HOME_ROUTE');
    expect(header).toContain("import { HOME_ROUTE } from '../features/auth/returnPath';");
  });
});
