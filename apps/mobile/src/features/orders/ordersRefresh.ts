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

/**
 * Faster poll used ONLY while the branch number has not arrived yet.
 *
 * WHY THIS EXISTS. `order-intake` stops waiting for the POS after
 * SYNC_TIMEOUT_MS (5 s), so an order whose Create Order call is slow — 8.02 s
 * was measured on SM-2026-000068 — renders its receipt with the number still
 * pending. Nothing else fills that gap quickly: the `pos_confirmed` push is
 * data-free and only navigates when TAPPED, so a customer sitting on the
 * receipt would otherwise wait up to a full RECEIPT_POLL_MS — 25 s — to see a
 * number the server has had for 20 of them.
 *
 * Deliberately independent of push delivery. A poll works when the customer
 * denied notifications, when Expo is slow, and when the push is simply never
 * displayed; tying the refresh to a notification would make the number's
 * arrival depend on a channel that is allowed to fail.
 */
export const RECEIPT_PENDING_POLL_MS = 2_000;

/**
 * How long the fast poll may run before falling back to the normal interval.
 *
 * Bounded because a number that has not arrived in 90 s is not late, it is not
 * coming: the POS deadline is 10 minutes but every observed success landed
 * inside 10 s, and a failed sync surfaces through its own state rather than by
 * the number appearing. Polling every 2 s indefinitely would be a battery and
 * quota cost for no information.
 */
export const RECEIPT_PENDING_POLL_WINDOW_MS = 90_000;

/**
 * The delay before the next receipt refresh.
 *
 * Pure so the escalation rule is unit-tested rather than buried in an effect.
 * Returns null when polling should stop entirely.
 */
export function nextReceiptPollMs(
  order: { status: OrderStatus; lazywaitOrderNumber?: string | null },
  msSinceFocus: number,
): number | null {
  if (isTerminalOrderStatus(order.status)) return null;
  const hasNumber = (order.lazywaitOrderNumber ?? '').trim().length > 0;
  if (!hasNumber && msSinceFocus < RECEIPT_PENDING_POLL_WINDOW_MS) {
    return RECEIPT_PENDING_POLL_MS;
  }
  return RECEIPT_POLL_MS;
}

/**
 * How often the poll looks for the order while the receipt's FIRST load has not
 * finished. No network: it only re-reads the screen's own reference.
 */
export const RECEIPT_AWAIT_LOAD_MS = 400;

/**
 * Run the receipt's refresh loop until `stop()` is called.
 *
 * WHY THIS IS A FUNCTION AND NOT AN EFFECT BODY. Until 2026-11-18 the loop
 * lived in ReceiptScreen's focus effect and began with "if there is no order
 * yet, return". The focus effect runs at mount, the order arrives from the
 * network a moment later, and nothing ran the effect again, so on a receipt
 * opened fresh after checkout THE POLL NEVER STARTED. The branch number
 * reached the database in 5.5 s (SM-2026-000103) and the screen never asked
 * for it. Every "number never appears" report traced to this.
 *
 * So the loop no longer needs the order to exist when it starts: while there
 * is none it looks again every RECEIPT_AWAIT_LOAD_MS (bounded by the same
 * window as the fast poll), and from then on follows nextReceiptPollMs.
 * Framework-free, with the clock injectable, so the test drives it with fake
 * timers and proves the late-arriving order is polled.
 */
export function startReceiptPolling(deps: {
  getOrder: () => { status: OrderStatus; lazywaitOrderNumber?: string | null } | null;
  refresh: () => void;
  now?: () => number;
}): () => void {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const current = deps.getOrder();
    const elapsed = now() - startedAt;
    const delay = current
      ? nextReceiptPollMs(current, elapsed)
      : elapsed < RECEIPT_PENDING_POLL_WINDOW_MS
        ? RECEIPT_AWAIT_LOAD_MS
        : RECEIPT_POLL_MS;
    if (delay == null) return; // terminal — stop entirely
    timer = setTimeout(() => {
      if (stopped) return;
      const order = deps.getOrder();
      if (order && !isTerminalOrderStatus(order.status)) deps.refresh();
      schedule();
    }, delay);
  };
  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Terminal orders never change status again — no reason to keep polling. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === 'delivered' || status === 'cancelled';
}
