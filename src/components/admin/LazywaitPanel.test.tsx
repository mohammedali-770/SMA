// @vitest-environment jsdom
/**
 * Settings → Integrations → Lazywait sync monitor, against a mocked data layer.
 *
 * Two things matter. The monitor asks the server for its 50 rows and renders
 * what comes back, with no client-side window to filter. And because the feed
 * now carries `pos_sync_deadline_at`, a failed order past its POS deadline gets
 * the "window has expired" reason instead of a Retry button the server would
 * refuse. Before 20261009120000 the deadline never reached the browser, so that
 * order showed Retry.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lazywaitMonitor = vi.fn();
const requeueLazywait = vi.fn();

vi.mock('../../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...real,
    orders: {
      lazywaitMonitor: (...a: unknown[]) => lazywaitMonitor(...a),
      requeueLazywait: (...a: unknown[]) => requeueLazywait(...a),
    },
  };
});
vi.mock('./LazywaitCatalogMapping', () => ({ LazywaitCatalogMapping: () => null }));

import { LazywaitPanel } from './LazywaitPanel';

const HOUR = 3_600_000;
const row = (over: Record<string, unknown>) => ({
  id: 'o1',
  order_number: 'SM-2026-000100',
  order_type: 'pickup',
  created_at: new Date().toISOString(),
  lazywait_sync_state: 'failed',
  lazywait_ref: null,
  lazywait_order_number: null,
  sync_attempt_count: 1,
  sync_last_error: 'timeout',
  sync_blocked_reason: null,
  pos_sync_deadline_at: new Date(Date.now() + HOUR).toISOString(),
  pos_create_attempted_at: null,
  ...over,
});

beforeEach(() => {
  lazywaitMonitor.mockReset();
  requeueLazywait.mockReset();
});
afterEach(cleanup);

describe('LazywaitPanel', () => {
  it('asks the server for its 50 rows and renders them as returned', async () => {
    lazywaitMonitor.mockResolvedValue([
      row({ id: 'a', order_number: 'SM-2026-000101' }),
      row({
        id: 'b',
        order_number: 'SM-2026-000102',
        lazywait_sync_state: 'synced',
        lazywait_ref: 'ref-1',
        sync_last_error: null,
      }),
    ]);
    render(<LazywaitPanel disabled={false} />);
    expect(await screen.findByText('SM-2026-000101')).toBeTruthy();
    expect(screen.getByText('SM-2026-000102')).toBeTruthy();
    expect(lazywaitMonitor).toHaveBeenCalledTimes(1);
    expect(lazywaitMonitor).toHaveBeenCalledWith(50);
  });

  it('offers Retry for a failed order inside its POS deadline', async () => {
    lazywaitMonitor.mockResolvedValue([
      row({ pos_sync_deadline_at: new Date(Date.now() + HOUR).toISOString() }),
    ]);
    render(<LazywaitPanel disabled={false} />);
    expect(await screen.findByText('Retry')).toBeTruthy();
  });

  it('shows the expired reason, not Retry, for a failed order past its deadline', async () => {
    lazywaitMonitor.mockResolvedValue([
      row({ pos_sync_deadline_at: new Date(Date.now() - HOUR).toISOString() }),
    ]);
    render(<LazywaitPanel disabled={false} />);
    expect(await screen.findByText(/retry window has expired/i)).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('never offers Retry to an accountant, whose panel is read-only', async () => {
    lazywaitMonitor.mockResolvedValue([row({})]);
    render(<LazywaitPanel disabled />);
    expect(await screen.findByText('SM-2026-000100')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('shows the server error when the feed is refused', async () => {
    lazywaitMonitor.mockRejectedValue(new Error('Only staff may read the Lazywait sync monitor'));
    render(<LazywaitPanel disabled={false} />);
    await waitFor(() => expect(screen.getByText(/Only staff may read/)).toBeTruthy());
  });
});
