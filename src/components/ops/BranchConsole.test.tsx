// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { Branch, Category, ModifierGroup, Product } from '../../types';

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
  imageUrl: '', calories: 0, isActive: true, modifierGroupIds: [],
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

// English so assertions read plainly; the Arabic default is covered separately.
const i18n = {
  lang: 'en' as const, isRTL: false, dir: 'ltr' as const,
  t: (k: Parameters<typeof opsT>[1]) => opsT('en', k),
  toggle: () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.mockReturnValue({
    branches: [branch], products: [fries, cola], categories: [category], modifierGroups: [heat],
  });
  mocks.branchAvailability.mockResolvedValue([]);
  mocks.branchModifierAvailability.mockResolvedValue([]);
  mocks.snoozeProduct.mockResolvedValue(undefined);
  mocks.reopenProduct.mockResolvedValue(undefined);
  mocks.snoozeModifier.mockResolvedValue(undefined);
  mocks.reopenModifier.mockResolvedValue(undefined);
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
    // 90s remaining renders as M:SS, give or take the tick.
    expect(await screen.findByText(/Back in 1:(29|30)/)).toBeTruthy();
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
    expect(await screen.findByText(/Closed with no timer/i)).toBeTruthy();
  });

  it('reopens through the RPC, scoped to its own branch', async () => {
    mocks.branchAvailability.mockResolvedValue([{
      productId: 'p1', isAvailable: false,
      snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
      reasonCode: 'out_of_stock',
    }]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    const buttons = await screen.findAllByRole('button', { name: /Reopen/i });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(mocks.reopenProduct).toHaveBeenCalledWith('b1', 'p1'));
  });

  it('closes an item with the chosen duration and reason', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i });
    fireEvent.click(closeButtons[0]);

    // Defaults are the common case; override both to prove they are wired.
    fireEvent.click(await screen.findByRole('button', { name: '3 hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Equipment down' }));
    fireEvent.change(screen.getByLabelText(/Note/i), { target: { value: 'fryer down' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm closure/i }));

    await waitFor(() => expect(mocks.snoozeProduct).toHaveBeenCalledWith({
      branchId: 'b1', productId: 'p1', minutes: 180,
      reasonCode: 'equipment_down', note: 'fryer down',
    }));
  });

  it('never offers an untimed option in the close dialog', async () => {
    // Untimed closure is an admin control. If it leaks in here, items start
    // staying closed indefinitely again.
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Close$/i }))[0]);
    await screen.findByRole('button', { name: '30 minutes' });
    expect(screen.queryByRole('button', { name: /until i reopen/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /forever|indefinite|no timer/i })).toBeNull();
  });

  it('surfaces a server refusal instead of silently doing nothing', async () => {
    mocks.snoozeProduct.mockRejectedValue(new Error('Not authorized to change availability'));
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Close$/i }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Confirm closure/i }));
    expect(await screen.findByText(/Not authorized/i)).toBeTruthy();
  });

  it('closes ONE option without touching the product', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Show options/i }))[0]);
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
    const reopen = await screen.findAllByRole('button', { name: /Reopen/i });
    fireEvent.click(reopen[0]);
    await waitFor(() => expect(mocks.reopenModifier).toHaveBeenCalledWith('b1', 'm1'));
    expect(mocks.reopenProduct).not.toHaveBeenCalled();
  });

  it('warns that closing the last option in a REQUIRED group took the item off the menu', async () => {
    // The product's own row still says available. Without this the cashier sees
    // "open" while customers see "out of stock".
    mocks.branchModifierAvailability.mockResolvedValue([
      { modifierId: 'm1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { modifierId: 'm2', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ]);
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    expect(await screen.findByText(/required group has no available option/i)).toBeTruthy();
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
    await screen.findByText('Cola');
    // Only Spicy Fries carries a group, so exactly one toggle exists.
    expect(screen.getAllByRole('button', { name: /Show options/i })).toHaveLength(1);
  });

  it('filters the menu by search in either language', async () => {
    render(<BranchConsole branchId="b1" i18n={i18n} />);
    const box = await screen.findByLabelText(/Search for an item/i);
    fireEvent.change(box, { target: { value: 'cola' } });
    await waitFor(() => expect(screen.queryByText('Spicy Fries')).toBeNull());
    expect(screen.getByText('Cola')).toBeTruthy();
  });
});
