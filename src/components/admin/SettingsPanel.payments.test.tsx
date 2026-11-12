// @vitest-environment jsdom
/**
 * Settings → Payment Methods: the Online Payment switch and its caption.
 *
 * Online payment may be switched ON only while the payment integration is
 * enabled, names Moyasar and is in live mode. payment-initiate refuses every
 * customer checkout in TEST mode, so switching it on earlier offers customers a
 * method that is then refused at the payment step. Switching it OFF is always
 * allowed. The caption names Moyasar and must stay true while online payment is
 * off.
 *
 * The app context and the loyalty-campaign read are mocked: no Supabase.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbIntegrationSetting } from '../../lib/api';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

vi.mock('../../lib/loyaltyCampaignsApi', () => ({
  loyaltyCampaigns: { list: async () => [] },
}));

import { SettingsPanel } from './SettingsPanel';

const NOTE = 'Switch Moyasar to live mode and enable it first — customer checkout is refused in test mode.';
const NOTE_AR = 'فعّل Moyasar وحوّله إلى الوضع المباشر أولاً — يُرفض دفع العملاء في الوضع التجريبي.';

function paymentRow(over: Partial<DbIntegrationSetting> = {}): DbIntegrationSetting {
  return {
    provider_type: 'payment',
    provider_name: 'moyasar',
    enabled: true,
    public_config: { mode: 'live' },
    has_secret: true,
    updated_at: '2026-11-11T10:55:54.000Z',
    ...over,
  };
}

const updatePaymentSettings = vi.fn();

// One object per state, as in the app, where it changes identity only on a
// reload or a save. A fresh object per render would re-fire the panel's resync
// effect and silently discard the draft.
const PAYMENT_SETTINGS = {
  off: { onlineEnabled: false, cashEnabled: true, defaultMethod: null, outageMode: false },
  on: { onlineEnabled: true, cashEnabled: true, defaultMethod: null, outageMode: false },
};

function mockContext({
  row = paymentRow(),
  onlineEnabled = false,
  role = 'admin',
  lang = 'en',
}: {
  row?: DbIntegrationSetting | null;
  onlineEnabled?: boolean;
  role?: string;
  lang?: 'en' | 'ar';
} = {}) {
  useApp.mockReturnValue({
    brandSettings: {},
    updateBrandSettings: vi.fn(),
    loyaltySettings: {},
    updateLoyaltySettings: vi.fn(),
    profiles: [],
    updateCustomerPoints: vi.fn(),
    loyaltyMutationsEnabled: false,
    currentUser: { id: 'u1', role },
    adminLang: lang,
    paymentSettings: onlineEnabled ? PAYMENT_SETTINGS.on : PAYMENT_SETTINGS.off,
    updatePaymentSettings,
    writeError: null,
    integrationSettings: row ? [row] : [],
  });
}

function openPayments() {
  const view = render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: /Payment Methods|طرق الدفع/ }));
  return view;
}

/** The Online Payment <select>: the first one on the payments tab. */
const onlineSelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;

afterEach(cleanup);
beforeEach(() => {
  updatePaymentSettings.mockReset();
  updatePaymentSettings.mockResolvedValue(undefined);
});

describe('the Online Payment caption', () => {
  it('names Moyasar and stays true while online payment is off', () => {
    mockContext({ onlineEnabled: false });
    openPayments();
    expect(
      screen.getByText(
        'Online payment uses Moyasar. An online order is held from the POS until its payment is verified.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No gateway yet/)).toBeNull();
  });

  it('names Moyasar in Arabic too', () => {
    mockContext({ lang: 'ar' });
    openPayments();
    expect(
      screen.getByText(
        'الدفع الإلكتروني عبر Moyasar. لا يُرسل الطلب الإلكتروني إلى الكاشير حتى يتم التحقق من دفعه.',
      ),
    ).toBeTruthy();
  });
});

describe('switching Online Payment ON', () => {
  it('is allowed for an enabled Moyasar gateway in live mode, with no note', async () => {
    mockContext({ row: paymentRow() });
    openPayments();
    expect(onlineSelect().disabled).toBe(false);
    expect(screen.queryByText(NOTE)).toBeNull();

    fireEvent.change(onlineSelect(), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(updatePaymentSettings).toHaveBeenCalledTimes(1));
    expect(updatePaymentSettings.mock.calls[0][0]).toMatchObject({ onlineEnabled: true });
  });

  it.each([
    ['in test mode', paymentRow({ public_config: { mode: 'test' } })],
    ['disabled', paymentRow({ enabled: false })],
    ['for another provider', paymentRow({ provider_name: 'tap' })],
    ['with no payment row', null],
  ])('is refused %s, with the note', (_label, row) => {
    mockContext({ row });
    openPayments();
    expect(onlineSelect().disabled).toBe(true);
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it('says so in Arabic too', () => {
    mockContext({ row: paymentRow({ public_config: { mode: 'test' } }), lang: 'ar' });
    openPayments();
    expect(screen.getByText(NOTE_AR)).toBeTruthy();
  });

  /** A draft made while the gateway was live must not save after it stopped being live. */
  it('is refused at save time if the gateway stops qualifying after the switch was drafted', async () => {
    mockContext({ row: paymentRow() });
    const { rerender } = openPayments();
    fireEvent.change(onlineSelect(), { target: { value: 'true' } });

    mockContext({ row: paymentRow({ public_config: { mode: 'test' } }) });
    rerender(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    expect(await screen.findAllByText(NOTE)).toHaveLength(2);
    expect(updatePaymentSettings).not.toHaveBeenCalled();
  });
});

describe('switching Online Payment OFF', () => {
  it('is always allowed, even while the gateway is in test mode', async () => {
    mockContext({ row: paymentRow({ public_config: { mode: 'test' } }), onlineEnabled: true });
    openPayments();
    expect(onlineSelect().disabled).toBe(false);
    // Already on in test mode: customers are being refused, which the note explains.
    expect(screen.getByText(NOTE)).toBeTruthy();

    fireEvent.change(onlineSelect(), { target: { value: 'false' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(updatePaymentSettings).toHaveBeenCalledTimes(1));
    expect(updatePaymentSettings.mock.calls[0][0]).toMatchObject({ onlineEnabled: false });
  });
});

describe('an accountant', () => {
  it('sees the switch read-only and no note, since the gateway row is not theirs to read', () => {
    mockContext({ row: null, role: 'accountant' });
    openPayments();
    expect(onlineSelect().disabled).toBe(true);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
