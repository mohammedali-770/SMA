// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import type { Branch, Category, ModifierGroup, Product, ProductVariant } from '../../types';

// The console reads the catalog from the app context and everything else from
// opsApi. Mock both so the screen can be driven without Supabase or a provider
// tree. AppContext is exported too, because the design-system primitives read
// the active language through useDsLang's defensive useContext.
const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

const mocks = vi.hoisted(() => ({
  branchAvailability: vi.fn(),
  branchModifierAvailability: vi.fn(),
  snoozeProduct: vi.fn(),
  reopenProduct: vi.fn(),
  snoozeModifier: vi.fn(),
  reopenModifier: vi.fn(),
  // The console's single refresh also loads the delivery-request panel and the
  // reference sheet. They are mocked empty here because this suite is about
  // item availability; their own behaviour is covered by
  // branchReference.test.ts and BranchReferenceCard.test.tsx.
  deliveryRequests: vi.fn(),
  branchReference: vi.fn(),
  branchDeliveryState: vi.fn(),
  requestDeliveryPause: vi.fn(),
  cancelDeliveryRequest: vi.fn(),
  revealReference: vi.fn(),
}));
vi.mock('../../lib/opsApi', () => ({ opsApi: mocks }));

import { BranchConsole } from './BranchConsole';
import { opsT } from './opsStrings';

const branch: Branch = {
  id: 'b1', nameEn: 'Riyadh', nameAr: 'الرياض',
  addressAr: '', addressEn: '', phone: '',
  latitude: 0, longitude: 0, isActive: true,
  deliveryFee: 0, minDeliveryOrder: 0,
};

const category: Category = { id: 'c1', nameAr: 'برجر', nameEn: 'Burgers', sortOrder: 1 };

const product = (id: string, nameEn: string): Product => ({
  id, categoryId: 'c1', nameAr: nameEn, nameEn,
  descriptionAr: '', descriptionEn: '', price: 10,
  imageUrl: '', calories: 0, isActive: true, earnsLoyaltyPoints: true,
  modifierGroupIds: [], variants: [],
});

const heat: ModifierGroup = {
  id: 'g1', nameAr: 'الحرارة', nameEn: 'Heat level',
  minSelection: 1, maxSelection: 1, isRequired: true,
  modifiers: [
    { id: 'm1', groupId: 'g1', nameAr: 'خفيف', nameEn: 'Mild', price: 0 },
    { id: 'm2', groupId: 'g1', nameAr: 'حار', nameEn: 'Hot', price: 0 },
  ],
};

const fries = { ...product('p1', 'Spicy Fries'), modifierGroupIds: ['g1'] };
const cola = product('p2', 'Cola');

// A tiered product, which is what 59 of the 61 real ones are. The console could
// not show a cashier what the sizes cost before this redesign.
const tier = (id: string, nameEn: string, price: number): ProductVariant => ({
  id, productId: 'p3', nameAr: nameEn, nameEn, price,
  calories: null, sortOrder: 0, isActive: true,
});
const meal = {
  ...product('p3', 'Family Meal'),
  price: 45,
  variants: [tier('v2', 'Large', 75), tier('v1', 'Regular', 45)],
};

// English so assertions read plainly; the Arabic default is covered separately.
const i18n = {
  lang: 'en' as const, isRTL: false, dir: 'ltr' as const,
  t: (k: Parameters<typeof opsT>[1]) => opsT('en', k),
  toggle: () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.mockReturnValue({
    branches: [branch], products: [fries, cola, meal], categories: [category], modifierGroups: [heat],
  });
  mocks.branchAvailability.mockResolvedValue([]);
  mocks.branchModifierAvailability.mockResolvedValue([]);
  mocks.snoozeProduct.mockResolvedValue(undefined);
  mocks.reopenProduct.mockResolvedValue(undefined);
  mocks.snoozeModifier.mockResolvedValue(undefined);
  mocks.reopenModifier.mockResolvedValue(undefined);
  mocks.deliveryRequests.mockResolvedValue([]);
  mocks.branchReference.mockResolvedValue([]);
  mocks.branchDeliveryState.mockResolvedValue([]);
  mocks.requestDeliveryPause.mockResolvedValue(undefined);
  mocks.cancelDeliveryRequest.mockResolvedValue(undefined);
  mocks.revealReference.mockResolvedValue('');
});
afterEach(cleanup);

describe('BranchConsole', () => {
  it('tells an unassigned operator to get linked instead of showing an empty menu', async () => {
    render(<BranchConsole branchId={null} i18n={i18n} />);
    expect(await screen.findByText(/not linked to a branch/i)).toBeTruthy();
    expect(mocks.branchAvailability).not.toHaveBeenCalled();
  });

  it('loads only its own branch, and shows the all-clear when nothing is closed', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    await waitFor(() => expect(mocks.branchAvailability).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText(/Everything is available/i)).toBeTruthy();
  });

  it('shows a live countdown for a closed item', async () => {
    mocks.branchAvailability.mockResolvedValue([{
      productId: 'p1', isAvailable: false,
      snoozedUntil: new Date(Date.now() + 90_000).toISOString(),
      reasonCode: 'out_of_stock',
    }]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    // 90s remaining renders as M:SS, give or take the tick. The redesign moved
    // this onto the tile itself, where a prefix would not fit — the property
    // under test is that a LIVE countdown is visible, not its wording.
    expect(await screen.findByText(/^1:(29|30)$/)).toBeTruthy();
  });

  it('says "reopening now" rather than freezing at zero once the timer lapses', async () => {
    // The row is only truly reopened by the server sweeper, so the screen must
    // say something true in the gap rather than showing a stopped clock.
    mocks.branchAvailability.mockResolvedValue([{
      productId: 'p1', isAvailable: false,
      snoozedUntil: new Date(Date.now() - 1_000).toISOString(),
      reasonCode: 'out_of_stock',
    }]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    expect(await screen.findByText(/Reopening now/i)).toBeTruthy();
  });

  it('labels an untimed admin closure as such, not as a countdown', async () => {
    mocks.branchAvailability.mockResolvedValue([
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    // An admin delisting never reopens itself. The first draft of the tile fell
    // back to "reopening now" here, which tells a cashier to wait for something
    // that will not happen; this assertion is what caught it.
    expect(await screen.findByText(/Closed with no timer/i)).toBeTruthy();
    expect(screen.queryByText(/Reopening now/i)).toBeNull();
  });

  it('reopens through the RPC, scoped to its own branch', async () => {
    mocks.branchAvailability.mockResolvedValue([{
      productId: 'p2', isAvailable: false,
      snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
      reasonCode: 'out_of_stock',
    }]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    // The grid replaced the per-row Reopen button: the tile IS the control, and
    // a product with nothing to choose between skips the sheet entirely. Cola
    // (p2) carries neither tiers nor option groups, which is what makes this the
    // direct path rather than the sheet.
    fireEvent.click(await screen.findByTestId('tile-p2'));
    await waitFor(() => expect(mocks.reopenProduct).toHaveBeenCalledWith('b1', 'p2'));
  });

  it('closes an item with the chosen duration and reason', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tile-p2'));

    // Defaults are the common case; override both to prove they are wired.
    fireEvent.click(await screen.findByRole('button', { name: '3 hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Equipment down' }));
    fireEvent.change(screen.getByLabelText(/Note/i), { target: { value: 'fryer down' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm closure/i }));

    await waitFor(() => expect(mocks.snoozeProduct).toHaveBeenCalledWith({
      branchId: 'b1', productId: 'p2', minutes: 180,
      reasonCode: 'equipment_down', note: 'fryer down',
    }));
  });

  it('never offers an untimed option in the close dialog', async () => {
    // Untimed closure is an admin control. If it leaks in here, items start
    // staying closed indefinitely again.
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tile-p2'));
    await screen.findByRole('button', { name: '30 minutes' });
    expect(screen.queryByRole('button', { name: /until i reopen/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /forever|indefinite|no timer/i })).toBeNull();
  });

  it('surfaces a server refusal instead of silently doing nothing', async () => {
    mocks.snoozeProduct.mockRejectedValue(new Error('Not authorized to change availability'));
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tile-p2'));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm closure/i }));
    expect(await screen.findByText(/Not authorized/i)).toBeTruthy();
  });

  it('makes the page behind the item sheet genuinely unreachable', async () => {
    // `aria-modal="true"` is a PROMISE to assistive technology that the rest of
    // the page is gone. The first version of this sheet made that promise while
    // hand-rolling its own scrim — no focus trap, no focus restore, no Escape,
    // nothing inert — so Tab still reached the tiles underneath. Caught in
    // review on #393; the sheet now goes through `AdminModal`/`ModalShell` like
    // every other dialog in the console.
    //
    // `#root` is what ModalShell inerts, so the test has to supply one; the
    // effect early-returns without it and the assertion would pass vacuously.
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    try {
      render(<BranchConsole branchId="b1" i18n={i18n} />, { container: root });
      fireEvent.click(await screen.findByTestId('tile-p3'));
      await screen.findByRole('dialog');

      expect(root.hasAttribute('inert')).toBe(true);
      expect(root.getAttribute('aria-hidden')).toBe('true');

      // And Escape closes it, which the hand-rolled version never answered.
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(root.hasAttribute('inert')).toBe(false);
    } finally {
      root.remove();
    }
  });

  it('closes ONE option without touching the product', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    // The accordion became the item sheet. Options live there now, beside the
    // price tiers — both are sub-selections of the same product.
    fireEvent.click(await screen.findByTestId('tile-p1'));
    fireEvent.click(await screen.findByTestId('option-m1'));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm closure/i }));

    await waitFor(() => expect(mocks.snoozeModifier).toHaveBeenCalledWith({
      branchId: 'b1', modifierId: 'm1', minutes: 30, reasonCode: 'out_of_stock', note: '',
    }));
    expect(mocks.snoozeProduct).not.toHaveBeenCalled();
  });

  it('reopens one option through its own RPC', async () => {
    mocks.branchModifierAvailability.mockResolvedValue([
      { modifierId: 'm1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tile-p1'));
    fireEvent.click(await screen.findByTestId('option-m1'));
    await waitFor(() => expect(mocks.reopenModifier).toHaveBeenCalledWith('b1', 'm1'));
    expect(mocks.reopenProduct).not.toHaveBeenCalled();
  });

  it('warns that closing the last option in a REQUIRED group took the item off the menu', async () => {
    // The product's own row still says available. Without this the cashier sees
    // "open" while customers see "out of stock".
    //
    // BOTH WORDINGS ARE ASSERTED, and that is the point of keeping this test as
    // it was. The redesign moved the warning from a full-width row pill to a
    // tile ribbon, and a ribbon has room for two words — so the original
    // sentence survives only as the tile's accessible text. Asserting the short
    // one alone would let the explanation be dropped silently next time.
    mocks.branchModifierAvailability.mockResolvedValue([
      { modifierId: 'm1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { modifierId: 'm2', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    expect(await screen.findByText(/required group has no available option/i)).toBeTruthy();
    expect(screen.getByText(/Partly closed/i)).toBeTruthy();
  });

  it('does NOT warn while a required group still has one option left', async () => {
    mocks.branchModifierAvailability.mockResolvedValue([
      { modifierId: 'm1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    await screen.findByText('Spicy Fries');
    expect(screen.queryByText(/required group has no available option/i)).toBeNull();
  });

  it('offers no options control for a product that has none', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tile-p2'));
    // Cola has neither tiers nor groups, so tapping it goes straight to the
    // close dialog. A sheet listing nothing to choose between is a step that
    // tells a cashier something they already know.
    await screen.findByRole('button', { name: '30 minutes' });
    expect(screen.queryByTestId('option-m1')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // The 2026-09-16 rearrange: tabs, the cashier grid, reopen-all, no Refresh.
  // -------------------------------------------------------------------------

  it('opens on Items, with the reference sheet and delivery panel out of the way', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    expect(await screen.findByTestId('tile-p2')).toBeTruthy();
    expect(screen.getByTestId('tab-items').getAttribute('aria-selected')).toBe('true');
    // Both used to sit above the menu on the same scroll. The cashier's own
    // task is the only thing on this tab now.
    expect(screen.queryByText(/Delivery closure/i)).toBeNull();
    expect(screen.queryByText(/Branch information/i)).toBeNull();
  });

  it('moves the branch sheet and the delivery request onto their own tabs', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tab-delivery'));
    expect(await screen.findByText(/Delivery closure/i)).toBeTruthy();
    // Leaving Items must not leave the grid mounted underneath it.
    expect(screen.queryByTestId('tile-p2')).toBeNull();

    fireEvent.click(screen.getByTestId('tab-branch'));
    expect(await screen.findByText(/Branch information/i)).toBeTruthy();
  });

  it('has no Refresh button, because the change feed does that now', async () => {
    // Removing it was only honest once `useOpsChangeFeed` was wired. If the feed
    // is ever unwired, this assertion is the one that should be revisited — not
    // deleted.
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    await screen.findByTestId('tile-p2');
    expect(screen.queryByRole('button', { name: /^Refresh$/i })).toBeNull();
  });

  it('reopens every closed item at this branch, but only after a confirm', async () => {
    mocks.branchAvailability.mockResolvedValue([
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { productId: 'p2', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('reopen-all'));
    // Nothing may have happened yet: the confirm is the whole safeguard, since
    // a finished bulk reopen looks exactly like a screen that just loaded.
    expect(mocks.reopenProduct).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByTestId('reopen-all-confirm'));
    await waitFor(() => expect(mocks.reopenProduct).toHaveBeenCalledTimes(2));
    // Every call carries THIS branch, and only products this branch reported.
    for (const call of mocks.reopenProduct.mock.calls) expect(call[0]).toBe('b1');
    expect(mocks.reopenProduct.mock.calls.map((c) => c[1]).sort()).toEqual(['p1', 'p2']);
  });

  it('clears exactly as many rows as the confirm said it would', async () => {
    // Caught in review on #393. A closed availability row can name a product
    // the client catalog does not carry — deactivated, or unreadable by this
    // role. It is absent from the count the cashier agrees to, so it must be
    // absent from the action too; the first version read the raw rows and
    // cleared it silently.
    mocks.branchAvailability.mockResolvedValue([
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { productId: 'not-in-catalog', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('reopen-all'));

    // The confirm promises one, so the action must do one. Singular, because
    // one of the two closed rows is not a product this cashier can see.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 item closed now')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('reopen-all-confirm'));
    await waitFor(() => expect(mocks.reopenProduct).toHaveBeenCalledTimes(1));
    expect(mocks.reopenProduct).toHaveBeenCalledWith('b1', 'p1');
  });

  it('offers no reopen-all when nothing is closed', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    await screen.findByTestId('tile-p2');
    expect(screen.queryByTestId('reopen-all')).toBeNull();
  });

  it('says how many reopens failed rather than reporting a clean sweep', async () => {
    // Collected, not thrown on the first refusal: a cashier who taps this wants
    // everything back, and stopping early would leave an arbitrary half.
    mocks.branchAvailability.mockResolvedValue([
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { productId: 'p2', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    mocks.reopenProduct.mockRejectedValueOnce(new Error('nope'));
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('reopen-all'));
    fireEvent.click(await screen.findByTestId('reopen-all-confirm'));
    await waitFor(() => expect(mocks.reopenProduct).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/1\/2/)).toBeTruthy();
  });

  it('shows every price tier when a tiered item is tapped', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tile-p3'));
    // Cheapest first, both named and both priced. A cashier closing "Family
    // Meal" could not previously see that it means two different prices.
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Regular')).toBeTruthy();
    expect(within(sheet).getByText('Large')).toBeTruthy();
    expect(within(sheet).getByText(/45\.00/)).toBeTruthy();
    expect(within(sheet).getByText(/75\.00/)).toBeTruthy();
  });

  it('closes the WHOLE tiered item from the sheet, since per-tier closure does not exist yet', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click(await screen.findByTestId('tile-p3'));
    fireEvent.click(await screen.findByRole('button', { name: /Close the whole item/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm closure/i }));
    await waitFor(() => expect(mocks.snoozeProduct).toHaveBeenCalledWith({
      branchId: 'b1', productId: 'p3', minutes: 30, reasonCode: 'out_of_stock', note: '',
    }));
  });

  it('renders a fallback tile rather than a broken image for an item with no photo', async () => {
    // Four of fifty-five real products carry an image, so this is the common
    // case, not the edge one.
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    const tile = await screen.findByTestId('tile-p2');
    expect(tile.querySelector('img')).toBeNull();
  });

  it('falls back to the coloured block when a photo FAILS to load', async () => {
    // Caught by opening the grid in a real browser: a URL that 404s or is
    // blocked renders the browser's broken-image glyph on a white box, which
    // reads as the console being broken rather than as a missing photo.
    // Storage is a separate origin, so this happens without anything else
    // going wrong.
    useApp.mockReturnValue({
      branches: [branch],
      products: [{ ...cola, imageUrl: 'https://example.invalid/gone.jpg' }],
      categories: [category],
      modifierGroups: [heat],
    });
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    const tile = await screen.findByTestId('tile-p2');
    const img = tile.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    await waitFor(() => expect(tile.querySelector('img')).toBeNull());
  });

  it('does not call a single-tier item\u2019s only price a STARTING price', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    const cheap = await screen.findByTestId('tile-p2');
    expect(cheap.textContent).toContain('10.00');
    expect(cheap.textContent).not.toMatch(/from/i);
    // A tiered item genuinely starts somewhere, so it keeps the word.
    expect(screen.getByTestId('tile-p3').textContent).toMatch(/from/i);
  });

  it('filters the menu by search in either language', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    const box = await screen.findByLabelText(/Search for an item/i);
    fireEvent.change(box, { target: { value: 'cola' } });
    await waitFor(() => expect(screen.queryByText('Spicy Fries')).toBeNull());
    expect(screen.getByText('Cola')).toBeTruthy();
  });
});
