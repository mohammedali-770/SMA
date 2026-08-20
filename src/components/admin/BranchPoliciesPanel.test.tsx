// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import type { Branch } from '../../types';

// The panel pulls everything from the app context; mock it so we can drive the
// delete control in isolation (no Supabase, no realtime, no provider tree).
//
// `AppContext` itself is also exported, because the design-system primitives
// this panel now renders read the active language through `useDsLang`, which
// reads the context DEFENSIVELY (`useContext(AppContext)?.adminLang ?? 'en'`).
// An empty context is exactly the fallback path that hook exists for, so the
// primitives render in English here rather than crashing. Assertions unchanged.
const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

const opsMocks = vi.hoisted(() => ({ pauseDelivery: vi.fn() }));
vi.mock('../../lib/opsApi', () => ({ opsApi: opsMocks }));

import { BranchPoliciesPanel } from './BranchPoliciesPanel';

function makeBranch(id: string, nameEn: string, nameAr: string): Branch {
  return {
    id, nameEn, nameAr,
    addressAr: '', addressEn: '', phone: '',
    latitude: 0, longitude: 0, isActive: true,
    deliveryFee: 0, minDeliveryOrder: 0,
  };
}

const branchA = makeBranch('a', 'Branch A', 'فرع أ');
const branchB = makeBranch('b', 'Branch B', 'فرع ب');

function mockContext(overrides: Record<string, unknown> = {}) {
  useApp.mockReturnValue({
    branches: [branchA, branchB],
    products: [],
    deliveryZones: [],
    adminLang: 'en',
    currentUser: { role: 'admin' },
    updateBranchSettings: vi.fn(),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    isProductAvailableInBranch: () => true,
    toggleProductAvailability: vi.fn(),
    saveBranchDeliveryZone: vi.fn(),
    clearBranchDeliveryZone: vi.fn(),
    ...overrides,
  });
}

const deleteBtn = (nameEn: string) =>
  screen.getByLabelText(`Delete branch ${nameEn}`) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => useApp.mockReset());

describe('BranchPoliciesPanel — branch deletion', () => {
  it('does not render a delete control for accountants (read-only, non-admin)', () => {
    mockContext({ currentUser: { role: 'accountant' } });
    render(<BranchPoliciesPanel />);
    expect(screen.queryByLabelText(/^Delete branch/)).toBeNull();
  });

  it('renders a scoped delete control per branch for admins', () => {
    mockContext();
    render(<BranchPoliciesPanel />);
    expect(deleteBtn('Branch A')).toBeTruthy();
    expect(deleteBtn('Branch B')).toBeTruthy();
  });

  it('deletes only after the admin types the exact branch name to confirm', async () => {
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    mockContext({ deleteBranch });
    vi.spyOn(window, 'prompt').mockReturnValue('Branch A');
    render(<BranchPoliciesPanel />);

    fireEvent.click(deleteBtn('Branch A'));
    await waitFor(() => expect(deleteBranch).toHaveBeenCalledWith('a'));
    expect(deleteBranch).toHaveBeenCalledTimes(1);
  });

  it('aborts when the admin cancels the confirmation prompt (null)', () => {
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    mockContext({ deleteBranch });
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<BranchPoliciesPanel />);

    fireEvent.click(deleteBtn('Branch A'));
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('aborts when the typed name does not match the branch', () => {
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    mockContext({ deleteBranch });
    vi.spyOn(window, 'prompt').mockReturnValue('not the branch');
    render(<BranchPoliciesPanel />);

    fireEvent.click(deleteBtn('Branch A'));
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('disables only the row being deleted, not every branch button', async () => {
    let resolveDelete: (() => void) | undefined;
    const deleteBranch = vi.fn(() => new Promise<void>((res) => { resolveDelete = res; }));
    mockContext({ deleteBranch });
    vi.spyOn(window, 'prompt').mockReturnValue('Branch A');
    render(<BranchPoliciesPanel />);

    fireEvent.click(deleteBtn('Branch A'));

    // While A's delete is in flight, only A's button is disabled; B stays usable.
    await waitFor(() => expect(deleteBtn('Branch A').disabled).toBe(true));
    expect(deleteBtn('Branch B').disabled).toBe(false);

    resolveDelete?.();
    await waitFor(() => expect(deleteBtn('Branch A').disabled).toBe(false));
  });
});

describe('timed delivery pause', () => {
  beforeEach(() => { opsMocks.pauseDelivery.mockReset().mockResolvedValue(undefined); });

  it('offers a timed pause alongside the untimed toggle', () => {
    // Two controls on purpose: "off until further notice" and "off for an hour"
    // are different decisions, and only the second resumes itself.
    mockContext();
    render(<BranchPoliciesPanel />);
    expect(screen.getAllByRole('button', { name: /Pause delivery \(no timer\)/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Pause delivery for…/i }).length).toBeGreaterThan(0);
  });

  it('pauses through the RPC with the chosen duration and reason', async () => {
    mockContext();
    render(<BranchPoliciesPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /Pause delivery for…/i })[0]);

    fireEvent.click(await screen.findByRole('button', { name: '3 hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Weather' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm pause/i }));

    await waitFor(() => expect(opsMocks.pauseDelivery).toHaveBeenCalledWith({
      branchId: 'a', minutes: 180, reasonCode: 'weather', note: '',
    }));
  });

  it('never offers an untimed option inside the timed dialog', async () => {
    mockContext();
    render(<BranchPoliciesPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /Pause delivery for…/i })[0]);
    await screen.findByRole('button', { name: '30 minutes' });
    // Scoped to the dialog: the untimed toggle legitimately exists on the cards
    // behind it, and that is the whole distinction being asserted.
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('button', { name: /no timer|until i resume|indefinite/i })).toBeNull();
  });

  it('shows a server refusal instead of closing as if it worked', async () => {
    opsMocks.pauseDelivery.mockRejectedValue(new Error('Not authorized to change delivery'));
    mockContext();
    render(<BranchPoliciesPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /Pause delivery for…/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Confirm pause/i }));
    expect(await screen.findByText(/Not authorized to change delivery/i)).toBeTruthy();
  });

  it('hides the timed pause from a read-only accountant', () => {
    mockContext({ currentUser: { role: 'accountant' } });
    render(<BranchPoliciesPanel />);
    const btns = screen.queryAllByRole('button', { name: /Pause delivery for…/i }) as HTMLButtonElement[];
    expect(btns.every((b) => b.disabled)).toBe(true);
  });
});
