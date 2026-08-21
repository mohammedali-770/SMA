import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_ORDER_COLUMNS, CUSTOMER_ORDER_ITEM_COLUMNS, CUSTOMER_ORDER_MODIFIER_COLUMNS,
  CUSTOMER_ORDER_SELECT, CUSTOMER_ORDER_SELECT_FROM_COLUMNS, INTERNAL_ONLY_ORDER_COLUMNS,
} from './orderSelect';
import { mapOrder } from './mappers';
import type { DbOrderWithItems } from '../types/db';

/**
 * RESPONSE CONTRACT (Issue #94): the internal `SM-…` order number and every
 * internal-only column must be absent from what a customer client fetches and
 * from the mapped object the app holds. These assertions fail loudly if anyone
 * reintroduces `select('*')` or re-adds an internal field to the mapper.
 */

describe('customer order select — no internal columns', () => {
  it('never uses a wildcard select', () => {
    expect(CUSTOMER_ORDER_SELECT).not.toContain('*');
  });

  it('the literal used at runtime matches the audited column arrays', () => {
    // The literal exists so supabase-js can infer the row type; this pins it to
    // the arrays the rest of this suite audits, so the two cannot drift.
    expect(CUSTOMER_ORDER_SELECT).toBe(CUSTOMER_ORDER_SELECT_FROM_COLUMNS);
  });

  it('does not request the internal SM-… order number', () => {
    // Word-boundary match so `lazywait_order_number` (which IS customer-visible)
    // does not mask a bare `order_number`.
    expect(/(^|[^_a-z])order_number\b/.test(CUSTOMER_ORDER_SELECT)).toBe(false);
    expect(CUSTOMER_ORDER_COLUMNS).not.toContain('order_number');
  });

  it('requests no internal-only column at all', () => {
    for (const col of INTERNAL_ONLY_ORDER_COLUMNS) {
      expect(CUSTOMER_ORDER_COLUMNS as readonly string[], col).not.toContain(col);
      expect(new RegExp(`(^|[^_a-z])${col}\\b`).test(CUSTOMER_ORDER_SELECT), col).toBe(false);
    }
  });

  it('never exposes the POS create-attempt fencing token', () => {
    // Called out separately: it is server-only fencing metadata, and the old
    // `select('*')` shipped it to every customer device.
    expect(CUSTOMER_ORDER_SELECT).not.toContain('pos_create_attempt_token');
  });

  it('still requests everything the UI and state machine need', () => {
    for (const needed of [
      'id', 'status', 'order_type', 'total', 'created_at',
      'payment_status', 'payment_method',
      'lazywait_order_number', 'lazywait_sync_state', 'lazywait_ref',
      'sync_blocked_reason', 'sync_next_attempt_at',
      'pos_create_attempted_at', 'pos_customer_retry_count', 'refund_state',
      'notes',
    ]) {
      expect(CUSTOMER_ORDER_COLUMNS as readonly string[], needed).toContain(needed);
    }
    expect(CUSTOMER_ORDER_SELECT).toContain('order_items(');
    expect(CUSTOMER_ORDER_SELECT).toContain('order_item_modifiers(');
  });

  it('keeps line-item projections minimal', () => {
    expect(CUSTOMER_ORDER_ITEM_COLUMNS as readonly string[]).not.toContain('order_id');
    expect(CUSTOMER_ORDER_ITEM_COLUMNS as readonly string[]).not.toContain('product_id');
    expect(CUSTOMER_ORDER_MODIFIER_COLUMNS as readonly string[]).not.toContain('order_item_id');
    expect(CUSTOMER_ORDER_MODIFIER_COLUMNS as readonly string[]).not.toContain('modifier_id');
  });
});

describe('mapOrder — mapped object carries nothing internal', () => {
  // A row shaped like the WORST case: the server somehow returned everything.
  // The mapper must still not surface any internal field.
  const hostileRow = {
    id: 'o1',
    order_number: 'SM-2026-000027',
    customer_id: 'c1', customer_name: 'Real Name', customer_phone: '+966500000000',
    branch_id: 'b1', branch_name_en: 'B', branch_name_ar: 'ب',
    status: 'received', order_type: 'pickup',
    subtotal: 10, delivery_fee: 0, discount_amount: 0, loyalty_discount_amount: 0,
    vat_amount: 1, total: 10,
    loyalty_points_earned: 1, loyalty_points_redeemed: 5,
    payment_status: 'paid', payment_method: 'online',
    payment_provider: 'tap', paid_at: '2026-07-24T00:00:00Z',
    coupon_code: 'SECRET10', notes: 'extra spicy, no onion',
    created_at: '2026-07-24T00:00:00Z',
    lazywait_order_number: '#42', lazywait_sync_state: 'synced', lazywait_ref: '#42',
    sync_blocked_reason: null, sync_next_attempt_at: null,
    pos_create_attempted_at: null, pos_customer_retry_count: 0, refund_state: 'none',
    pos_create_attempt_token: 'TOKEN-SHOULD-NEVER-APPEAR',
    address_snapshot: { label: 'home' },
    order_items: [],
  } as unknown as DbOrderWithItems;

  const mapped = mapOrder(hostileRow);
  const serialized = JSON.stringify(mapped);

  it('drops the internal order number', () => {
    expect(Object.keys(mapped)).not.toContain('orderNumber');
    expect(serialized).not.toContain('SM-2026-000027');
  });

  it('drops the fencing token', () => {
    expect(serialized).not.toContain('TOKEN-SHOULD-NEVER-APPEAR');
  });

  it('drops customer-identity copies, the coupon code and the address snapshot', () => {
    for (const k of ['customerId', 'customerName', 'customerPhone', 'couponCode', 'address']) {
      expect(Object.keys(mapped), k).not.toContain(k);
    }
    expect(serialized).not.toContain('Real Name');
    expect(serialized).not.toContain('SECRET10');
  });

  /**
   * `notes` is the one column deliberately moved OUT of the internal set. It is
   * the customer's own kitchen note on their own RLS-scoped order, and the
   * receipt shows it back to them so they can check what the kitchen was told.
   * Everything else in the hostile row stays dropped, which the assertions
   * above still prove.
   */
  it('carries the customer their own kitchen note', () => {
    expect(mapped.notes).toBe('extra spicy, no onion');
  });

  it('treats a blank note as no note rather than an empty line', () => {
    expect(mapOrder({ ...hostileRow, notes: '   ' } as unknown as DbOrderWithItems).notes).toBeUndefined();
    expect(mapOrder({ ...hostileRow, notes: null } as unknown as DbOrderWithItems).notes).toBeUndefined();
  });

  it('keeps exactly what the receipt and state machine need', () => {
    expect(mapped.lazywaitOrderNumber).toBe('#42');
    expect(mapped.total).toBe(10);
    expect(mapped.paymentStatus).toBe('paid');
    expect(mapped.refundState).toBe('none');
  });
});
