import { describe, expect, it } from 'vitest';

import { nextPreference, parsePreference, resolveTheme } from './theme';

describe('theme preference', () => {
  it('falls back to system for anything unrecognised', () => {
    expect(parsePreference(null)).toBe('system');
    expect(parsePreference('')).toBe('system');
    expect(parsePreference('DARK')).toBe('system');
    expect(parsePreference(42)).toBe('system');
  });

  it('keeps the three real values', () => {
    expect(parsePreference('system')).toBe('system');
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference('dark')).toBe('dark');
  });

  it('resolves system against the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores the OS once a scheme is pinned', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('cycles system → light → dark → system', () => {
    expect(nextPreference('system')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('system');
  });
});
