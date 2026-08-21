// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { Branch } from '../../types';

// The modal reads working hours and areas through branchConfigApi and nothing
// else, so mocking that one module is enough to drive it.
const config = vi.hoisted(() => ({
  workingHours: vi.fn(),
  saveWorkingHours: vi.fn(),
  areas: vi.fn(),
  addArea: vi.fn(),
  moveArea: vi.fn(),
  deleteArea: vi.fn(),
}));
vi.mock('../../lib/branchConfigApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/branchConfigApi')>();
  return { ...actual, branchConfig: config };
});

import { BranchEditModal } from './BranchEditModal';

const branch: Branch = {
  id: 'b1', nameEn: 'Riyadh', nameAr: 'الرياض',
  addressEn: 'St', addressAr: 'شارع', phone: '+966500000000',
  latitude: 24.7, longitude: 46.6, isActive: true,
  deliveryFee: 15, minDeliveryOrder: 40,
};

const OPEN_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek, isClosed: false, opensAt: '10:00', closesAt: '23:00',
}));

beforeEach(() => {
  vi.clearAllMocks();
  config.workingHours.mockResolvedValue(OPEN_WEEK);
  config.saveWorkingHours.mockResolvedValue(undefined);
  config.areas.mockResolvedValue([]);
});
afterEach(cleanup);

function open(onSave = vi.fn()) {
  render(
    <BranchEditModal
      branch={branch}
      isRTL={false}
      disabled={false}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe('BranchEditModal — working hours', () => {
  it('saves the loaded schedule on a normal edit', async () => {
    open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalledWith('b1'));
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(config.saveWorkingHours).toHaveBeenCalledWith('b1', OPEN_WEEK));
  });

  it('NEVER writes hours when the read failed — the stored schedule is left alone', async () => {
    // Data loss, not cosmetics. `week` starts as seven closed days; if a failed
    // read is treated as loaded, an admin who opened this modal to fix a phone
    // number silently overwrites the branch's real trading hours with "closed"
    // every day, and nothing tells them it happened.
    config.workingHours.mockRejectedValue(new Error('network'));
    open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(config.saveWorkingHours).not.toHaveBeenCalled());
  });

  it('says the hours could not be loaded rather than showing blanks as truth', async () => {
    config.workingHours.mockRejectedValue(new Error('network'));
    open();
    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
  });

  it('still saves the rest of the branch when the hours read failed', async () => {
    // Hours are supplementary. A failure there must not block fixing an address.
    config.workingHours.mockRejectedValue(new Error('network'));
    const onSave = open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});
