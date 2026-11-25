// @vitest-environment jsdom
/**
 * Settings -> Loyalty: the programme switch and the points-expiry switch ask
 * first (audit F-WAD-08-005). Both write on the select's change event and reach
 * every customer: the programme switch gates earning and redeeming, and expiry
 * arms a reset that zeroes every balance on a date.
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

const updateLoyaltySettings = vi.fn();

function mockContext(lang: 'en' | 'ar', over: Record<string, unknown> = {}) {
  useApp.mockReturnValue({
    brandSettings: { primaryColor: '#422e87', secondaryColor: '#e02d3d', vatPercentage: 15, instagram: '', twitter: '' },
    updateBrandSettings: vi.fn(),
    loyaltySettings: {
      isEnabled: true, pointsPerRiyal: 1, minPointsToRedeem: 100, discountPerPoint: 0.1,
      expiryEnabled: false, expiryAnchorMonth: 1, expiryAnchorDay: 1, expiryPeriodMonths: 12,
      expiryNextRunOn: null, pickupOnly: true,
      ...over,
    },
    updateLoyaltySettings,
    profiles: [],
    branches: [],
    products: [],
    categories: [],
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

function openLoyalty(lang: 'en' | 'ar' = 'en') {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: lang === 'en' ? /Loyalty Program/ : /برنامج النقاط والولاء/ }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => updateLoyaltySettings.mockReset());

describe('the rewards programme switch', () => {
  it('turning it OFF asks, says earning and redeeming stop, and a decline writes nothing', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockContext('en');
    openLoyalty();
    fireEvent.change(screen.getByDisplayValue('Yes (Active Campaign)'), { target: { value: 'false' } });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toMatch(/Turn the rewards programme OFF\? Earning and redeeming points stops for every customer immediately/);
    expect(updateLoyaltySettings).not.toHaveBeenCalled();
  });

  it('accepting writes it', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockContext('en');
    openLoyalty();
    fireEvent.change(screen.getByDisplayValue('Yes (Active Campaign)'), { target: { value: 'false' } });
    expect(updateLoyaltySettings).toHaveBeenCalledWith({ isEnabled: false });
  });

  it('turning it ON asks too', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockContext('en', { isEnabled: false });
    openLoyalty();
    fireEvent.change(screen.getByDisplayValue('No (Disable Program)'), { target: { value: 'true' } });
    expect(String(confirm.mock.calls[0][0])).toMatch(/Turn the rewards programme ON/);
    expect(updateLoyaltySettings).not.toHaveBeenCalled();
  });
});

describe('the points-expiry switch', () => {
  it('turning it ON asks, names the zeroing and the notice promise, and a decline writes nothing', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockContext('en');
    openLoyalty();
    fireEvent.change(screen.getByDisplayValue('No (points never expire)'), { target: { value: 'true' } });

    expect(confirm).toHaveBeenCalledTimes(1);
    const text = String(confirm.mock.calls[0][0]);
    expect(text).toMatch(/EVERY customer’s points are set to zero/);
    expect(text).toMatch(/advance notice/);
    expect(updateLoyaltySettings).not.toHaveBeenCalled();
  });

  it('accepting arms it', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockContext('en');
    openLoyalty();
    fireEvent.change(screen.getByDisplayValue('No (points never expire)'), { target: { value: 'true' } });
    expect(updateLoyaltySettings).toHaveBeenCalledWith({ expiryEnabled: true });
  });

  it('turning it OFF is the safe direction and is not prompted', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockContext('en', { expiryEnabled: true, expiryNextRunOn: '2027-01-01' });
    openLoyalty();
    fireEvent.change(screen.getByDisplayValue('Yes (periodic reset)'), { target: { value: 'false' } });
    expect(confirm).not.toHaveBeenCalled();
    expect(updateLoyaltySettings).toHaveBeenCalledWith({ expiryEnabled: false });
  });

  it('asks in Arabic when the console is Arabic', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockContext('ar');
    openLoyalty('ar');
    fireEvent.change(screen.getByDisplayValue('لا (النقاط لا تنتهي)'), { target: { value: 'true' } });
    expect(String(confirm.mock.calls[0][0])).toMatch(/تفعيل انتهاء صلاحية النقاط؟/);
  });
});
