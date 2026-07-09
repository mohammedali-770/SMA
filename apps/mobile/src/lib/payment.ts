/**
 * Pure payment-method helpers for the customer mobile app. Mirrors the web
 * app's src/lib/payment.ts so both clients gate checkout identically.
 *
 * Cash payment exists but is controlled by Admin settings and is NEVER assumed.
 * Online payment has no gateway yet. `place_order` is the server-authoritative
 * gate (a client cannot pick a disabled method or fake payment_status); these
 * helpers only mirror it for the UI.
 */
export type PaymentMethod = 'online' | 'cash';

export interface PaymentMethodSettings {
  onlineEnabled: boolean;
  cashEnabled: boolean;
  defaultMethod: PaymentMethod | null;
  outageMode: boolean;
}

/** Methods a customer may choose right now (order preserved: online, then cash). */
export function availableMethods(s: PaymentMethodSettings): PaymentMethod[] {
  const out: PaymentMethod[] = [];
  if (s.onlineEnabled) out.push('online');
  if (s.cashEnabled) out.push('cash');
  return out;
}

/** True when NO method is enabled → checkout must be blocked. */
export function checkoutBlocked(s: PaymentMethodSettings): boolean {
  return availableMethods(s).length === 0;
}

/** The method to preselect: the configured default if enabled, else the only/first enabled. */
export function resolveDefaultMethod(s: PaymentMethodSettings): PaymentMethod | null {
  const methods = availableMethods(s);
  if (s.defaultMethod && methods.includes(s.defaultMethod)) return s.defaultMethod;
  return methods[0] ?? null;
}

/** True when online is off but cash is on — show the "online unavailable" notice. */
export function onlineUnavailableCashOn(s: PaymentMethodSettings): boolean {
  return !s.onlineEnabled && s.cashEnabled;
}

/**
 * Derived payment display state for an order (no enum change server-side):
 *  - paid            → verified online payment
 *  - pending_online  → online chosen, not yet paid
 *  - cash_required   → cash chosen, collect from customer
 *  - unpaid          → no/unknown method, still pending
 */
export type PaymentDisplayState = 'paid' | 'pending_online' | 'cash_required' | 'unpaid';

export function paymentDisplayState(
  o: { paymentStatus: 'pending' | 'paid'; paymentMethod?: string | null },
): PaymentDisplayState {
  if (o.paymentStatus === 'paid') return 'paid';
  if (o.paymentMethod === 'online') return 'pending_online';
  if (o.paymentMethod === 'cash') return 'cash_required';
  return 'unpaid';
}

/** Semantic label key for the chosen method + order type (component localizes it). */
export type PaymentMethodLabel = 'online' | 'cash_delivery' | 'cash_pickup' | 'cash' | 'none';

export function paymentMethodLabel(
  method: string | null | undefined,
  orderType: 'delivery' | 'pickup' | string,
): PaymentMethodLabel {
  if (method === 'online') return 'online';
  if (method === 'cash') return orderType === 'delivery' ? 'cash_delivery' : orderType === 'pickup' ? 'cash_pickup' : 'cash';
  return 'none';
}
