import { describe, expect, it } from 'vitest';

import {
  isTerminalOrderStatus, nextReceiptPollMs, ORDERS_PAGE_LIMIT,
  RECEIPT_PENDING_POLL_MS, RECEIPT_PENDING_POLL_WINDOW_MS, RECEIPT_POLL_MS,
} from './ordersRefresh';
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
    expect(nextReceiptPollMs({ ...pending, lazywaitOrderNumber: undefined }, 0)).toBe(RECEIPT_PENDING_POLL_MS);
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
