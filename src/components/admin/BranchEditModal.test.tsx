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
    fireEvent.change(screen.getByLabelText(/^Phone/i), { target: { value: 'phone-two' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});

describe('BranchEditModal — numeric fields keep what was typed (F-WAD-01-003)', () => {
  const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;

  it('does not drop a trailing zero while a fee is being typed', async () => {
    open();
    const fee = field(/Delivery fee/i);
    fireEvent.change(fee, { target: { value: '10.0' } });
    // The old state was a number round-tripped through parseFloat, so the box
    // was rewritten to "10" and the next digit landed one place wrong.
    expect(fee.value).toBe('10.0');
    fireEvent.change(fee, { target: { value: '10.05' } });
    expect(fee.value).toBe('10.05');
  });

  it('does not drop a trailing zero while a coordinate is being typed', async () => {
    open();
    const lat = field(/Latitude/i);
    fireEvent.change(lat, { target: { value: '24.70' } });
    expect(lat.value).toBe('24.70');
  });

  it('lets a field be cleared without turning it into 0', async () => {
    open();
    const min = field(/Delivery minimum/i);
    fireEvent.change(min, { target: { value: '' } });
    expect(min.value).toBe('');
  });

  it('saves 10.05 as 10.05', async () => {
    const onSave = open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.change(field(/Delivery fee/i), { target: { value: '10.0' } });
    fireEvent.change(field(/Delivery fee/i), { target: { value: '10.05' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].deliveryFee).toBe(10.05);
  });

  it('refuses a blank or non-numeric fee instead of saving 0', async () => {
    const onSave = open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.change(field(/Delivery fee/i), { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    expect(await screen.findByText(/must be a number/i)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a pin with only one coordinate', async () => {
    const onSave = open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.change(field(/Longitude/i), { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    expect(await screen.findByText(/both latitude and longitude/i)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('BranchEditModal — sends only what was changed (F-WAD-01-002)', () => {
  it('a phone edit does not carry the fee, the pin or the open/closed state', async () => {
    const onSave = open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/^Phone/i), { target: { value: 'phone-one' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Everything else on the branch may have been changed by someone else while
    // this modal was open; writing it back would undo that.
    expect(onSave.mock.calls[0][0]).toEqual({ phone: 'phone-one' });
  });

  it('a toggle edit sends that toggle alone', async () => {
    const onSave = open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Pickup/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ pickupEnabled: false });
  });

  it('an hours-only edit writes the hours and does not write an empty branch patch', async () => {
    const onSave = open();
    await waitFor(() => expect(config.workingHours).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(config.saveWorkingHours).toHaveBeenCalled());
    expect(onSave).not.toHaveBeenCalled();
  });
});
