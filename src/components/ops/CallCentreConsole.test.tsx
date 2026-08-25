// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import type { Branch, Modifier, ModifierGroup, Product } from '../../types';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

const ops = vi.hoisted(() => ({
  allAvailability: vi.fn(),
  allModifierAvailability: vi.fn(),
  branchDeliveryState: vi.fn(),
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

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, categoryId: 'c1', nameAr: id, nameEn: id, descriptionAr: '', descriptionEn: '',
  price: 10, imageUrl: '', calories: 0, isActive: true, modifierGroupIds: [], variants: [], ...over,
});

const modifier = (id: string, groupId = 'heat'): Modifier =>
  ({ id, groupId, nameAr: id, nameEn: id, price: 0 });

// A REQUIRED heat group with two options, on burger. Closing both takes the
// burger off the menu without touching branch_product_availability at all.
const heat: ModifierGroup = {
  id: 'heat', nameAr: 'الحرارة', nameEn: 'Heat level',
  minSelection: 1, maxSelection: 1, isRequired: true,
  modifiers: [modifier('Mild'), modifier('Hot')],
};
// An OPTIONAL group: closing all of it takes nothing off the menu, which is the
// case the option-only strip exists for.
const sauce: ModifierGroup = {
  id: 'sauce', nameAr: 'الصلصة', nameEn: 'Sauce',
  minSelection: 0, maxSelection: 2, isRequired: false,
  modifiers: [modifier('Garlic', 'sauce'), modifier('Chilli', 'sauce')],
};
const burger = product('p3', {
  nameEn: 'Burger', nameAr: 'Burger', modifierGroupIds: ['heat', 'sauce'],
});

const modAvail = (branchId: string, modifierId: string, isAvailable: boolean, snoozedUntil: string | null = null) =>
  ({ branchId, modifierId, isAvailable, snoozedUntil, reasonCode: null });

const i18n = {
  lang: 'en' as const, isRTL: false, dir: 'ltr' as const,
  t: (k: Parameters<typeof opsT>[1]) => opsT('en', k),
  toggle: () => {},
};

const riyadh = branch('b1', 'Riyadh');
const jeddah = branch('b2', 'Jeddah');

/**
 * One place that knows the shape of the context this component reads. A per-test
 * literal that forgets a key does not render `undefined` quietly — it throws
 * from inside buildClosureSummaries, three files away from the omission.
 */
const mockApp = (over: Partial<{ branches: Branch[]; products: Product[]; modifierGroups: ModifierGroup[] }> = {}) =>
  useApp.mockReturnValue({
    branches: [riyadh, jeddah],
    products: [product('p1'), product('p2'), burger],
    modifierGroups: [heat, sauce],
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockApp();
  ops.allAvailability.mockResolvedValue([]);
  ops.allModifierAvailability.mockResolvedValue([]);
  // Empty means "no live override", so branches fall through to the context —
  // which is what every test that sets deliveryTemporarilyClosed relies on.
  ops.branchDeliveryState.mockResolvedValue([]);
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
    mockApp({
      branches: [branch('b1', 'Riyadh', { deliveryTemporarilyClosed: true }), jeddah],
      products: [product('p1')],
    });
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Delivery paused/i)).toBeTruthy();
  });

  it('THE GAP: shows a branch whose items are all "available" but blocked by closed options', async () => {
    // Nothing in branch_product_availability is closed. The burger cannot be
    // ordered anyway, and before this the board said Riyadh was fine.
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b1', 'Mild', false), modAvail('b1', 'Hot', false),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText('Riyadh')).toBeTruthy();
    expect(screen.queryByText(/Every branch is running normally/i)).toBeNull();
    expect(screen.queryByText('Jeddah')).toBeNull();
  });

  it('names the blocked count on the tile, separately from the total', async () => {
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b1', 'Mild', false), modAvail('b1', 'Hot', false),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    await screen.findByText('Riyadh');
    expect(screen.getByText(/1 items blocked/i)).toBeTruthy();
  });

  it('the panel leads with the CAUSE, naming the group and its closed options', async () => {
    // One closed group can block every burger on the menu. The operator needs
    // the cause once, not the same incident repeated per product.
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b1', 'Mild', false), modAvail('b1', 'Hot', false),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getByText(/Items customers cannot order/i)).toBeTruthy();
    expect(panel.getByText(/What is causing it/i)).toBeTruthy();
    expect(panel.getByText('Heat level')).toBeTruthy();
    // English comma, not the Arabic `، ` that was hardcoded in both languages.
    expect(panel.getByText('Mild, Hot')).toBeTruthy();
    expect(panel.getByText('Burger')).toBeTruthy();
  });

  it('says "Returning now" rather than a bare label when a prediction has lapsed', async () => {
    // returnLabel is null once the time is past, and the sweeper only reopens
    // expired option rows once a minute — so there is a window on every expiry
    // where a non-null prediction has no remaining time left to print.
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b1', 'Mild', false, new Date(Date.now() - 1_000).toISOString()),
      modAvail('b1', 'Hot', false, new Date(Date.now() - 1_000).toISOString()),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getAllByText('Returning now').length).toBeGreaterThan(0);
    // Never the bare label with nothing after it.
    expect(panel.queryByText('Earliest return')).toBeNull();
  });

  it('never borrows branch-timer wording for a derived prediction', async () => {
    // "Back in 12:30" is what a human set. A prediction says so in its own words
    // or an operator repeats it to a customer as a promise.
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b1', 'Mild', false, new Date(Date.now() + 600_000).toISOString()),
      modAvail('b1', 'Hot', false, new Date(Date.now() + 600_000).toISOString()),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Earliest return/i)).toBeTruthy();
    expect(screen.queryByText(/Back in/i)).toBeNull();
    fireEvent.click(screen.getByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getAllByText(/Earliest return/i).length).toBeGreaterThan(0);
    expect(panel.queryByText(/Back in/i)).toBeNull();
  });

  it('never offers the call centre a control to reopen an option', async () => {
    // Availability is the branch's to own. This asserts the invariant by
    // absence, which is the only way an absent control can be pinned.
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b1', 'Mild', false), modAvail('b1', 'Hot', false),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    fireEvent.click(await screen.findByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getByText(/Only the branch can reopen an option/i)).toBeTruthy();
    expect(panel.queryByRole('button', { name: /reopen|open|إتاحة/i })).toBeNull();
  });

  it('lists an option-only branch separately, by NAME, without putting it on the board', async () => {
    // Every item is still orderable, so it is not board-worthy — but "can I get
    // Mild at Jeddah?" is a real call, and a count could not answer it.
    ops.allModifierAvailability.mockResolvedValue([modAvail('b2', 'Garlic', false)]);
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Branches with closed options only/i)).toBeTruthy();
    expect(screen.getByText('Garlic')).toBeTruthy();
    // Still all-clear on the board itself.
    expect(screen.getByText(/Every branch is running normally/i)).toBeTruthy();
  });

  it('reads option availability on every refresh', async () => {
    // A one-line omission in the Promise.all leaves the board permanently stale
    // about options with nothing else looking wrong.
    render(<CallCentreConsole i18n={i18n} />);
    await waitFor(() => expect(ops.allModifierAvailability).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(ops.allModifierAvailability).toHaveBeenCalledTimes(2));
  });

  it('never labels a blocked item "closed" on the tile', async () => {
    // "2 items closed / 1 items blocked" both mislabels and double-counts. The
    // whole module exists to keep a branch decision apart from an accident.
    ops.allAvailability.mockResolvedValue([
      { branchId: 'b1', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b1', 'Mild', false), modAvail('b1', 'Hot', false),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    await screen.findByText('Riyadh');
    expect(screen.getByText(/2 items unavailable/i)).toBeTruthy();
    expect(screen.getByText(/1 items blocked/i)).toBeTruthy();
    expect(screen.queryByText(/items closed/i)).toBeNull();
  });

  it('shows no all-clear when the read failed — an empty board is not good news', async () => {
    ops.allModifierAvailability.mockRejectedValue(new Error('network down'));
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/network down/i)).toBeTruthy();
    expect(screen.queryByText(/Every branch is running normally/i)).toBeNull();
  });

  it('does not toast or beep on first load, however much is closed', async () => {
    // The effect runs once before any data arrives, so the ref used to capture
    // an empty board and the first successful load read as "everything just
    // broke" — a beep per branch, every time the console was opened.
    ops.allAvailability.mockResolvedValue([
      { branchId: 'b1', productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { branchId: 'b2', productId: 'p2', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    await screen.findByText('Riyadh');
    await waitFor(() => expect(screen.getByText('Jeddah')).toBeTruthy());
    expect(beep.playAlertBeep).not.toHaveBeenCalled();
    expect(screen.queryByText(/New closure/i)).toBeNull();
  });

  it('separates names with an English comma in English', async () => {
    // `، ` is an Arabic comma and was hardcoded in both languages. An OPTIONAL
    // group is used so the branch lands in the strip rather than on the board.
    ops.allModifierAvailability.mockResolvedValue([
      modAvail('b2', 'Garlic', false), modAvail('b2', 'Chilli', false),
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    await screen.findByText(/Branches with closed options only/i);
    expect(screen.getByText('Garlic, Chilli')).toBeTruthy();
  });

  it('says when a paused delivery resumes, on the tile and in the panel', async () => {
    // The tile put delivery first: it is the only state that stops a customer
    // ordering at all, and "when does it come back" is the question being asked
    // while the tile is on screen.
    mockApp({
      branches: [branch('b1', 'Riyadh', {
        deliveryTemporarilyClosed: true,
        deliveryClosedUntil: new Date(Date.now() + 90_000).toISOString(),
      })],
    });
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Delivery resumes in 1:(29|30)/)).toBeTruthy();
    fireEvent.click(screen.getByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getByText(/Delivery resumes in 1:(29|30)/)).toBeTruthy();
  });

  it('says a pause has no timer rather than showing an empty countdown', async () => {
    mockApp({
      branches: [branch('b1', 'Riyadh', { deliveryTemporarilyClosed: true })],
    });
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Paused with no timer/i)).toBeTruthy();
    expect(screen.queryByText(/Delivery resumes in/i)).toBeNull();
    // ...and in the panel, which is a separate branch of a separate component.
    fireEvent.click(screen.getByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getByText(/Paused with no timer/i)).toBeTruthy();
  });

  it('says "Resuming now" once the pause timer has lapsed', async () => {
    // The sweeper resumes delivery once a minute, so there is a window where the
    // timer is in the past and the branch is still paused.
    mockApp({
      branches: [branch('b1', 'Riyadh', {
        deliveryTemporarilyClosed: true,
        deliveryClosedUntil: new Date(Date.now() - 1_000).toISOString(),
      })],
    });
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Resuming now/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Riyadh'));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.getByText(/Resuming now/i)).toBeTruthy();
  });

  it('reads LIVE branch delivery state, not the sign-in snapshot', async () => {
    // `branches` in the app context is loaded once at sign-in. Without a live
    // read, pausing delivery from this very console left the board all-clear.
    // The context here says delivery is running; the server says it is paused.
    ops.branchDeliveryState.mockResolvedValue([
      { branchId: 'b1', deliveryTemporarilyClosed: true, deliveryClosedUntil: null },
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText('Riyadh')).toBeTruthy();
    expect(screen.getByText(/Delivery paused/i)).toBeTruthy();
  });

  it('a live RESUME clears a branch the context still thinks is paused', async () => {
    mockApp({
      branches: [branch('b1', 'Riyadh', { deliveryTemporarilyClosed: true }), jeddah],
    });
    ops.branchDeliveryState.mockResolvedValue([
      { branchId: 'b1', deliveryTemporarilyClosed: false, deliveryClosedUntil: null },
    ]);
    render(<CallCentreConsole i18n={i18n} />);
    expect(await screen.findByText(/Every branch is running normally/i)).toBeTruthy();
  });

  it('re-reads delivery state on every refresh', async () => {
    render(<CallCentreConsole i18n={i18n} />);
    await waitFor(() => expect(ops.branchDeliveryState).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(ops.branchDeliveryState).toHaveBeenCalledTimes(2));
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
    mockApp({
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
