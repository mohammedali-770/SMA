// @vitest-environment jsdom
/**
 * The console's dates and times, rendered by the screens that show them.
 *
 * Each of these used the DEVICE's zone and locale: `toLocaleDateString()` on a
 * banner row, `toLocaleTimeString()` on the live badge and its hover title, and
 * `toLocaleString('ar', …)` on the POS-verification card, and `toLocaleString()`
 * on the Lazywait mapping card's "Last pull" line. An owner abroad read
 * 21:30 for a 00:30 Riyadh event, and the Arabic console got Arabic-Indic
 * digits beside Latin-digit prices (assessment, 2026-11-11).
 *
 * Every case runs in Europe/London with the Arabic console, the combination
 * that showed both faults at once. Node re-reads TZ when it is assigned.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ordersApi = vi.hoisted(() => ({ posConfirmationRequired: vi.fn() }));
const catalogApi = vi.hoisted(() => ({
  branches: vi.fn(),
  categories: vi.fn(),
  products: vi.fn(),
  modifierGroups: vi.fn(),
  modifiers: vi.fn(),
}));
const lazywaitCatalogApi = vi.hoisted(() => ({ items: vi.fn(), status: vi.fn() }));
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  orders: ordersApi,
  catalog: catalogApi,
  lazywaitCatalog: lazywaitCatalogApi,
}));

import type { DbHomepageBanner } from '../../../lib/api';
import { LazywaitCatalogMapping } from '../LazywaitCatalogMapping';
import { BannerRow } from './banners/BannerRow';
import { LiveModeBadge } from './LiveModeBadge';
import { OrdersRequiringVerificationCard } from './orders/OrdersRequiringVerificationCard';

/** Latin digits, and nothing from the Arabic-Indic or extended Arabic-Indic ranges. */
const NO_ARABIC_DIGITS = /^[^\u0660-\u0669\u06F0-\u06F9]*$/;

let zoneBefore: string | undefined;
beforeEach(() => {
  zoneBefore = process.env.TZ;
  process.env.TZ = 'Europe/London';
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  if (zoneBefore === undefined) delete process.env.TZ;
  else process.env.TZ = zoneBefore;
});

const banner = (over: Partial<DbHomepageBanner> = {}): DbHomepageBanner => ({
  id: 'b1',
  title_en: 'Winter offer',
  title_ar: 'عرض الشتاء',
  image_url: 'https://example.test/banner.jpg',
  storage_path: null,
  is_active: true,
  sort_order: 1,
  starts_at: null,
  ends_at: null,
  action_type: 'none',
  action_value: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  updated_by: null,
  ...over,
});

describe('a banner row shows its window as Riyadh calendar dates', () => {
  it('puts a banner scheduled for midnight Riyadh on the right day', () => {
    const { container } = render(
      <BannerRow
        // 00:00 on 1 December 2026 and 00:00 on 1 January 2027, Riyadh. Both
        // fall on the previous day in UTC, so a UTC slice of either string is
        // caught as well as the device's own date. (Review found the first
        // version of this fixture ending at 23:59 Riyadh, the same day in UTC,
        // where a slice of ends_at passed.)
        banner={banner({ starts_at: '2026-11-30T21:00:00Z', ends_at: '2026-12-31T21:00:00Z' })}
        live={false}
        busy={false}
        canEdit={false}
        isRTL
        onMove={() => {}}
        onToggleActive={() => {}}
        onDelete={() => {}}
      />,
    );
    const text = container.textContent ?? '';
    // The device's own date read 30/11/2026 here: London is still on 30 November.
    expect(text).toContain('من 2026-12-01');
    expect(text).toContain('إلى 2027-01-01');
    expect(text).not.toContain('2026-12-31');
    expect(text).toMatch(NO_ARABIC_DIGITS);
  });
});

describe('the live badge stamps the last refresh in Riyadh time', () => {
  it('shows the same Riyadh time on the badge and in its hover title', () => {
    render(<LiveModeBadge mode="polling" lastUpdated={Date.parse('2026-11-11T21:30:05Z')} lang="ar" />);
    // The badge said 21:30:05 in London, and its title used the device locale.
    const stamp = screen.getByText('00:30:05');
    expect(stamp.closest('[title]')?.getAttribute('title')).toBe('آخر تحديث 00:30:05');
  });

  it('shows no stamp before the first refresh', () => {
    const { container } = render(<LiveModeBadge mode="realtime" lastUpdated={null} lang="ar" />);
    expect(container.querySelector('[title]')).toBeNull();
    expect(container.textContent).toBe('مباشر');
  });
});

describe('the POS-verification card says when an order started waiting, in Riyadh time', () => {
  it('uses the Riyadh clock and Latin digits in the Arabic console', async () => {
    ordersApi.posConfirmationRequired.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'o1',
          order_number: 'SM-2026-000123',
          order_type: 'pickup',
          total: 42,
          created_at: '2026-11-11T21:29:00Z',
          pos_sync_started_at: '2026-11-11T21:29:30Z',
          first_pos_sync_failure_at: '2026-11-11T21:30:00Z',
          reason: 'timeout',
        },
      ],
    });
    render(<OrdersRequiringVerificationCard adminLang="ar" onView={() => {}} />);
    // It read 9:30 PM on 11 November — London's clock — in Arabic-Indic digits.
    const line = await screen.findByText(/بالانتظار منذ/);
    expect(line.textContent).toContain('بالانتظار منذ 2026-11-12 00:30');
    expect(line.textContent).toMatch(NO_ARABIC_DIGITS);
  });
});

describe('the Lazywait mapping card says when the catalog was last pulled, in Riyadh time', () => {
  it('shows the Riyadh clock, not the device zone and not the UTC string', async () => {
    for (const fn of Object.values(catalogApi)) fn.mockResolvedValue([]);
    lazywaitCatalogApi.items.mockResolvedValue([]);
    const count = { total: 0, mapped: 0 };
    lazywaitCatalogApi.status.mockResolvedValue({
      branches: count,
      categories: count,
      products: count,
      modifier_groups: count,
      modifiers: count,
      blocked_orders: 0,
      secrets_configured: true,
      // 00:30:05 on 12 November in Riyadh; 21:30:05 on the 11th in London and UTC.
      last_pull_at: '2026-11-11T21:30:05Z',
      readiness: {
        secrets: true,
        branch_mapped: false,
        active_products_mapped: false,
        no_blocked_orders: true,
        ready: false,
      },
    });
    render(<LazywaitCatalogMapping disabled />);
    // It read "Last pull 11/11/2026, 21:30:05" here, London's clock. A
    // regression to the UTC string would read 2026-11-11 and 21:30.
    const line = await screen.findByText(/^Last pull /);
    expect(line.textContent).toBe('Last pull 2026-11-12 00:30:05');
  });
});
