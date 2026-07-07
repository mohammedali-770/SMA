import { describe, it, expect } from 'vitest';
import { canTransitionOrder, ORDER_STATUS_TRANSITIONS } from './AppContext';
import { OrderStatus } from '../types';

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
