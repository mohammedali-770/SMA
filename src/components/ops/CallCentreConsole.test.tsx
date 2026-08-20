// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import type { Branch, Product } from '../../types';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

const ops = vi.hoisted(() => ({
  allAvailability: vi.fn(),
  resumeDelivery: vi.fn(),
  pauseDelivery: vi.fn(),
  disableArea: vi.fn(),
  enableArea: vi.fn(),
}));
vi.mock('../../lib/opsApi', () => ({ opsApi: ops }));

const config = vi.hoisted(() => ({ allAreas: vi.fn(), workingHours: vi.fn() }));
vi.mock('../../lib/branchConfigApi', () => ({ branchConfig: config }));

// The realtime feed owns timers and a websocket; the board's behaviour is what
// is under test, so it is stubbed to a fixed mode.
vi.mock('./useOpsChangeFeed', () => ({ useOpsChangeFeed: () => 'realtime' }));
const beep = vi.hoisted(() => ({ playAlertBeep: vi.fn() }));
vi.mock('./alertSound', () => beep);

import { CallCentreConsole } from './CallCentreConsole';
import { opsT } from './opsStrings';

const branch = (id: string, nameEn: string, over: Partial<Branch> = {}): Branch => ({
  id, nameEn, nameAr: nameEn, addressAr: '', addressEn: '', phone: '',
  latitude: 0, longitude: 0, isActive: true, deliveryFee: 0, minDeliveryOrder: 0, ...over,
});

const product = (id: string): Product => ({
  id, categoryId: 'c1', nameAr: id, nameEn: id, descriptionAr: '', descriptionEn: '',
  price: 10, imageUrl: '', calories: 0, isActive: true, modifierGroupIds: [],
});

const i18n = {
  lang: 'en' as const, isRTL: false, dir: 'ltr' as const,
  t: (k: Parameters<typeof opsT>[1]) => opsT('en', k),
  toggle: () => {},
};

const riyadh = branch('b1', 'Riyadh');
const jeddah = branch('b2', 'Jeddah');

beforeEach(() => {
  vi.clearAllMocks();
  useApp.mockReturnValue({ branches: [riyadh, jeddah], products: [product('p1'), product('p2')] });
  ops.allAvailability.mockResolvedValue([]);
  ops.resumeDelivery.mockResolvedValue(undefined);
  ops.pauseDelivery.mockResolvedValue(undefined);
  ops.disableArea.mockResolvedValue(undefined);
  ops.enableArea.mockResolvedValue(undefined);
  config.allAreas.mockResolvedValue([]);
  config.workingHours.mockResolvedValue([]);
});
afterEach(cleanup);

describe('CallCentreConsole', () => {
  it('says everything is fine rather than listing healthy branches', async () => {
    // The board answers "what needs attention". Rendering every healthy branch
    // would make an operator hunt mid-call for the one that is not.
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Every branch is running normally/i)).toBeTruthy();
    expect(screen.queryByText('Riyadh')).toBeNull();
  });

  it('shows only the branch that has a closure', async () => {
    ops.allAvailability.mockResolvedValue([
      { branchId: 'b1', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText('Riyadh')).toBeTruthy();
    expect(screen.queryByText('Jeddah')).toBeNull();
  });

  it('flags a branch whose delivery is paused', async () => {
    useApp.mockReturnValue({
      branches: [branch('b1', 'Riyadh', { deliveryTemporarilyClosed: true }), jeddah],
      products: [product('p1')],
    });
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Delivery paused/i)).toBeTruthy();
  });

  it('opens a branch panel with its contact, items and hours', async () => {
    ops.allAvailability.mockResolvedValue([
      { branchId: 'b1', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getByText(/Closed items/i)).toBeTruthy();
    expect(panel.getByText(/Working hours/i)).toBeTruthy();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalledWith('b1'));
  });

  it('resumes delivery from the panel', async () => {
    useApp.mockReturnValue({
      branches: [branch('b1', 'Riyadh', { deliveryTemporarilyClosed: true })],
      products: [product('p1')],
    });
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    fireEvent.click(panel.getByRole('button', { name: /Resume delivery/i }));
    await waitFor(() => expect(ops.resumeDelivery).toHaveBeenCalledWith('b1'));
  });

  it('pauses delivery through the shared dialog', async () => {
    ops.allAvailability.mockResolvedValue([
      { branchId: 'b1', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByText('Riyadh'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Pause delivery for…/i }));

    fireEvent.click(await screen.findByRole('button', { name: '1 hour' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm pause/i }));
    await waitFor(() => expect(ops.pauseDelivery).toHaveBeenCalledWith({
      branchId: 'b1', minutes: 60, reasonCode: 'no_driver', note: '',
    }));
  });

  it('says in the panel that area names do not control the app', async () => {
    ops.allAvailability.mockResolvedValue([
      { branchId: 'b1', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    config.allAreas.mockResolvedValue([
      { id: 'a1', branchId: 'b1', nameAr: 'Malaz', nameEn: 'Malaz', sortOrder: 1, isDisabled: false, disabledUntil: null },
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getByText(/do not control the app/i)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: /^Disable$/i }));
    await waitFor(() => expect(ops.disableArea).toHaveBeenCalled());
  });

  it('alerts on a branch that newly appears, but not on first load', async () => {
    const { rerender } = render(<CallCentreConsole i18n={i18n} />);
    await screen.findByText(/Every branch is running normally/i);
    // First paint is state, not news.
    expect(beep.playAlertBeep).not.toHaveBeenCalled();

    ops.allAvailability.mockResolvedValue([
      { branchId: 'b2', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(await screen.findByText(/New closure: Jeddah/i)).toBeTruthy();
    expect(beep.playAlertBeep).toHaveBeenCalled();
    rerender(<CallCentreConsole i18n={i18n} />);
  });

  it('stays silent when muted', async () => {
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByRole('button', { name: /Alert sound on/i }));

    ops.allAvailability.mockResolvedValue([
      { branchId: 'b2', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    // The toast still appears — muting silences the sound, not the information.
    expect(await screen.findByText(/New closure/i)).toBeTruthy();
    expect(beep.playAlertBeep).not.toHaveBeenCalled();
  });

  it('surfaces a load failure', async () => {
    ops.allAvailability.mockRejectedValue(new Error('permission denied'));
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/permission denied/i)).toBeTruthy();
  });
});
