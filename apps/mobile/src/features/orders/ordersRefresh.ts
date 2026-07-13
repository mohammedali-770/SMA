/**
 * Orders refresh policy — PURE and framework-free so the refresh rules are
 * unit-tested under Node (ordersRefresh.test.ts) and shared by the Orders and
 * Receipt screens.
 */
import type { OrderStatus } from '../../types/models';

/**
 * How many recent orders My Orders fetches per load. The list is a recent-
 * history view, not an archive — fetching a customer's entire nested order
 * history (orders → items → modifiers) on every tab focus grows forever.
 */
export const ORDERS_PAGE_LIMIT = 20;

/**
 * Receipt status poll interval while the screen is focused and the order can
 * still change. Light on purpose: one small by-id read per tick, and polling
 * stops entirely once the order is terminal or the screen loses focus.
 */
export const RECEIPT_POLL_MS = 25_000;

/** Terminal orders never change status again — no reason to keep polling. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === 'delivered' || status === 'cancelled';
}
