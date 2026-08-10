// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listStaff = vi.fn();
const searchCandidates = vi.fn();
const setRole = vi.fn();
const listAudit = vi.fn();

vi.mock('../../lib/staffAccessApi', () => ({
  staffAccess: { listStaff, searchCandidates, setRole, listAudit },
}));

import { StaffAccessPanel } from './StaffAccessPanel';

const admin = {
  id: 'admin-1', full_name: 'Owner Admin', email: 'owner@example.test',
  phone_number: '+966500000001', role: 'admin' as const,
  created_at: '2026-08-01T00:00:00Z', updated_at: null,
};
const candidate = {
  id: 'customer-1', full_name: 'Candidate User', email: 'candidate@example.test',
  phone_number: '+966500000002', role: 'customer' as const,
  created_at: '2026-08-02T00:00:00Z', updated_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  listStaff.mockResolvedValue([admin]);
  listAudit.mockResolvedValue([]);
  searchCandidates.mockResolvedValue([candidate]);
  setRole.mockResolvedValue({ id: candidate.id, role: 'accountant', changed: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StaffAccessPanel', () => {
  it('loads current staff and keeps the signed-in admin self-role controls disabled', async () => {
    render(<StaffAccessPanel lang="en" currentUserId="admin-1" />);
    expect(await screen.findByText('Owner Admin')).toBeTruthy();
    expect((screen.getByLabelText('Owner Admin role') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Owner Admin reason') as HTMLInputElement).disabled).toBe(true);
    expect(listStaff).toHaveBeenCalledTimes(1);
    expect(listAudit).toHaveBeenCalledWith(50);
  });

  it('requires at least two search characters before calling the server', async () => {
    render(<StaffAccessPanel lang="en" currentUserId="admin-1" />);
    await screen.findByText('Owner Admin');
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Enter at least 2 characters to search.')).toBeTruthy();
    expect(searchCandidates).not.toHaveBeenCalled();
  });

  it('searches existing accounts and refuses a role change without an audit reason', async () => {
    render(<StaffAccessPanel lang="en" currentUserId="admin-1" />);
    await screen.findByText('Owner Admin');
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'Candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Candidate User')).toBeTruthy();
    expect(searchCandidates).toHaveBeenCalledWith('Candidate', 20);

    fireEvent.change(screen.getByLabelText('Candidate User role'), { target: { value: 'accountant' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)!);
    expect(await screen.findByText('A reason is required (at least 3 characters).')).toBeTruthy();
    expect(setRole).not.toHaveBeenCalled();
  });

  it('applies an audited role change only after confirmation and refreshes the feeds', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<StaffAccessPanel lang="en" currentUserId="admin-1" />);
    await screen.findByText('Owner Admin');
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'Candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Candidate User');

    fireEvent.change(screen.getByLabelText('Candidate User role'), { target: { value: 'accountant' } });
    fireEvent.change(screen.getByLabelText('Candidate User reason'), { target: { value: 'Finance access' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)!);

    await waitFor(() => expect(setRole).toHaveBeenCalledWith('customer-1', 'accountant', 'Finance access'));
    await waitFor(() => expect(listStaff.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(searchCandidates.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText('Role change saved and written to the audit trail.')).toBeTruthy();
  });
});
