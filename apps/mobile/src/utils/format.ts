/**
 * Formatting + small pricing helpers, mirroring the web app's utils where they
 * are platform-neutral. Note: all authoritative order math happens server-side
 * in place_order — these are for DISPLAY only (cart preview, receipts).
 */
import { formatAmount } from '../design-system/generated/money';
import type { CartItem, Modifier, Product } from '../types/models';

/**
 * "123.00 SAR" (en) / "123.00 ر.س" (ar).
 *
 * STRING CONTEXTS ONLY — sentences, alert bodies, joined metadata lines. Where
 * the amount is its own element, use the `Price` component: it draws the
 * official SAMA riyal symbol instead of a text code. A textual label is
 * unavoidable here because a React element cannot be interpolated into a
 * template string.
 *
 * The number comes from the shared design-system money module, so decimals and
 * grouping match `Price` exactly.
 */
export function formatSAR(amount: number, lang: 'en' | 'ar' = 'en'): string {
  return `${formatAmount(amount)} ${lang === 'ar' ? 'ر.س' : 'SAR'}`;
}

const RIYADH_TZ = 'Asia/Riyadh';

/** "YYYY-MM-DD HH:mm" in Riyadh (UTC+3) local time. */
export function formatRiyadhDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: RIYADH_TZ });
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: RIYADH_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${date} ${time}`;
}

/** Flatten the per-group modifier selection into one array. */
export function flattenModifiers(selected: { [groupId: string]: Modifier[] }): Modifier[] {
  return Object.values(selected).flat();
}

/** Per-item price = base product price + all selected modifier prices. */
export function computeUnitPrice(product: Product, selected: { [groupId: string]: Modifier[] }): number {
  const mods = flattenModifiers(selected).reduce((sum, m) => sum + m.price, 0);
  return Number((product.price + mods).toFixed(2));
}

/**
 * Stable cart-line identity: product id + sorted selected modifier ids. Two
 * lines with the same product and same modifiers merge (quantity increments);
 * different modifier choices stay separate.
 */
export function makeCartItemId(productId: string, selected: { [groupId: string]: Modifier[] }): string {
  const ids = flattenModifiers(selected).map((m) => m.id).sort();
  return ids.length ? `${productId}::${ids.join(',')}` : productId;
}

/** Cart subtotal preview (sum of line totals). Server recomputes on checkout. */
export function cartSubtotal(items: CartItem[]): number {
  return Number(items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0).toFixed(2));
}
