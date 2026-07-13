import { describe, expect, it } from 'vitest';

import { isTerminalOrderStatus, ORDERS_PAGE_LIMIT, RECEIPT_POLL_MS } from './ordersRefresh';
import type { OrderStatus } from '../../types/models';

describe('isTerminalOrderStatus', () => {
  it.each<OrderStatus>(['delivered', 'cancelled'])('%s is terminal (stop polling)', (s) => {
    expect(isTerminalOrderStatus(s)).toBe(true);
  });
  it.each<OrderStatus>(['received', 'preparing', 'ready', 'out_for_delivery'])('%s is live (keep polling)', (s) => {
    expect(isTerminalOrderStatus(s)).toBe(false);
  });
});

describe('refresh constants', () => {
  it('page limit is a small positive page, not an archive fetch', () => {
    expect(ORDERS_PAGE_LIMIT).toBeGreaterThan(0);
    expect(ORDERS_PAGE_LIMIT).toBeLessThanOrEqual(50);
  });
  it('poll interval is gentle (≥15s) so Supabase is never spammed', () => {
    expect(RECEIPT_POLL_MS).toBeGreaterThanOrEqual(15_000);
  });
});
