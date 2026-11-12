// @vitest-environment jsdom
/**
 * Settings → Loyalty totals and ledger, rendered against a mocked data layer.
 *
 * What matters most is the ORDERING case: the console deploys on merge, and the
 * migration adding `admin_loyalty_stats` is a separate owner action. Until it is
 * applied the call fails with PGRST202, and the tiles must say "—" with a reason,
 * never a number, while the ledger keeps working.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stats = vi.fn();
const ledgerPage = vi.fn();
const adjustPoints = vi.fn();

vi.mock('../../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...real,
    loyalty: { stats: () => stats(), adjustPoints: (...a: unknown[]) => adjustPoints(...a) },
    profiles: { loyaltyLedgerPage: (...a: unknown[]) => ledgerPage(...a) },
  };
});

import { LoyaltyLedgerSection } from './LoyaltyLedgerSection';

const customer = (i: number, points = i) => ({
  id: `c${i}`,
  full_name: `Customer ${i}`,
  phone_number: `+96650000${String(i).padStart(4, '0')}`,
  email: null,
  role: 'customer' as const,
  loyalty_points: points,
});

function renderSection(over: Partial<React.ComponentProps<typeof LoyaltyLedgerSection>> = {}) {
  return render(
    <LoyaltyLedgerSection
      adminLang="en"
      discountPerPoint={0.1}
      isAccountant={false}
      pointsLocked={false}
      loyaltyMutationsEnabled
      {...over}
    />,
  );
}

beforeEach(() => {
  stats.mockReset();
  ledgerPage.mockReset();
  adjustPoints.mockReset();
});
afterEach(cleanup);

describe('LoyaltyLedgerSection', () => {
  it('shows the server totals, not a sum of the rows it happens to hold', async () => {
    stats.mockResolvedValue({ member_count: 5000, points_total: 1_000_079 });
    ledgerPage.mockResolvedValue({ rows: [customer(1, 10)], total: 5000 });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('loyalty-tile-members').textContent).toContain('5,000'));
    expect(screen.getByTestId('loyalty-tile-points').textContent).toContain('1,000,079');
    expect(screen.getByTestId('loyalty-tile-value').textContent).toContain('100007.90');
    expect(screen.queryByTestId('loyalty-stats-unavailable')).toBeNull();
  });

  it('BEFORE THE MIGRATION: "—" in every tile, a notice naming it, and the ledger still loads', async () => {
    stats.mockRejectedValue(
      new Error(
        'Could not find the function public.admin_loyalty_stats without parameters in the schema cache',
      ),
    );
    ledgerPage.mockResolvedValue({ rows: [customer(1), customer(2)], total: 2 });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('loyalty-stats-unavailable')).toBeTruthy());
    expect(screen.getByTestId('loyalty-stats-unavailable').textContent).toContain('admin_loyalty_stats');
    for (const id of ['members', 'points', 'value', 'average']) {
      expect(screen.getByTestId(`loyalty-tile-${id}`).textContent).toContain('—');
      expect(screen.getByTestId(`loyalty-tile-${id}`).textContent).not.toMatch(/\d/);
    }
    await waitFor(() => expect(screen.getByText('Customer 1')).toBeTruthy());
    expect(screen.getByText('Customer 2')).toBeTruthy();
  });

  it('any other stats failure is "—" with a generic notice', async () => {
    stats.mockRejectedValue(new Error('network down'));
    ledgerPage.mockResolvedValue({ rows: [], total: 0 });
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('loyalty-stats-unavailable').textContent).toBe(
        'Loyalty totals are not available.',
      ),
    );
    expect(screen.getByTestId('loyalty-tile-members').textContent).toContain('—');
  });

  it('says so when there are no customers', async () => {
    stats.mockResolvedValue({ member_count: 0, points_total: 0 });
    ledgerPage.mockResolvedValue({ rows: [], total: 0 });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('loyalty-ledger-empty')).toBeTruthy());
    expect(screen.queryByText('Show more')).toBeNull();
  });

  it('pages 50 at a time with "Show more", and stops at the total', async () => {
    stats.mockResolvedValue({ member_count: 60, points_total: 0 });
    const all = Array.from({ length: 60 }, (_, i) => customer(i + 1));
    ledgerPage.mockImplementation(async (from: number, size: number) => ({
      rows: all.slice(from, from + size),
      total: 60,
    }));
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('loyalty-ledger-count').textContent).toBe('Showing 50 of 60'),
    );
    expect(ledgerPage).toHaveBeenLastCalledWith(0, 50);
    fireEvent.click(screen.getByText('Show more'));
    await waitFor(() =>
      expect(screen.getByTestId('loyalty-ledger-count').textContent).toBe('Showing 60 of 60'),
    );
    expect(ledgerPage).toHaveBeenLastCalledWith(50, 50);
    expect(screen.queryByText('Show more')).toBeNull();
    expect(screen.getByText('Customer 60')).toBeTruthy();
  });

  it('adjusts by the delta from the row it shows, then re-reads the totals', async () => {
    stats.mockResolvedValueOnce({ member_count: 1, points_total: 120 });
    stats.mockResolvedValueOnce({ member_count: 1, points_total: 170 });
    ledgerPage.mockResolvedValue({ rows: [customer(1, 120)], total: 1 });
    adjustPoints.mockResolvedValue(customer(1, 170));
    renderSection();
    await waitFor(() => expect(screen.getByText('Customer 1')).toBeTruthy());
    fireEvent.click(screen.getByText('+50'));
    await waitFor(() => expect(screen.getByTestId('loyalty-tile-points').textContent).toContain('170'));
    expect(adjustPoints).toHaveBeenCalledWith('c1', 50);
    expect(stats).toHaveBeenCalledTimes(2);
  });

  it('renders the Arabic strings for the new states', async () => {
    stats.mockRejectedValue(new Error('PGRST202'));
    ledgerPage.mockResolvedValue({ rows: [], total: 0 });
    renderSection({ adminLang: 'ar' });
    await waitFor(() =>
      expect(screen.getByTestId('loyalty-stats-unavailable').textContent).toContain('ترحيل'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('loyalty-ledger-empty').textContent).toBe('لا يوجد عملاء بعد.'),
    );
  });
});
