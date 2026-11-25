// @vitest-environment jsdom
/**
 * Saving a legal document is live for every customer at once, and
 * `legal_documents` keeps no earlier text (audit F-WAD-04-002). So Save asks
 * first, blank text is refused, and switching a policy off is its own prompt.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock('../../lib/api', () => ({ legalDocs: api }));

import { LegalDocumentsPanel } from './LegalDocumentsPanel';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', document_type: 'privacy', title_en: 'Privacy Policy', title_ar: 'سياسة الخصوصية',
  content_en: 'We keep little.', content_ar: 'نحتفظ بالقليل.', version: '1.0', effective_date: null,
  is_active: true, requires_acceptance: false, created_at: '', updated_at: 't1', updated_by: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([doc()]);
  api.update.mockResolvedValue(undefined);
  useApp.mockReturnValue({ currentUser: { role: 'admin' }, adminLang: 'en' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const saveButton = () => screen.getByRole('button', { name: /Save Changes/ }) as HTMLButtonElement;
async function edit(field: RegExp, value: string) {
  const input = (await screen.findByLabelText(field)) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.change(input, { target: { value } });
}

describe('Save', () => {
  it('asks first, says the text is live for every customer, and a decline writes nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LegalDocumentsPanel />);
    await edit(/^Version/i, '1.1');
    fireEvent.click(saveButton());

    expect(confirm).toHaveBeenCalledTimes(1);
    const text = String(confirm.mock.calls[0][0]);
    expect(text).toMatch(/Save changes to “Privacy Policy”\?/);
    expect(text).toMatch(/live for every customer immediately/);
    expect(text).toMatch(/previous text is not kept/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('accepting writes the row', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LegalDocumentsPanel />);
    await edit(/^Version/i, '1.1');
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0][1]).toMatchObject({ version: '1.1', is_active: true });
  });

  it('asks in Arabic when the console is Arabic', async () => {
    useApp.mockReturnValue({ currentUser: { role: 'admin' }, adminLang: 'ar' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LegalDocumentsPanel />);
    await edit(/الإصدار/, '1.1');
    fireEvent.click(screen.getByRole('button', { name: /حفظ التغييرات/ }));
    expect(String(confirm.mock.calls[0][0])).toMatch(/حفظ التغييرات على «سياسة الخصوصية»؟/);
  });
});

describe('blank text', () => {
  it.each([
    ['English title', /Title \(EN\)/],
    ['English content', /Content \(EN\)/],
  ])('is refused without a prompt or a write: %s', async (_n, label) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LegalDocumentsPanel />);
    await edit(label, '   ');
    fireEvent.click(saveButton());

    expect(await screen.findByText(/required in both languages/i)).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });
});

describe('switching a policy off', () => {
  it('is its own prompt, ahead of the save prompt, and declining it writes nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LegalDocumentsPanel />);
    const status = (await screen.findByDisplayValue('Active')) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'false' } });
    fireEvent.click(saveButton());

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toMatch(/Switch “Privacy Policy” OFF\? It is removed from the app for every customer immediately/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('needs BOTH prompts accepted to write', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LegalDocumentsPanel />);
    const status = (await screen.findByDisplayValue('Active')) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'false' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.update.mock.calls[0][1]).toMatchObject({ is_active: false });
  });

  it('switching an INACTIVE policy on is not a deactivation prompt', async () => {
    api.list.mockResolvedValue([doc({ is_active: false })]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LegalDocumentsPanel />);
    const status = (await screen.findByDisplayValue('Inactive')) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'true' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).not.toMatch(/OFF/);
  });
});
