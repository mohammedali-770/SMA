// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Branch } from '../../types';

// The panel pulls everything from the app context; mock it so we can drive the
// delete control in isolation (no Supabase, no realtime, no provider tree).
const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => useApp() }));

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
