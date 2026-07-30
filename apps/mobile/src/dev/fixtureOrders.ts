/**
 * Deterministic mock ORDERS for the dev fixture.
 *
 * Pure data — no services, no fetch, no Supabase, no Lazywait, no payment SDK.
 * Fixed constants only (never Date.now(), never random), so a fixture
 * screenshot is reproducible and a visual diff means a real change.
 *
 * The confirmation states are NOT hand-written here. Each order sets the RAW
 * inputs the real state machine reads — payment status, sync state, POS ref,
 * blocked reason, retry count, refund state — and `orderConfirmationState`
 * derives the state exactly as it does in production. If the machine's rules
 * change, these fixtures move with it instead of quietly disagreeing.
 *
 * Framework-free so it can be asserted in unit tests.
 */
import type { Order, OrderItem, OrderStatus } from '../types/models';

const fixture = <T,>(o: Partial<T>): T => o as T;

/** Fixed epoch: 2026-01-01T09:30:00Z. Never Date.now() — see the docblock. */
const CREATED_AT = '2026-01-01T09:30:00.000Z';

const ITEMS: OrderItem[] = [
  fixture<OrderItem>({
    id: 'oi-1',
    nameEn: 'Spicy Crispy Chicken Meal',
    nameAr: 'وجبة دجاج مقرمش حار',
    price: 34.5,
    quantity: 2,
    selectedModifiers: [
      { id: 'om-1', nameEn: 'Extra spicy', nameAr: 'حار إضافي', price: 0 },
      { id: 'om-2', nameEn: 'Pepsi', nameAr: 'بيبسي', price: 0 },
    ],
  }),
  fixture<OrderItem>({
    id: 'oi-2',
    nameEn: 'Golden Fries',
    nameAr: 'بطاطس ذهبية',
    price: 9,
    quantity: 1,
    selectedModifiers: [],
  }),
];

/** 2 × 34.50 + 9.00 = 78.00, + 15.00 delivery. Checkable by hand. */
const BASE = {
  id: 'ord-fixture-1',
  branchId: 'br-fixture-olaya',
  branchNameEn: 'Olaya Branch',
  branchNameAr: 'فرع العليا',
  orderType: 'delivery' as const,
  items: ITEMS,
  subtotal: 78,
  deliveryFee: 15,
  discountAmount: 0,
  loyaltyDiscountAmount: 0,
  vatAmount: 12.13,
  total: 93,
  loyaltyPointsEarned: 93,
  createdAt: CREATED_AT,
};

/**
 * Build an order from the RAW state-machine inputs. Every scene below differs
 * only in those inputs, so the derived confirmation state is the real one.
 */
function order(
  id: string,
  status: OrderStatus,
  raw: Partial<Order>,
): Order {
  return fixture<Order>({ ...BASE, id, status, ...raw });
}

/** Online payment started but not verified — no order-like language allowed. */
export const ORDER_PAYMENT_PENDING = order('ord-pay-pending', 'received', {
  paymentMethod: 'online', paymentStatus: 'pending',
});

/** Paid, and this channel has no branch-confirmation step. */
export const ORDER_PAID_NO_POS = order('ord-paid-nopos', 'received', {
  paymentMethod: 'online', paymentStatus: 'paid',
  syncBlockedReason: 'no_channel',
});

/** Cash, no branch-confirmation step. The common cash-on-delivery landing. */
export const ORDER_CASH_NO_POS = order('ord-cash-nopos', 'received', {
  paymentMethod: 'cash', paymentStatus: 'pending',
  syncBlockedReason: 'no_channel',
});

/** A send is in flight / an automatic retry is queued. */
export const ORDER_SENDING = order('ord-sending', 'received', {
  paymentMethod: 'online', paymentStatus: 'paid',
  lazywaitSyncState: 'pending', syncNextAttemptAt: CREATED_AT,
});

/** The branch accepted it. The ONLY state that may show a success hero. */
export const ORDER_CONFIRMED = order('ord-confirmed', 'preparing', {
  paymentMethod: 'online', paymentStatus: 'paid',
  lazywaitSyncState: 'synced', lazywaitRef: 'POS-88213', lazywaitOrderNumber: '1042',
});

/** Ambiguous outcome — a ticket may exist. Verification, never a resend. */
export const ORDER_VERIFYING = order('ord-verifying', 'received', {
  paymentMethod: 'online', paymentStatus: 'paid',
  lazywaitSyncState: 'failed', posCreateAttemptedAt: CREATED_AT,
});

/** Paid, proven not sent — customer resend offered. */
export const ORDER_RESEND_AVAILABLE = order('ord-resend', 'received', {
  paymentMethod: 'online', paymentStatus: 'paid',
  lazywaitSyncState: 'failed', posCustomerRetryCount: 0,
});

/** Cash, proven not sent — customer resend offered, no payment claim. */
export const ORDER_RESEND_AVAILABLE_CASH = order('ord-resend-cash', 'received', {
  paymentMethod: 'cash', paymentStatus: 'pending',
  lazywaitSyncState: 'failed', posCustomerRetryCount: 0,
});

/** Resend budget spent, refund in progress — never claimed complete. */
export const ORDER_REFUND_PENDING = order('ord-refund-pending', 'cancelled', {
  paymentMethod: 'online', paymentStatus: 'paid',
  lazywaitSyncState: 'failed', posCustomerRetryCount: 3, refundState: 'pending',
});

/** Refund CONFIRMED by the provider. */
export const ORDER_REFUNDED = order('ord-refunded', 'cancelled', {
  paymentMethod: 'online', paymentStatus: 'paid',
  lazywaitSyncState: 'failed', posCustomerRetryCount: 3, refundState: 'refunded',
});

/** Refund could not be completed — operations follow up. */
export const ORDER_REFUND_FAILED = order('ord-refund-failed', 'cancelled', {
  paymentMethod: 'online', paymentStatus: 'paid',
  lazywaitSyncState: 'failed', posCustomerRetryCount: 3, refundState: 'failed',
});

/** Terminal happy path — delivered, pickup variant for the type row. */
export const ORDER_COMPLETED = order('ord-completed', 'delivered', {
  orderType: 'pickup', deliveryFee: 0, total: 78,
  paymentMethod: 'cash', paymentStatus: 'paid',
  lazywaitSyncState: 'synced', lazywaitRef: 'POS-88109', lazywaitOrderNumber: '1039',
});

/** Ready for collection. */
export const ORDER_READY = order('ord-ready', 'ready', {
  orderType: 'pickup', deliveryFee: 0, total: 78,
  paymentMethod: 'cash', paymentStatus: 'pending',
  lazywaitSyncState: 'synced', lazywaitRef: 'POS-88221', lazywaitOrderNumber: '1043',
});

/** Cancelled outright. */
export const ORDER_CANCELLED = order('ord-cancelled', 'cancelled', {
  paymentMethod: 'cash', paymentStatus: 'pending',
  syncBlockedReason: 'no_channel',
});

/** The My Orders list: one card per interesting state. */
export const FIXTURE_ORDER_LIST: Order[] = [
  ORDER_CONFIRMED,
  ORDER_SENDING,
  ORDER_RESEND_AVAILABLE,
  ORDER_REFUND_PENDING,
  ORDER_REFUNDED,
  ORDER_READY,
  ORDER_COMPLETED,
  ORDER_CANCELLED,
];

/** Receipt scenes, keyed by the fixture scene name suffix. */
export const FIXTURE_RECEIPTS = {
  'payment-pending': ORDER_PAYMENT_PENDING,
  paid: ORDER_PAID_NO_POS,
  cash: ORDER_CASH_NO_POS,
  sending: ORDER_SENDING,
  confirmed: ORDER_CONFIRMED,
  verifying: ORDER_VERIFYING,
  resend: ORDER_RESEND_AVAILABLE,
  'resend-cash': ORDER_RESEND_AVAILABLE_CASH,
  'refund-pending': ORDER_REFUND_PENDING,
  refunded: ORDER_REFUNDED,
  'refund-failed': ORDER_REFUND_FAILED,
  ready: ORDER_READY,
  completed: ORDER_COMPLETED,
  cancelled: ORDER_CANCELLED,
} as const;

export type ReceiptSceneKey = keyof typeof FIXTURE_RECEIPTS;
