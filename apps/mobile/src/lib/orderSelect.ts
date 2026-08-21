/**
 * The customer-safe column list for reads of `public.orders` (Issue #94).
 *
 * WHY THIS EXISTS. The customer app used `select('*')`, which shipped the entire
 * order row to the device — including the internal `SM-…` order number and
 * operational columns that are explicitly internal, most notably
 * `pos_create_attempt_token` (the Create-Order fencing token, documented as
 * "internal operational metadata — never logged"). RLS scoped those rows to
 * their owner, so this was never a cross-customer leak, but none of it belongs
 * on a customer device.
 *
 * Framework-free on purpose: `services/api.ts` imports it, and the contract test
 * imports it under Node without pulling in Supabase or React Native.
 *
 * RULE: only add a column here when the customer UI genuinely renders it or the
 * confirmation state machine genuinely derives from it. `orderSelect.test.ts`
 * fails if a known-internal column ever appears.
 */

/** Columns the customer app is allowed to read from `orders`. */
export const CUSTOMER_ORDER_COLUMNS = [
  // identity + routing (the internal order_number is deliberately ABSENT)
  'id',
  'status',
  'order_type',
  'created_at',
  // branch display
  'branch_id',
  'branch_name_en',
  'branch_name_ar',
  // money shown on the receipt
  'subtotal',
  'delivery_fee',
  'discount_amount',
  'loyalty_discount_amount',
  'vat_amount',
  'total',
  'loyalty_points_earned',
  // payment presentation
  'payment_status',
  'payment_method',
  // the customer's OWN kitchen note, shown back to them on the receipt
  //
  // RECLASSIFIED, deliberately. `notes` was swept into the internal list with
  // `coupon_code` and `address_snapshot` when Issue #94 replaced `select('*')`
  // — a blanket narrowing, not a judgement about this column. It holds text the
  // customer typed themselves, on their own RLS-scoped order, bounded to
  // ORDER_NOTE_MAX_LENGTH. Showing someone their own instruction back
  // ("no onion") discloses nothing they do not already know, and not showing it
  // meant the receipt could not confirm what the kitchen was actually told.
  //
  // The rest of the internal list is unchanged and still asserted below.
  'notes',
  // the ONLY customer-visible order number
  'lazywait_order_number',
  // confirmation state-machine inputs (see features/orders/orderConfirmation.ts)
  'lazywait_sync_state',
  'lazywait_ref',
  'sync_blocked_reason',
  'sync_next_attempt_at',
  'pos_create_attempted_at',
  'pos_customer_retry_count',
  'refund_state',
] as const;

/** Columns of `order_items` / `order_item_modifiers` the receipt renders. */
export const CUSTOMER_ORDER_ITEM_COLUMNS = [
  // `note` is the customer's own instruction for this line, on their own order
  // — the same reasoning as the order-level `notes` above.
  'id', 'name_en', 'name_ar', 'unit_price', 'quantity', 'note',
] as const;

export const CUSTOMER_ORDER_MODIFIER_COLUMNS = [
  'id', 'name_en', 'name_ar', 'price',
] as const;

/**
 * Columns that must NEVER reach a customer client: the internal order number,
 * other people-identifying copies, provider/reconciliation metadata, and the
 * POS fencing token. Asserted by the contract test.
 */
export const INTERNAL_ONLY_ORDER_COLUMNS = [
  'order_number',            // the internal SM-… id — Issue #94
  'customer_id',
  'customer_name',
  'customer_phone',
  'address_id',
  'address_snapshot',
  'coupon_code',
  'idempotency_key',
  'payment_provider',
  'paid_at',
  'loyalty_points_redeemed',
  'loyalty_awarded_at',
  'sync_status',
  'sync_attempt_count',
  'sync_last_error',
  'synced_at',
  'lazywait_order_id',
  'lazywait_status',
  'first_pos_sync_failure_at',
  'pos_sync_started_at',
  'pos_sync_deadline_at',
  'pos_create_attempt_token', // FENCING TOKEN — never leaves the server
  'pos_confirmation_reason',
  'pos_customer_retry_last_at',
  'refund_required_at',
  'refund_completed_at',
  'refund_failure_code',
  'updated_at',
] as const;

/**
 * The PostgREST select expression for a customer order with its lines.
 *
 * Written as a STRING LITERAL, not built with join(): supabase-js infers the
 * result row type from the literal, and a computed string collapses to
 * `GenericStringError`. `orderSelect.test.ts` pins it to the arrays above, so
 * the two can never drift.
 */
// MUST stay ONE unbroken literal: supabase-js infers the row type from the
// literal type, and `'a' + 'b'` widens to `string`, which collapses the result
// to GenericStringError. Do not reformat this across lines or via join().
// eslint-disable-next-line max-len
export const CUSTOMER_ORDER_SELECT = 'id, status, order_type, created_at, branch_id, branch_name_en, branch_name_ar, subtotal, delivery_fee, discount_amount, loyalty_discount_amount, vat_amount, total, loyalty_points_earned, payment_status, payment_method, notes, lazywait_order_number, lazywait_sync_state, lazywait_ref, sync_blocked_reason, sync_next_attempt_at, pos_create_attempted_at, pos_customer_retry_count, refund_state, order_items(id, name_en, name_ar, unit_price, quantity, note, order_item_modifiers(id, name_en, name_ar, price))';

/** The same expression rebuilt from the arrays — the drift guard for the literal. */
export const CUSTOMER_ORDER_SELECT_FROM_COLUMNS =
  `${CUSTOMER_ORDER_COLUMNS.join(', ')}, `
  + `order_items(${CUSTOMER_ORDER_ITEM_COLUMNS.join(', ')}, `
  + `order_item_modifiers(${CUSTOMER_ORDER_MODIFIER_COLUMNS.join(', ')}))`;
