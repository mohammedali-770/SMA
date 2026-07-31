/**
 * Pure view-state for the Live Orders panel.
 *
 * WHERE THE REALTIME LIVES: not here, and not in the panel. Orders arrive from
 * `AppContext`, which owns the `admin-orders-${currentUser.id}` channel, the
 * 12s fast poll, the 60s slow poll, the visibility check and the reconnect
 * fallback. `LiveOrdersPanel` is a consumer of `useApp().orders` and always was.
 * This migration touches no part of that.
 *
 * What IS here are the decisions the panel used to make inline: which POS sync
 * field wins, how a state maps to a tone, which rows a search matches, and —
 * the one that can cost money — when advancing an order's status must ask for
 * confirmation first. Each was previously checkable only by clicking through
 * the console.
 */
import type { PillTone } from '../../../../design-system/ui/StatusPill';
import type { OrderStatus } from '../../../../types';

/**
 * Statuses an order must not reach while an ONLINE payment is still unverified.
 *
 * "Received" is always allowed and "Cancelled" needs no payment. Cash orders are
 * legitimately unpaid until collected, so they get the banner but no confirm —
 * only online-pending and unknown-method orders are gated. Lifted verbatim.
 */
export const ONLINE_GUARDED_STATUSES: OrderStatus[] = [
  'preparing', 'ready', 'out_for_delivery', 'delivered',
];

/** The status filter tabs, in the order an order actually moves through them. */
export const ORDER_FILTERS = [
  'all', 'received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled',
] as const;

/** Rows requested from the confirmation-required queue. */
export const POS_VERIFY_LIMIT = 10;

/**
 * How often the confirmation-required queue re-reads.
 *
 * Named so a silent change is a visible diff: this is the one timer the panel
 * itself owns, and it is deliberately slow — the queue is an exception feed, not
 * a live board.
 */
export const POS_VERIFY_REFRESH_MS = 60_000;

/**
 * Authoritative Lazywait POS sync state.
 *
 * The fallback chain matters and is preserved exactly: `lazywaitSyncState` is
 * the current field, `orderSyncStatus` the legacy one, and an order with neither
 * has not been offered to the POS at all — which is 'not_synced', not unknown.
 */
export function syncStateOf(o: {
  lazywaitSyncState?: string | null;
  orderSyncStatus?: string | null;
}): string {
  return o.lazywaitSyncState ?? o.orderSyncStatus ?? 'not_synced';
}

/**
 * POS sync state → pill tone.
 *
 * The default arm is deliberate: an UNRECOGNISED state reads as warning, not as
 * neutral. A new backend state must not arrive on the board looking settled.
 */
export function syncTone(state: string): PillTone {
  switch (state) {
    case 'synced':
      return 'success';
    case 'blocked':
    case 'failed':
    case 'dead_letter':
    case 'sync_failed':
      return 'danger';
    case 'not_synced':
    case 'skipped':
      return 'neutral';
    default: // pending / syncing / pending_sync, and anything new
      return 'warning';
  }
}

/**
 * Order status → pill tone.
 *
 * Everything mid-flight (received, preparing, ready, out for delivery) is
 * warning rather than info, matching the original: an order that is not yet
 * delivered is work outstanding.
 */
export function orderStatusTone(status: string): PillTone {
  switch (status) {
    case 'delivered': return 'success';
    case 'cancelled': return 'danger';
    case 'received': return 'info';
    default: return 'warning';
  }
}

/** Derived payment state → pill tone. */
export function paymentTone(state: string): PillTone {
  switch (state) {
    case 'paid': return 'success';
    case 'pending_online': return 'warning';
    case 'cash_required': return 'info';
    default: return 'neutral';
  }
}

export interface OrderSearchable {
  orderNumber: string;
  lazywaitOrderNumber?: string | null;
  customerName: string;
  customerPhone: string;
}

/**
 * Whether a row matches the search box.
 *
 * The asymmetry is intentional and preserved: order number, POS number and
 * customer name are matched case-INSENSITIVELY, but the phone is matched against
 * the RAW query. Lower-casing a phone number does nothing, and folding it into
 * the lower-cased comparison would silently change which digits match.
 */
export function matchesOrderSearch(o: OrderSearchable, query: string): boolean {
  const q = query.toLowerCase();
  return o.orderNumber.toLowerCase().includes(q)
    || (o.lazywaitOrderNumber ?? '').toLowerCase().includes(q)
    || o.customerName.toLowerCase().includes(q)
    || o.customerPhone.includes(query);
}

/** Whether a row survives the status tab. */
export function matchesOrderFilter(status: string, filter: string): boolean {
  return filter === 'all' || status === filter;
}

/**
 * Whether advancing to `status` must be confirmed first.
 *
 * THE HIGH-RISK CONTRACT IN THIS PANEL. Marking an unpaid online order
 * "delivered" hands over food that was never charged for, and once the status
 * moves the customer's tracking screen says it too. So:
 *
 *   pending_online / unpaid  + a guarded status  →  confirm
 *   cash_required            + anything          →  no confirm (a cash order is
 *                                                   legitimately unpaid until
 *                                                   the driver collects)
 *   paid                     + anything          →  no confirm
 *   any state                + received/cancelled →  no confirm
 */
export function needsPaymentConfirm(paymentState: string, target: OrderStatus): boolean {
  const unsettled = paymentState === 'pending_online' || paymentState === 'unpaid';
  return unsettled && ONLINE_GUARDED_STATUSES.includes(target);
}

export type VerifyReasonKey =
  | 'verify_reason_timeout'
  | 'verify_reason_connection'
  | 'verify_reason_missing_ref'
  | 'verify_reason_provider_5xx'
  | 'verify_reason_ambiguous_response';

/**
 * POS failure reason → locale key.
 *
 * An UNRECOGNISED reason falls through to "ambiguous response" rather than
 * being dropped: the queue exists precisely for outcomes nobody has classified.
 */
export function verifyReasonKey(reason: string): VerifyReasonKey {
  switch (reason) {
    case 'timeout': return 'verify_reason_timeout';
    case 'connection': return 'verify_reason_connection';
    case 'missing_ref': return 'verify_reason_missing_ref';
    case 'provider_5xx': return 'verify_reason_provider_5xx';
    default: return 'verify_reason_ambiguous_response';
  }
}
