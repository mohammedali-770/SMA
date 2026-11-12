// @vitest-environment jsdom
/**
 * R07#1: the console's `<html lang>` follows the language on screen.
 *
 * `useOpsLang` covers the sign-in screen, the access notices and the branch and
 * call-centre consoles, and is rendered here for real. `AdminDashboard` needs
 * the whole app context to render, so its effect is pinned at source level with
 * comments stripped.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useOpsLang } from '../components/ops/useOpsLang';
import { applyDocumentLang } from './documentLang';

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = 'en';
  document.documentElement.removeAttribute('dir');
});
afterEach(cleanup);

describe('applyDocumentLang', () => {
  it('defaults to the real document', () => {
    expect(applyDocumentLang('ar')).toBe(true);
    expect(document.documentElement.lang).toBe('ar');
    expect(applyDocumentLang('ar')).toBe(false);
  });

  it('never sets dir', () => {
    applyDocumentLang('ar');
    expect(document.documentElement.hasAttribute('dir')).toBe(false);
  });
});

describe('useOpsLang drives <html lang>', () => {
  it('an Arabic console marks the document Arabic on first render, before any choice', () => {
    renderHook(() => useOpsLang('ar'));
    expect(document.documentElement.lang).toBe('ar');
    // ...and still writes nothing to storage: the document follows the
    // default, storage records only a choice.
    expect(window.localStorage.getItem('sm-ops-lang-v2')).toBeNull();
  });

  it('the sign-in screen follows its toggle', () => {
    const { result } = renderHook(() => useOpsLang('en'));
    expect(document.documentElement.lang).toBe('en');
    act(() => result.current.toggle());
    expect(document.documentElement.lang).toBe('ar');
    act(() => result.current.toggle());
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.hasAttribute('dir')).toBe(false);
  });
});

describe('AdminDashboard wiring', () => {
  const code = strip(readFileSync(join(__dirname, '..', 'components', 'AdminDashboard.tsx'), 'utf8'));
  const ctx = strip(readFileSync(join(__dirname, '..', 'context', 'AppContext.tsx'), 'utf8'));

  it('applies adminLang to the document from an effect keyed on adminLang', () => {
    expect(code).toMatch(/useEffect\(\(\) => \{\s*applyDocumentLang\(adminLang\);\s*\}, \[adminLang\]\)/);
  });

  it('AppContext does not also do it, where it would run under every audience', () => {
    expect(ctx).not.toMatch(/applyDocumentLang|documentElement\.lang/);
  });
});
