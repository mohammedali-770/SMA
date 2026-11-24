// @vitest-environment jsdom
/**
 * Push Tools' device counts, against a mocked data layer. The counts come from
 * `customer_push_device_counts()` (20261010120000). The line that matters is
 * the broadcast confirmation, "Send now to N device(s)": if the counts fail,
 * the panel must show no number at all, never a zero that misstates who a
 * broadcast reaches.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deviceCounts = vi.fn();
const broadcast = vi.fn();

vi.mock('../../context/AppContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../context/AppContext')>();
  return { ...real, useApp: () => ({ adminLang: 'en' }) };
});
vi.mock('../../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...real,
    pushAdmin: { deviceCounts: () => deviceCounts(), test: vi.fn(), broadcast: (f: unknown) => broadcast(f) },
  };
});

import { PushToolsPanel } from './PushToolsPanel';

beforeEach(() => {
  deviceCounts.mockReset();
  broadcast.mockReset();
});
afterEach(cleanup);

describe('PushToolsPanel device counts', () => {
  it('shows both counts from the server', async () => {
    deviceCounts.mockResolvedValue({ activeDevices: 11, promoOptIns: 7 });
    render(<PushToolsPanel disabled={false} />);
    expect(await screen.findByText('Active devices: 11')).toBeTruthy();
    expect(screen.getByText('Promotions on: 7')).toBeTruthy();
  });

  it('shows no number when the counts are refused, rather than zero', async () => {
    deviceCounts.mockRejectedValue(new Error('Only admins may read push device counts'));
    render(<PushToolsPanel disabled={false} />);
    await waitFor(() => expect(deviceCounts).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Active devices:/)).toBeNull();
    expect(screen.queryByText(/Promotions on:/)).toBeNull();
  });
});

describe('PushToolsPanel accountant view', () => {
  it('does not ask for the counts when the panel is read-only, since the RPC refuses it', async () => {
    deviceCounts.mockRejectedValue(new Error('refused'));
    render(<PushToolsPanel disabled />);
    await act(async () => { await Promise.resolve(); });
    expect(deviceCounts).not.toHaveBeenCalled();
  });
});

describe('PushToolsPanel broadcast confirm (F-X08-005)', () => {
  const fill = () => {
    const set = (label: string, v: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
    set('Title (English)', 'Sale');
    set('Title (Arabic)', 'عرض');
    set('Body (English)', 'Half price today');
    set('Body (Arabic)', 'نصف السعر اليوم');
  };
  const openConfirm = () => fireEvent.click(screen.getByText('Broadcast promotion…'));

  it('re-reads the count when the confirm opens and quotes the fresh number', async () => {
    deviceCounts.mockResolvedValueOnce({ activeDevices: 10, promoOptIns: 4 });
    render(<PushToolsPanel disabled={false} />);
    await screen.findByText('Promotions on: 4');
    fill();
    deviceCounts.mockResolvedValueOnce({ activeDevices: 30, promoOptIns: 25 });
    openConfirm();
    expect(await screen.findByText('Send now to 25 device(s) with promotions on?')).toBeTruthy();
    expect(deviceCounts).toHaveBeenCalledTimes(2);
  });

  it('keeps Confirm disabled while the count is loading', async () => {
    deviceCounts.mockResolvedValueOnce({ activeDevices: 10, promoOptIns: 4 });
    render(<PushToolsPanel disabled={false} />);
    await screen.findByText('Promotions on: 4');
    fill();
    deviceCounts.mockReturnValueOnce(new Promise(() => {}));
    openConfirm();
    expect(screen.getByText(/Checking how many devices/)).toBeTruthy();
    const confirm = screen.getByText('Confirm send').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('refuses the send when the count failed, even if an older count was on screen', async () => {
    deviceCounts.mockResolvedValueOnce({ activeDevices: 10, promoOptIns: 4 });
    render(<PushToolsPanel disabled={false} />);
    await screen.findByText('Promotions on: 4');
    fill();
    deviceCounts.mockRejectedValueOnce(new Error('network'));
    openConfirm();
    expect(await screen.findByText(/sending is blocked/)).toBeTruthy();
    expect(screen.queryByText(/Send now to/)).toBeNull();
    const confirm = screen.getByText('Confirm send').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('Try again re-reads the count and unblocks the send once it loads', async () => {
    deviceCounts.mockResolvedValueOnce({ activeDevices: 10, promoOptIns: 4 });
    render(<PushToolsPanel disabled={false} />);
    await screen.findByText('Promotions on: 4');
    fill();
    deviceCounts.mockRejectedValueOnce(new Error('network'));
    openConfirm();
    await screen.findByText(/sending is blocked/);
    deviceCounts.mockResolvedValueOnce({ activeDevices: 10, promoOptIns: 6 });
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText('Send now to 6 device(s) with promotions on?')).toBeTruthy();
    const confirm = screen.getByText('Confirm send').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it('ignores a slow answer to a confirm that was cancelled', async () => {
    deviceCounts.mockResolvedValueOnce({ activeDevices: 10, promoOptIns: 4 });
    render(<PushToolsPanel disabled={false} />);
    await screen.findByText('Promotions on: 4');
    fill();
    let late: (v: { activeDevices: number; promoOptIns: number }) => void = () => {};
    deviceCounts.mockReturnValueOnce(new Promise((r) => { late = r; }));
    openConfirm();
    fireEvent.click(screen.getByText('Cancel'));
    deviceCounts.mockReturnValueOnce(new Promise(() => {}));
    openConfirm();
    await act(async () => { late({ activeDevices: 99, promoOptIns: 99 }); });
    expect(screen.queryByText(/Send now to 99/)).toBeNull();
    const confirm = screen.getByText('Confirm send').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('clears the form after a successful send, so the next click cannot re-send it', async () => {
    deviceCounts.mockResolvedValue({ activeDevices: 10, promoOptIns: 4 });
    broadcast.mockResolvedValue({ status: 'ok', targeted: 4, sent: 4, failed: 0, deactivated: 0 });
    render(<PushToolsPanel disabled={false} />);
    await screen.findByText('Promotions on: 4');
    fill();
    openConfirm();
    await screen.findByText('Send now to 4 device(s) with promotions on?');
    fireEvent.click(screen.getByText('Confirm send'));
    await screen.findByText(/Result: targeted 4/);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Title (English)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Body (Arabic)') as HTMLInputElement).value).toBe('');
    const again = screen.getByText('Broadcast promotion…').closest('button') as HTMLButtonElement;
    expect(again.disabled).toBe(true);
  });

  it('keeps the text when the send did not go out (disabled integration or a thrown error)', async () => {
    deviceCounts.mockResolvedValue({ activeDevices: 10, promoOptIns: 4 });
    broadcast.mockResolvedValueOnce({ status: 'disabled', reason: 'push integration disabled' });
    render(<PushToolsPanel disabled={false} />);
    await screen.findByText('Promotions on: 4');
    fill();
    openConfirm();
    await screen.findByText('Send now to 4 device(s) with promotions on?');
    fireEvent.click(screen.getByText('Confirm send'));
    await screen.findByText(/push integration disabled/);
    expect((screen.getByLabelText('Title (English)') as HTMLInputElement).value).toBe('Sale');

    broadcast.mockRejectedValueOnce(new Error('boom'));
    openConfirm();
    await screen.findByText('Send now to 4 device(s) with promotions on?');
    fireEvent.click(screen.getByText('Confirm send'));
    await screen.findByText('boom');
    expect((screen.getByLabelText('Title (English)') as HTMLInputElement).value).toBe('Sale');
  });
});
