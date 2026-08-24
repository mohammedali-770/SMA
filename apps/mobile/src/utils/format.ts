/**
 * Formatting + small pricing helpers, mirroring the web app's utils where they
 * are platform-neutral. Note: all authoritative order math happens server-side
 * in place_order — these are for DISPLAY only (cart preview, receipts).
 */
import { formatAmount } from '../design-system/generated/money';
import type { CartItem, Modifier, Product, ProductVariant } from '../types/models';

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

/**
 * Per-item price = the chosen tier's price (or the product's, when it has no
 * tiers) + all selected modifier prices.
 *
 * Preview only — `place_order` recomputes this server-side from the same rows,
 * so a tampered client cannot underprice a line.
 */
export function computeUnitPrice(
  product: Product,
  selected: { [groupId: string]: Modifier[] },
  variant?: ProductVariant | null,
): number {
  const mods = flattenModifiers(selected).reduce((sum, m) => sum + m.price, 0);
  return Number(((variant?.price ?? product.price) + mods).toFixed(2));
}

/**
 * Stable cart-line identity: product id + sorted selected modifier ids. Two
 * lines with the same product and same modifiers merge (quantity increments);
 * different modifier choices stay separate.
 */
export function makeCartItemId(
  productId: string,
  selected: { [groupId: string]: Modifier[] },
  /**
   * The line's own kitchen note. Part of the IDENTITY, not decoration: two
   * portions of the same dish where one is "no onion" are two different things
   * to a cook. Without this they collapse into one line and whichever note was
   * added last silently wins for both.
   */
  note?: string | null,
  /**
   * The chosen price tier. Part of the identity for the same reason and with
   * higher stakes: a Small and a Large are different products at different
   * prices, and merging them would charge one and deliver the other.
   */
  variantId?: string | null,
): string {
  const ids = flattenModifiers(selected).map((m) => m.id).sort();
  const withVariant = variantId ? `${productId}@@${variantId}` : productId;
  const base = ids.length ? `${withVariant}::${ids.join(',')}` : withVariant;
  const trimmed = (note ?? '').trim();
  return trimmed ? `${base}##${trimmed}` : base;
}

/**
 * What a cart line is CALLED, tier included: "Chicken Wings — Large".
 *
 * The tier is part of the identity of what was bought, so it belongs in the
 * name and not in the option summary underneath. It is omitted when the tier
 * just repeats the product name — the importer names a single unnamed Lazywait
 * price after its item, and "Grill Sauce — Grill Sauce" helps nobody.
 */
export function cartLineLabel(
  item: CartItem,
  pick: (en: string, ar: string) => string,
): string {
  const base = pick(item.product.nameEn, item.product.nameAr);
  if (!item.variant) return base;
  const tier = pick(item.variant.nameEn, item.variant.nameAr);
  return !tier || tier === base ? base : `${base} — ${tier}`;
}

/** Cart subtotal preview (sum of line totals). Server recomputes on checkout. */
export function cartSubtotal(items: CartItem[]): number {
  return Number(items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0).toFixed(2));
}
