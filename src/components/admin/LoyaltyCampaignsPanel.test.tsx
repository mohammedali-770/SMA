// @vitest-environment jsdom
/**
 * The campaign list's dates are Riyadh calendar dates.
 *
 * PostgREST returns timestamptz in the database session zone, which is UTC in
 * Production. The list sliced that string, so a campaign starting at midnight
 * in Riyadh — 21:00 UTC the day before — was listed as starting the day
 * before, and an operator checking "does double points start on Friday?" read
 * Thursday. Only the network call is mocked; the panel renders for real.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoyaltyCampaign } from '../../lib/loyaltyCampaignsApi';

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../lib/loyaltyCampaignsApi', () => ({ loyaltyCampaigns: api }));
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => ({ branches: [], categories: [], products: [] }),
}));

import { LoyaltyCampaignsPanel } from './LoyaltyCampaignsPanel';

const campaign = (over: Partial<LoyaltyCampaign> = {}): LoyaltyCampaign => ({
  id: 'm1',
  name_en: 'Double points',
  name_ar: 'نقاط مضاعفة',
  multiplier: 2,
  starts_at: null,
  ends_at: null,
  branch_id: null,
  product_id: null,
  category_id: null,
  is_active: true,
  created_at: '2026-11-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('LoyaltyCampaignsPanel — the dates in the list', () => {
  it('shows the Riyadh calendar date at both ends of the window', async () => {
    api.list.mockResolvedValue([
      campaign({
        // 00:00 on Friday 4 December and 23:59 on Saturday 5 December, Riyadh.
        starts_at: '2026-12-03T21:00:00+00:00',
        ends_at: '2026-12-05T20:59:00+00:00',
      }),
    ]);
    render(<LoyaltyCampaignsPanel isRTL={false} readOnly />);
    expect(await screen.findByText('Double points')).toBeTruthy();
    // The UTC slice read "2026-12-03 → 2026-12-05".
    expect(screen.getByText('2026-12-04 → 2026-12-05')).toBeTruthy();
  });

  it('keeps the dash for an open end', async () => {
    api.list.mockResolvedValue([campaign({ starts_at: '2026-12-03T21:00:00+00:00' })]);
    render(<LoyaltyCampaignsPanel isRTL={false} readOnly />);
    await screen.findByText('Double points');
    expect(screen.getByText('2026-12-04 → —')).toBeTruthy();
  });
});
