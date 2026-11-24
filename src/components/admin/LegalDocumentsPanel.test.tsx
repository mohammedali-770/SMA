// @vitest-environment jsdom
/**
 * F-TAA4-002: `requires_acceptance` has no consumer - the mobile app never
 * selects it and nothing records an acceptance. The console must not present it
 * as if it enforced anything.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));
vi.mock('../../lib/api', () => ({
  legalDocs: {
    list: vi.fn(async () => [
      {
        id: 'd1',
        document_type: 'terms',
        title_en: 'Terms',
        title_ar: 'الشروط',
        content_en: 'x',
        content_ar: 'س',
        version: '1.0',
        effective_date: null,
        is_active: true,
        requires_acceptance: false,
        created_at: '',
        updated_at: 't1',
        updated_by: null,
      },
    ]),
    update: vi.fn(),
  },
}));

import { LegalDocumentsPanel } from './LegalDocumentsPanel';

afterEach(cleanup);

describe('requires-acceptance control', () => {
  it.each([
    ['en', /Requires acceptance \(not enforced yet\)/, /changes nothing/],
    ['ar', /غير مُفعّل بعد/, /لا يغيّر هذا الخيار شيئاً/],
  ])('says in %s that it is not enforced', async (lang, label, caption) => {
    useApp.mockReturnValue({ currentUser: { role: 'admin' }, adminLang: lang });
    render(<LegalDocumentsPanel />);
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByText(caption)).toBeTruthy();
  });
});
