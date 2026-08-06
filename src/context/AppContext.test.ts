import { describe, it, expect } from 'vitest';
import {
  ORDERS_BUMP_FLOOR_MS, ORDER_STATUS_TRANSITIONS, canTransitionOrder, trimOrderWindow,
} from './AppContext';
import { Order, OrderStatus } from '../types';

describe('ORDER_STATUS_TRANSITIONS', () => {
  it('defines terminal states (delivered, cancelled) with no onward transitions', () => {
    expect(ORDER_STATUS_TRANSITIONS.delivered).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });

  it('only ever targets valid order statuses', () => {
    const valid = new Set(Object.keys(ORDER_STATUS_TRANSITIONS));
    for (const targets of Object.values(ORDER_STATUS_TRANSITIONS)) {
      for (const t of targets) expect(valid.has(t)).toBe(true);
    }
  });
});

describe('canTransitionOrder', () => {
  it('allows the documented forward transitions', () => {
    expect(canTransitionOrder('received', 'preparing')).toBe(true);
    expect(canTransitionOrder('preparing', 'ready')).toBe(true);
    expect(canTransitionOrder('ready', 'out_for_delivery')).toBe(true);
    expect(canTransitionOrder('ready', 'delivered')).toBe(true);
    expect(canTransitionOrder('out_for_delivery', 'delivered')).toBe(true);
  });

  it('allows cancelling from any non-terminal status', () => {
    expect(canTransitionOrder('received', 'cancelled')).toBe(true);
    expect(canTransitionOrder('preparing', 'cancelled')).toBe(true);
    expect(canTransitionOrder('ready', 'cancelled')).toBe(true);
    expect(canTransitionOrder('out_for_delivery', 'cancelled')).toBe(true);
  });

  it('treats a no-op stay on the same status as allowed', () => {
    const statuses: OrderStatus[] = [
      'received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled',
    ];
    for (const s of statuses) expect(canTransitionOrder(s, s)).toBe(true);
  });

  it('rejects skipping a step in the flow', () => {
    expect(canTransitionOrder('received', 'ready')).toBe(false);
    expect(canTransitionOrder('received', 'delivered')).toBe(false);
    expect(canTransitionOrder('preparing', 'out_for_delivery')).toBe(false);
  });

  it('rejects moving backwards', () => {
    expect(canTransitionOrder('preparing', 'received')).toBe(false);
    expect(canTransitionOrder('ready', 'preparing')).toBe(false);
    expect(canTransitionOrder('delivered', 'ready')).toBe(false);
  });

  it('rejects any transition out of a terminal status', () => {
    expect(canTransitionOrder('delivered', 'cancelled')).toBe(false);
    expect(canTransitionOrder('delivered', 'received')).toBe(false);
    expect(canTransitionOrder('cancelled', 'preparing')).toBe(false);
    expect(canTransitionOrder('cancelled', 'delivered')).toBe(false);
  });
});

describe('trimOrderWindow', () => {
  // Newest first, matching the list the poll builds.
  const mk = (i: number, status: OrderStatus): Order => ({
    id: `o${i}`, orderNumber: `SM-${i}`, customerId: 'c1',
    customerName: '', customerPhone: '',
    branchId: 'b1', branchNameEn: '', branchNameAr: '',
    orderType: 'pickup', status, paymentStatus: 'paid', paymentMethod: 'cash',
    items: [], subtotal: 10, deliveryFee: 0, total: 10,
    orderSyncStatus: 'synced',
    // Descending timestamps: index 0 is newest.
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + (1000 - i) * 60_000).toISOString(),
  } as Order);

  it('leaves a list already inside the window untouched', () => {
    const list = [mk(0, 'delivered'), mk(1, 'received')];
    expect(trimOrderWindow(list, 10)).toBe(list);
  });

  it('evicts the OLDEST settled orders once over the limit', () => {
    const list = Array.from({ length: 5 }, (_, i) => mk(i, 'delivered'));
    const trimmed = trimOrderWindow(list, 3);
    expect(trimmed.map(o => o.id)).toEqual(['o0', 'o1', 'o2']);
  });

  it('NEVER evicts an unsettled order, however old', () => {
    // The regression this exists for. A `slice(0, limit)` would drop o9 — the
    // oldest row — even though a customer is still waiting on it, and nothing in
    // the UI could recover it because it would no longer be in the browser.
    const list = [
      ...Array.from({ length: 9 }, (_, i) => mk(i, 'delivered')),
      mk(9, 'preparing'),
    ];
    const trimmed = trimOrderWindow(list, 3);
    expect(trimmed.map(o => o.id)).toEqual(['o0', 'o1', 'o2', 'o9']);
    expect(list.slice(0, 3).map(o => o.id)).not.toContain('o9');   // what slice would have done
  });

  it('keeps every unsettled status, not just a favoured few', () => {
    const unsettled: OrderStatus[] = ['received', 'preparing', 'ready', 'out_for_delivery'];
    const list = [
      ...Array.from({ length: 4 }, (_, i) => mk(i, 'cancelled')),
      ...unsettled.map((s, i) => mk(10 + i, s)),
    ];
    const trimmed = trimOrderWindow(list, 1);
    expect(trimmed.filter(o => unsettled.includes(o.status))).toHaveLength(4);
    expect(trimmed.filter(o => o.status === 'cancelled')).toHaveLength(1);
  });

  it('preserves the newest-first order it was given', () => {
    const list = [mk(0, 'delivered'), mk(1, 'preparing'), mk(2, 'delivered'), mk(3, 'ready')];
    const trimmed = trimOrderWindow(list, 1);
    expect(trimmed.map(o => o.id)).toEqual(['o0', 'o1', 'o3']);
  });
});

describe('the realtime refetch floor', () => {
  it('is a named 3s constant, so a silent change is a visible diff', () => {
    // Every order placed and every status advance writes an order_change_events
    // row. The previous 500ms debounce turned a rush into roughly two full
    // order refetches per second.
    expect(ORDERS_BUMP_FLOOR_MS).toBe(3_000);
  });
});
