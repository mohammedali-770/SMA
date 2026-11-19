import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isTerminalOrderStatus,
  nextReceiptPollMs,
  ORDERS_PAGE_LIMIT,
  RECEIPT_AWAIT_LOAD_MS,
  RECEIPT_PENDING_POLL_MS,
  RECEIPT_PENDING_POLL_WINDOW_MS,
  RECEIPT_POLL_MS,
  startReceiptPolling,
} from './ordersRefresh';
import type { OrderStatus } from '../../types/models';

describe('isTerminalOrderStatus', () => {
  it.each<OrderStatus>(['delivered', 'cancelled'])('%s is terminal (stop polling)', (s) => {
    expect(isTerminalOrderStatus(s)).toBe(true);
  });
  it.each<OrderStatus>(['received', 'preparing', 'ready', 'out_for_delivery'])(
    '%s is live (keep polling)',
    (s) => {
      expect(isTerminalOrderStatus(s)).toBe(false);
    },
  );
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

describe('nextReceiptPollMs — waiting for the branch number', () => {
  const pending = { status: 'received' as const, lazywaitOrderNumber: null };
  const numbered = { status: 'received' as const, lazywaitOrderNumber: '#12' };

  it('polls FAST while the branch number has not arrived', () => {
    // order-intake stops waiting for the POS at 5 s, so a slow Create Order
    // call (8.02 s measured) lands the customer on a receipt with no number.
    // The pos_confirmed push is data-free and only navigates when tapped, so
    // this poll is what actually fills it in.
    expect(nextReceiptPollMs(pending, 0)).toBe(RECEIPT_PENDING_POLL_MS);
    expect(nextReceiptPollMs(pending, 10_000)).toBe(RECEIPT_PENDING_POLL_MS);
  });

  it('drops back to the normal interval once the number is there', () => {
    expect(nextReceiptPollMs(numbered, 0)).toBe(RECEIPT_POLL_MS);
  });

  it('treats blank and whitespace-only as still pending', () => {
    expect(nextReceiptPollMs({ ...pending, lazywaitOrderNumber: '' }, 0)).toBe(RECEIPT_PENDING_POLL_MS);
    expect(nextReceiptPollMs({ ...pending, lazywaitOrderNumber: '   ' }, 0)).toBe(RECEIPT_PENDING_POLL_MS);
    expect(nextReceiptPollMs({ ...pending, lazywaitOrderNumber: undefined }, 0)).toBe(
      RECEIPT_PENDING_POLL_MS,
    );
  });

  it('BOUNDS the fast phase, so a number that never comes is not polled for ever', () => {
    expect(nextReceiptPollMs(pending, RECEIPT_PENDING_POLL_WINDOW_MS - 1)).toBe(RECEIPT_PENDING_POLL_MS);
    expect(nextReceiptPollMs(pending, RECEIPT_PENDING_POLL_WINDOW_MS)).toBe(RECEIPT_POLL_MS);
    expect(nextReceiptPollMs(pending, 10 * 60_000)).toBe(RECEIPT_POLL_MS);
  });

  it('stops entirely on a terminal order, pending number or not', () => {
    expect(nextReceiptPollMs({ status: 'delivered', lazywaitOrderNumber: null }, 0)).toBeNull();
    expect(nextReceiptPollMs({ status: 'cancelled', lazywaitOrderNumber: '#12' }, 0)).toBeNull();
  });

  it('the fast poll is meaningfully faster than the slow one', () => {
    // Guards the pair against being "tidied" into the same value.
    expect(RECEIPT_PENDING_POLL_MS).toBeLessThan(RECEIPT_POLL_MS / 5);
  });
});

// 2026-11-18, SM-2026-000103: the number reached the database in 5.5 s and the
// receipt never showed it, because the poll returned early when the order had
// not loaded yet and nothing started it again.
describe('startReceiptPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type O = { status: OrderStatus; lazywaitOrderNumber?: string | null };

  it('polls an order that loads AFTER the loop started', () => {
    let order: O | null = null;
    const refresh = vi.fn();
    const stop = startReceiptPolling({ getOrder: () => order, refresh });

    vi.advanceTimersByTime(1_000); // still loading: nothing to refresh
    expect(refresh).not.toHaveBeenCalled();

    order = { status: 'received', lazywaitOrderNumber: null }; // first load lands
    vi.advanceTimersByTime(RECEIPT_AWAIT_LOAD_MS + RECEIPT_PENDING_POLL_MS + 10);
    expect(refresh).toHaveBeenCalled();
    stop();
  });

  it('refreshes every 2 s while the number is missing, then relaxes once it arrives', () => {
    let order: O = { status: 'received', lazywaitOrderNumber: null };
    const refresh = vi.fn(() => {
      if (refresh.mock.calls.length === 3) order = { status: 'received', lazywaitOrderNumber: '#7' };
    });
    const stop = startReceiptPolling({ getOrder: () => order, refresh });
    vi.advanceTimersByTime(3 * RECEIPT_PENDING_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(RECEIPT_POLL_MS - 1); // now on the slow interval
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(4);
    stop();
  });

  it('never refreshes a terminal order, and stops for good after stop()', () => {
    const refreshA = vi.fn();
    startReceiptPolling({ getOrder: () => ({ status: 'delivered' }), refresh: refreshA });
    vi.advanceTimersByTime(120_000);
    expect(refreshA).not.toHaveBeenCalled();

    const refreshB = vi.fn();
    const stop = startReceiptPolling({ getOrder: () => ({ status: 'received' }), refresh: refreshB });
    vi.advanceTimersByTime(RECEIPT_PENDING_POLL_MS);
    expect(refreshB).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(120_000);
    expect(refreshB).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when the order turned terminal while the timer was pending', () => {
    let order: O = { status: 'received', lazywaitOrderNumber: null };
    const refresh = vi.fn();
    const stop = startReceiptPolling({ getOrder: () => order, refresh });
    order = { status: 'cancelled' }; // e.g. set by a resend's own re-read
    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it('does not re-arm when stop() is called from inside a refresh', () => {
    const refresh = vi.fn();
    const stop = startReceiptPolling({ getOrder: () => ({ status: 'received' as OrderStatus }), refresh });
    refresh.mockImplementation(() => stop());
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a load that never lands costs no network: it only looks, then slows down', () => {
    const refresh = vi.fn();
    const getOrder = vi.fn(() => null);
    const stop = startReceiptPolling({ getOrder, refresh });
    vi.advanceTimersByTime(RECEIPT_PENDING_POLL_WINDOW_MS + 2 * RECEIPT_POLL_MS);
    expect(refresh).not.toHaveBeenCalled();
    const looksInWindow = Math.floor(RECEIPT_PENDING_POLL_WINDOW_MS / RECEIPT_AWAIT_LOAD_MS);
    expect(getOrder.mock.calls.length).toBeLessThan(2 * looksInWindow + 20);
    stop();
  });
});
