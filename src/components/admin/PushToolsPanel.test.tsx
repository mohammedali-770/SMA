// @vitest-environment jsdom
/**
 * Push Tools' device counts, against a mocked data layer. The counts come from
 * `customer_push_device_counts()` (20261010120000). The line that matters is
 * the broadcast confirmation, "Send now to N device(s)": if the counts fail,
 * the panel must show no number at all, never a zero that misstates who a
 * broadcast reaches.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deviceCounts = vi.fn();

vi.mock('../../context/AppContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../context/AppContext')>();
  return { ...real, useApp: () => ({ adminLang: 'en' }) };
});
vi.mock('../../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...real,
    pushAdmin: { deviceCounts: () => deviceCounts(), test: vi.fn(), broadcast: vi.fn() },
  };
});

import { PushToolsPanel } from './PushToolsPanel';

beforeEach(() => {
  deviceCounts.mockReset();
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
