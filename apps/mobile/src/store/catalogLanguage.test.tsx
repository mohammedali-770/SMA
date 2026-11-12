// @vitest-environment jsdom
//
// Changing the language must not reload the menu.
//
// WHAT WENT WRONG. CatalogProvider's load effect listed the translation function
// among its dependencies, only so that a failed load could be put into words.
// The translation function changes whenever the language does, so every switch
// between English and Arabic threw the whole menu back to its loading state and
// fetched all twelve catalog reads again. Seen on production on 2026-11-11 by a
// read-only navigation sweep: six full catalog loads in one visit.
//
// THE CONTRACT. The menu loads once per reload. A failure is reported once, when
// it happens, and its message is translated when it is shown, so it follows the
// language without another load or another report. And only the newest load
// writes: one that settles late (a second "Try Again" tapped while the first is
// still in flight) cannot overwrite the newer result.
//
// Every import with side effects is replaced, so no React Native module loads
// here (vitest.config.ts: mobile tests stay framework-free).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Two copies of React are installed: the app's (apps/mobile/node_modules) and
// the root's, which @testing-library/react renders with. Hooks only work when
// the component and the renderer share one copy, so the app's `react` is pointed
// at the root's for this file.
const ROOT_REACT = vi.hoisted(
  () => new URL('../../../../node_modules/react/index.js', import.meta.url).pathname,
);
vi.mock('react', async () => vi.importActual(ROOT_REACT));

const i18n = vi.hoisted(() => ({ lang: 'en' as 'en' | 'ar' }));
// One function per language, the way the real provider hands out a new `t` when
// the language changes and the same `t` while it does not.
const translators = vi.hoisted(() => ({
  en: (key: string) => `en:${key}`,
  ar: (key: string) => `ar:${key}`,
}));
const api = vi.hoisted(() => ({ all: vi.fn() }));
const reports = vi.hoisted(() => ({ count: 0 }));

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ t: translators[i18n.lang] }) }));
vi.mock('../services/api', () => ({ catalog: { all: api.all } }));
// Both entry points are counted, so the test reads the same before and after the
// fix: the provider has used either one.
vi.mock('../lib/errors/reportFailure', () => ({
  reportFailure: () => {
    reports.count += 1;
    return { kind: 'network', messageKey: 'errorNetwork', technical: '', eventId: null };
  },
  failureMessage: (_err: unknown, t: (key: string) => string) => {
    reports.count += 1;
    return t('errorNetwork');
  },
}));

import { CatalogProvider, useCatalog } from './CatalogProvider';

const EMPTY_CATALOG = {
  branches: [],
  categories: [],
  products: [],
  links: [],
  productVariants: [],
  modifierGroups: [],
  modifiers: [],
  availability: [],
  modifierAvailability: [],
  variantAvailability: [],
  settings: {},
  deliveryZones: [],
};

const category = (id: string) => ({ id, name_en: id, name_ar: id, sort_order: 0 });

let reloadMenu: () => void = () => undefined;

function Probe() {
  const { loading, error, reload, categories } = useCatalog();
  reloadMenu = reload;
  return React.createElement(
    'div',
    null,
    React.createElement('span', { 'data-testid': 'probe' }, loading ? 'loading' : (error ?? 'ready')),
    React.createElement('span', { 'data-testid': 'categories' }, categories.map((c) => c.id).join(',')),
  );
}

const tree = () => React.createElement(CatalogProvider, null, React.createElement(Probe));
const shown = () => screen.getByTestId('probe').textContent;

beforeEach(() => {
  i18n.lang = 'en';
  reports.count = 0;
  api.all.mockReset();
});
afterEach(cleanup);

describe('the menu does not reload when the language changes', () => {
  it('loads once, and switching to Arabic and back keeps that one load', async () => {
    api.all.mockResolvedValue(EMPTY_CATALOG);
    const view = render(tree());
    await waitFor(() => expect(shown()).toBe('ready'));
    expect(api.all).toHaveBeenCalledTimes(1);

    i18n.lang = 'ar';
    view.rerender(tree());
    expect(shown()).toBe('ready');
    i18n.lang = 'en';
    view.rerender(tree());
    expect(shown()).toBe('ready');

    // A reload that was going to happen would have started by now.
    await act(async () => undefined);
    expect(api.all).toHaveBeenCalledTimes(1);
  });

  it('a failed load is reported once, and its message follows the language', async () => {
    api.all.mockRejectedValue(new Error('offline'));
    const view = render(tree());
    await waitFor(() => expect(shown()).toBe('en:errorNetwork'));

    i18n.lang = 'ar';
    view.rerender(tree());
    await waitFor(() => expect(shown()).toBe('ar:errorNetwork'));

    await act(async () => undefined);
    expect(api.all).toHaveBeenCalledTimes(1);
    expect(reports.count).toBe(1);
  });

  it('a load that settles after a newer one does not overwrite it', async () => {
    let settleFirst: (value: unknown) => void = () => undefined;
    api.all
      .mockImplementationOnce(() => new Promise((resolve) => (settleFirst = resolve)))
      .mockResolvedValueOnce({ ...EMPTY_CATALOG, categories: [category('newer')] });
    render(tree());
    await waitFor(() => expect(api.all).toHaveBeenCalledTimes(1));

    await act(async () => reloadMenu());
    await waitFor(() => expect(screen.getByTestId('categories').textContent).toBe('newer'));

    // The first, older load answers last.
    await act(async () => settleFirst({ ...EMPTY_CATALOG, categories: [category('older')] }));
    expect(screen.getByTestId('categories').textContent).toBe('newer');
    expect(shown()).toBe('ready');
  });

  it('an explicit reload still loads again', async () => {
    api.all.mockResolvedValue(EMPTY_CATALOG);
    render(tree());
    await waitFor(() => expect(shown()).toBe('ready'));

    await act(async () => reloadMenu());
    await waitFor(() => expect(api.all).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(shown()).toBe('ready'));
  });
});
