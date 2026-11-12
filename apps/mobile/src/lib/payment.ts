/**
 * Pure payment-method helpers for the customer mobile app. Started as a mirror
 * of the console's src/lib/payment.ts; the one deliberate difference is that
 * online payment is offered only in the native app (see onlineSupportedOn).
 *
 * Cash payment exists but is controlled by Admin settings and is NEVER assumed.
 * Online payment is Moyasar's hosted page, opened in the app's payment WebView,
 * and is likewise switched by Admin settings. `place_order` is the
 * server-authoritative gate (a client cannot pick a disabled method or fake
 * payment_status); these helpers only mirror it for the UI.
 *
 * THE CUSTOMER CHOOSES; NOTHING CHOOSES FOR THEM (owner decision, 2026-09-14).
 * There is deliberately no `resolveDefaultMethod` here any more. Paying is a
 * decision with consequences a customer should make on purpose -- cash means
 * having the money at the door or at the counter -- and a preselected radio is
 * a decision made silently on their behalf. `clearIfUnavailable` is the only
 * automatic movement left, and it can only ever take a choice AWAY.
 *
 * Note what did NOT change: `app_settings.default_payment_method` still exists
 * and `place_order` still falls back to it when a caller supplies no method at
 * all. That is a SERVER-SIDE floor for a method-less submission, not a UI
 * preselection, and it lives in the money path where this file cannot reach it.
 */
export type PaymentMethod = 'online' | 'cash';

export interface PaymentMethodSettings {
  onlineEnabled: boolean;
  cashEnabled: boolean;
  /**
   * The admin-configured default. Kept because it mirrors
   * `app_settings.default_payment_method`, which `place_order` reads when a
   * caller submits no method. NO helper here preselects from it: see the header.
   */
  defaultMethod: PaymentMethod | null;
  outageMode: boolean;
}

/**
 * Online payment runs only in the native app. Moyasar's hosted page opens in the
 * in-app payment WebView, which a browser build cannot host, and
 * `online_payment_enabled` is one global setting — so without this, switching
 * online payment on for the app would also offer the web build (/app) a method
 * it cannot complete. `platform` is the caller's `Platform.OS`.
 */
function onlineSupportedOn(platform: string): boolean {
  return platform !== 'web';
}

/** Methods a customer may choose right now (order preserved: online, then cash). */
export function availableMethods(s: PaymentMethodSettings, platform: string): PaymentMethod[] {
  const out: PaymentMethod[] = [];
  if (s.onlineEnabled && onlineSupportedOn(platform)) out.push('online');
  if (s.cashEnabled) out.push('cash');
  return out;
}

/** True when NO method is enabled -> checkout must be blocked. */
export function checkoutBlocked(s: PaymentMethodSettings, platform: string): boolean {
  return availableMethods(s, platform).length === 0;
}

/**
 * Keep an existing choice only while it is still offered.
 *
 * The one automatic movement allowed, and it is one-directional by
 * construction: it returns the caller's own pick or null, and can never invent
 * a method. An administrator turning a method off mid-checkout must not leave
 * the customer holding a selection the server will refuse -- but nor may it
 * quietly slide them onto the other one.
 */
export function clearIfUnavailable(
  s: PaymentMethodSettings,
  chosen: PaymentMethod | null,
  platform: string,
): PaymentMethod | null {
  return chosen && availableMethods(s, platform).includes(chosen) ? chosen : null;
}

/**
 * Derived payment display state for an order (no enum change server-side):
 *  - paid            -> verified online payment
 *  - pending_online  -> online chosen, not yet paid
 *  - cash_required   -> cash chosen, collect from customer
 *  - unpaid          -> no/unknown method, still pending
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
