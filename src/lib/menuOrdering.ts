/**
 * Menu display ordering (pure — no Supabase, no React).
 *
 * The dashboard's job is to show the menu in the SAME order the customer sees
 * and let an administrator change it. Both halves live here so they are tested
 * against each other rather than each re-deriving the rule:
 *
 *   - `sortRows` is the read model. It must agree with the mobile app's
 *     `buildMenuSections`, which sorts categories by sortOrder and products by
 *     sortOrder within a category, tie-breaking on the English name.
 *   - `moveWithin` produces the new order an administrator asked for, which is
 *     then handed to `reorder_categories` / `reorder_products` as a whole list.
 *
 * Ranks are never computed here. The RPCs assign 1..N from ARRAY POSITION, so
 * this module only ever decides SEQUENCE — which is why a gap or a duplicate
 * rank is not a failure mode it can produce.
 */

/** The shape both categories and products share for ordering purposes. */
export interface Orderable {
  id: string;
  sortOrder?: number;
  nameEn: string;
}

/**
 * Display order for one flat list: rank ascending, then English name so an
 * UNORDERED list (everything at 0, which is today's live data for products) is
 * still stable rather than arbitrary.
 *
 * Returns a new array; the input is never mutated.
 */
export function sortRows<T extends Orderable>(rows: readonly T[]): T[] {
  return rows
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.nameEn.localeCompare(b.nameEn));
}

/**
 * Move the item at `index` one step in `direction`, returning the new id order.
 *
 * Returns null when the move is impossible (already at an end, or the index is
 * out of range) so the caller can skip the round trip entirely rather than
 * writing an ordering identical to the one already stored.
 */
export function moveWithin<T extends Orderable>(
  rows: readonly T[],
  index: number,
  direction: 'up' | 'down',
): string[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return null;

  const ids = rows.map((r) => r.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

/**
 * The products of one category, in display order.
 *
 * Scoped deliberately: `reorder_products` is category-scoped, so a product's
 * rank is only ever compared with its siblings. Passing a cross-category list
 * to the RPC is refused outright rather than partially applied.
 */
export function productsInCategory<T extends Orderable & { categoryId: string }>(
  products: readonly T[],
  categoryId: string,
): T[] {
  return sortRows(products.filter((p) => p.categoryId === categoryId));
}
