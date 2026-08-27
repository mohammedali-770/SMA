/**
 * Menu filtering/grouping — PURE and framework-free so the search + section
 * logic is unit-tested under Node (menuSections.test.ts) and consumed by the
 * virtualized Home/Menu list.
 *
 * Search matches the same fields the screen always matched (EN name, AR name,
 * EN description), case-insensitively, against an index precomputed ONCE per
 * catalog load — not re-lowercased per product per keystroke.
 */
import type { Category, Product } from '../../types/models';

export interface MenuSectionItem {
  product: Product;
  /**
   * The card cannot add this straight to the cart — the customer has to choose
   * something first. TRUE for a product with modifier groups, and ALSO for one
   * with more than one price tier.
   *
   * The tier half is why this replaced a plain `hasModifiers`. Adding a tiered
   * product from the card silently took the CHEAPEST tier (see
   * `cheapestVariant`), so someone wanting a large Coral got the 20.00 one
   * without ever being asked. That is half the live menu: 30 of 59 active
   * products carry more than one tier, one carries eleven. Precomputed once per
   * rebuild — avoids groupsForProduct() per card per render.
   */
  needsChoice: boolean;
  /**
   * Render the card price as "from X" rather than a bare X.
   *
   * Only when the tiers actually span a range. More than half the multi-tier
   * products price every tier the same — Kinza is six flavours all at 2.00,
   * Kids Meal eight at 15.00 — and "from 2.00" there advertises a cheaper
   * option that does not exist. Those still open the picker (Cola vs Pepsi is a
   * real choice for the kitchen); they just do not claim a range.
   */
  showFromPrice: boolean;
  /**
   * Orderable at the selected branch right now. Unavailable items STAY in the
   * list and render as out of stock rather than disappearing — a customer who
   * cannot find yesterday's item assumes the app is broken, whereas a greyed
   * row with a reason is an answer. Delisted products (`isActive` false) are a
   * different thing and are still filtered out entirely.
   */
  available: boolean;
}

export interface MenuSection {
  category: Category;
  data: MenuSectionItem[];
}

/**
 * Key for a menu list row. RN's VirtualizedSectionList also feeds SYNTHETIC
 * rows (section header/footer tokens whose item is undefined) through
 * keyExtractor while converting viewable items — reproduced crash: selecting a
 * branch mounted the menu, the viewability pass hit a section footer, and a
 * plain `item.product.id` threw "Cannot read properties of undefined
 * (reading 'id')", killing the release app. Real rows keep their stable
 * product id; synthetic rows get a positional key.
 */
export function menuItemKey(item: MenuSectionItem | null | undefined, index: number): string {
  return item?.product ? item.product.id : `menu-row-${index}`;
}

/**
 * More than one price tier, so the customer must pick one before ordering.
 * A single-tier product is exactly as orderable as an untiered one.
 */
export function hasTierChoice(product: Product): boolean {
  return product.variants.length > 1;
}

/**
 * Do this product's tiers actually span a price range? Only then is a "from"
 * price honest. Guards the same-price flavour case described on
 * `MenuSectionItem.showFromPrice`.
 */
export function hasPriceRange(product: Product): boolean {
  if (product.variants.length < 2) return false;
  let lo = product.variants[0].price;
  let hi = lo;
  for (const v of product.variants) {
    if (v.price < lo) lo = v.price;
    if (v.price > hi) hi = v.price;
  }
  return lo !== hi;
}

/** Lowercased searchable text per product, computed once per catalog load. */
export function buildSearchIndex(products: Product[]): Map<string, string> {
  return new Map(
    products.map((p) => [p.id, `${p.nameEn}\n${p.nameAr}\n${p.descriptionEn}`.toLowerCase()]),
  );
}

export function buildMenuSections(opts: {
  products: Product[];
  categories: Category[];
  branchId: string | null;
  query: string;
  searchIndex: Map<string, string>;
  /**
   * Orderable, not merely "not closed" — a product whose required option group
   * has been entirely closed at this branch has no valid selection left and is
   * out of stock too. See lib/orderability.ts.
   */
  isOrderable: (productId: string, branchId: string) => boolean;
  hasModifiers: (product: Product) => boolean;
}): MenuSection[] {
  const { products, categories, branchId, query, searchIndex, isOrderable, hasModifiers } = opts;
  if (!branchId) return [];
  const q = query.trim().toLowerCase();
  // Only `isActive` filters here. Branch availability decorates the row instead
  // of removing it (see MenuSectionItem.available).
  const visible = products.filter((p) => {
    if (!p.isActive) return false;
    if (!q) return true;
    return (searchIndex.get(p.id) ?? '').includes(q);
  });
  return [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      category,
      data: visible
        .filter((p) => p.categoryId === category.id)
        // Order WITHIN the category is the administrator's, set through
        // `reorder_products`. This used to rely on the fetch arriving already
        // sorted, which was true only by accident: every product sat at
        // sort_order 0, so Postgres returned a tied sort in whatever order it
        // liked and the menu could differ between two loads. Sorting here makes
        // it explicit and testable, and survives any change to how the catalog
        // is fetched or cached.
        //
        // Name is the tie-break so equal ranks are still STABLE rather than
        // arbitrary — which is exactly today's data, where nothing has been
        // ordered yet.
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn))
        .map((product) => ({
          product,
          needsChoice: hasModifiers(product) || hasTierChoice(product),
          showFromPrice: hasPriceRange(product),
          available: isOrderable(product.id, branchId),
        })),
    }))
    .filter((s) => s.data.length > 0);
}
