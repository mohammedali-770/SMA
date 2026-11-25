// @vitest-environment jsdom
/**
 * Settings -> Brand: no control that saves nothing (F-X20-001).
 *
 * The tab used to show eight more editable fields (logo URL, "Prices Include
 * VAT", support phone, WhatsApp hotline, privacy policy and terms in both
 * languages). `brandPatchToDb` has no column for any of them, so each edit lived
 * in React state until the next load, then reverted to bundled placeholder text,
 * and nothing on screen said so. The tab now carries only what persists, says
 * so, and points to the screens that own the rest.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));
vi.mock('../../lib/loyaltyCampaignsApi', () => ({
  loyaltyCampaigns: { list: async () => [] },
}));

import { SettingsPanel } from './SettingsPanel';

const updateBrandSettings = vi.fn();

function mockContext(lang: 'en' | 'ar') {
  useApp.mockReturnValue({
    brandSettings: {
      primaryColor: '#422e87',
      secondaryColor: '#e02d3d',
      vatPercentage: 15,
      instagram: '',
      twitter: '',
    },
    updateBrandSettings,
    loyaltySettings: {},
    updateLoyaltySettings: vi.fn(),
    profiles: [],
    updateCustomerPoints: vi.fn(),
    loyaltyMutationsEnabled: false,
    currentUser: { id: 'u1', role: 'admin' },
    adminLang: lang,
    paymentSettings: { onlineEnabled: false, cashEnabled: true, defaultMethod: null, outageMode: false },
    updatePaymentSettings: vi.fn(),
    writeError: null,
    integrationSettings: [],
  });
}

afterEach(cleanup);
beforeEach(() => updateBrandSettings.mockReset());

describe('Settings -> Brand tab', () => {
  it.each([
    'Logo Image URL',
    'Prices Include VAT',
    'Support Phone',
    'WhatsApp Hotline',
    'Privacy Policy (EN)',
    'Terms & Conditions (EN)',
  ])('no longer shows the unsaved field "%s"', (label) => {
    mockContext('en');
    render(<SettingsPanel />);
    expect(screen.queryByText(label)).toBeNull();
  });

  it('keeps exactly the fields that save: two colours (picker + hex each) and the VAT rate', () => {
    mockContext('en');
    render(<SettingsPanel />);
    expect(screen.getByText('Primary Color Theme')).toBeTruthy();
    expect(screen.getByText('Secondary Color Theme')).toBeTruthy();
    expect(screen.getAllByText('VAT Percentage').length).toBeGreaterThan(0);
    // No textarea survives: all four were legal text.
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('says what saves and where the rest lives, in English', () => {
    mockContext('en');
    render(<SettingsPanel />);
    expect(screen.getByText('Only the two colours and the VAT rate are saved on this tab')).toBeTruthy();
    expect(screen.getByText(/Legal Documents screen/)).toBeTruthy();
    expect(screen.getByText(/All prices include VAT/)).toBeTruthy();
  });

  it('says it in Arabic too, with no English left in the notice', () => {
    mockContext('ar');
    render(<SettingsPanel />);
    expect(screen.getByText('يُحفظ في هذا التبويب اللونان ونسبة الضريبة فقط')).toBeTruthy();
    expect(screen.queryByText('Only the two colours and the VAT rate are saved on this tab')).toBeNull();
  });

  it('the pointer opens the Support & Contact sub-tab', () => {
    mockContext('en');
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Support & Contact' }));
    // The brand notice is gone and the real support settings are showing.
    expect(screen.queryByText('Only the two colours and the VAT rate are saved on this tab')).toBeNull();
  });
});
