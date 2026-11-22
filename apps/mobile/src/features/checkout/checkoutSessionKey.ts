/**
 * The idempotency key of a CARD checkout, and the total check before payment.
 *
 * Pure and framework-free, so the vitest suite can exercise it directly.
 *
 * WHY THE CART KEY WAS NOT ENOUGH (audit F-X02-001). The cart's key stands for
 * the item list only (cartOrderSignature). begin_checkout_session returned the
 * live session for a key without looking at anything else, so a customer who
 * opened a card payment for a pickup order, closed the page and switched to
 * delivery (or changed branch, address, coupon, points or notes) got the OLD
 * session back: the hosted page charged the old total and the kitchen received
 * the old order, while the screen showed the new choices.
 *
 * The card checkout therefore uses a key derived from the cart key AND every
 * other input begin_checkout_session receives. The same inputs give the same
 * key, so a retry after a lost response still finds its session; any change
 * gives a different key, so the server prices a new session. The cart key is
 * part of the derivation, so a new cart never meets an old cart's session.
 *
 * The CASH path keeps the cart key unchanged: place_order uses it to return
 * the order already placed when a response was lost, and there is no payment
 * page that could show a stale amount.
 */
import type { OrderItemInput } from '../cart/cartOrderBody';

/** Exactly what the app sends to begin_checkout_session, minus the key. */
export interface CheckoutKeyInput {
  branchId: string;
  orderType: string;
  items: OrderItemInput[];
  addressId?: string | null;
  couponCode?: string | null;
  notes?: string | null;
  loyaltyPoints?: number | null;
}

/**
 * A stable text form of the inputs. Fixed key order; absent and null read the
 * same (begin_checkout_session receives `?? null` for each); points are
 * normalized the way the server stores them (never below 0).
 */
export function checkoutInputSignature(input: CheckoutKeyInput): string {
  return JSON.stringify([
    1,
    input.branchId,
    input.orderType,
    input.items,
    input.addressId ?? null,
    input.couponCode ?? null,
    input.notes ?? null,
    Math.max(0, Math.trunc(Number(input.loyaltyPoints ?? 0)) || 0),
  ]);
}

/**
 * cyrb128: a fast, well-mixed 128-bit non-cryptographic string hash. A key is
 * not a secret and only has to differ between two checkouts of one customer;
 * the server's input fingerprint (20261020120000) still refuses to answer one
 * checkout's inputs with another's session if two keys ever collided.
 */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * The key a card checkout is begun under: a UUID-shaped value (version nibble
 * 8, RFC 9562 "custom"; variant 10) derived from the cart key and the inputs.
 * Postgres accepts it as a `uuid`.
 */
export function checkoutSessionKey(cartKey: string, input: CheckoutKeyInput): string {
  const words = cyrb128(`${cartKey}|${checkoutInputSignature(input)}`);
  const hex = words
    .map((w) => w.toString(16).padStart(8, '0'))
    .join('')
    .split('');
  hex[12] = '8';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * May the payment page be opened for a session whose server total is
 * `sessionTotal`, while the screen shows `shownTotal`? Only when both are
 * known and equal to the halala. An unreadable total is not a match: the page
 * would charge an amount the customer was not shown.
 */
export function sessionTotalMatchesShown(
  sessionTotal: number | string | null | undefined,
  shownTotal: number | null | undefined,
): boolean {
  if (sessionTotal === null || sessionTotal === undefined || sessionTotal === '') return false;
  if (shownTotal === null || shownTotal === undefined) return false;
  const a = Number(sessionTotal);
  const b = Number(shownTotal);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}
