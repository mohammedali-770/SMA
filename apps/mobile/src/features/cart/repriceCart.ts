/**
 * Re-price cart lines from the current menu.
 *
 * A line's `unitPrice` used to be written once, when it was added or edited,
 * and then kept for ever: a persisted cart came back verbatim on every launch,
 * and a running app never re-read prices. So after a price rise the cart and
 * the checkout preview showed the old total, while `place_order`, which prices
 * from the current rows, charged the new one.
 *
 * This recomputes each line from fresh rows with the same `computeUnitPrice`
 * the add path uses, so a re-priced line is priced exactly as a freshly added
 * one would be. A line whose product, price tier or option the menu no longer
 * offers is FLAGGED rather than dropped: removing something from a customer's
 * cart without telling them is worse than showing it and saying why it cannot
 * be ordered. The flag is cleared again if the item returns.
 *
 * Pure and framework-free, so it is unit tested under Node.
 */
import { computeUnitPrice } from '../../utils/format';
import type {
  CartItem,
  CartLineIssue,
  Modifier,
  ModifierGroup,
  Product,
  ProductVariant,
} from '../../types/models';

export interface RepriceResult {
  items: CartItem[];
  /**
   * True when at least one line differs from its input. Unchanged lines keep
   * their identity, so a caller can skip a state write when this is false.
   */
  changed: boolean;
}

function withoutIssue(line: CartItem): CartItem {
  const next = { ...line };
  delete next.unavailable;
  return next;
}

function flagged(line: CartItem, issue: CartLineIssue): CartItem {
  return { ...line, unavailable: issue };
}

function repriceLine(
  line: CartItem,
  productsById: Map<string, Product>,
  groups: Record<string, ModifierGroup>,
): CartItem {
  const product = productsById.get(line.product.id);
  // A customer's read never returns an inactive product (RLS), so absence is
  // the usual signal; `isActive` covers a staff session, which can see them.
  if (!product || !product.isActive) return flagged(line, 'product');

  let tier: ProductVariant | null = null;
  if (line.variant) {
    tier = product.variants.find((v) => v.id === line.variant?.id) ?? null;
    if (!tier) return flagged(line, 'tier');
  } else if (product.variants.length > 0) {
    // The product gained tiers after this line was added. place_order refuses
    // a tiered product sent without one, and choosing a tier for the customer
    // here would be choosing a price for them.
    return flagged(line, 'tier');
  }

  const selected: { [groupId: string]: Modifier[] } = {};
  for (const [groupId, mods] of Object.entries(line.selectedModifiers)) {
    const group = product.modifierGroupIds.includes(groupId) ? groups[groupId] : undefined;
    if (!group) {
      if (mods.length > 0) return flagged(line, 'option');
      selected[groupId] = mods;
      continue;
    }
    const fresh: Modifier[] = [];
    for (const m of mods) {
      const current = group.modifiers.find((x) => x.id === m.id);
      if (!current) return flagged(line, 'option');
      fresh.push(current);
    }
    selected[groupId] = fresh;
  }

  return withoutIssue({
    ...line,
    product,
    variant: tier ?? undefined,
    selectedModifiers: selected,
    unitPrice: computeUnitPrice(product, selected, tier),
  });
}

/** Same content, ignoring object identity. Cart lines are small and plain. */
function sameLine(a: CartItem, b: CartItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function repriceCart(
  items: CartItem[],
  products: Product[],
  modifierGroupsById: Record<string, ModifierGroup>,
): RepriceResult {
  // No menu loaded (still loading, or the load failed) is not evidence that
  // everything was withdrawn. Flagging the whole cart on it would tell the
  // customer every item had gone the first time the network blinked.
  if (products.length === 0 || items.length === 0) return { items, changed: false };

  const productsById = new Map(products.map((p) => [p.id, p]));
  let changed = false;
  const next = items.map((line) => {
    const repriced = repriceLine(line, productsById, modifierGroupsById);
    if (sameLine(repriced, line)) return line;
    changed = true;
    return repriced;
  });
  return { items: changed ? next : items, changed };
}
