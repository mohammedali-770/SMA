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
  /** Precomputed once per rebuild — avoids groupsForProduct() per card per render. */
  hasModifiers: boolean;
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
        .map((product) => ({
          product,
          hasModifiers: hasModifiers(product),
          available: isOrderable(product.id, branchId),
        })),
    }))
    .filter((s) => s.data.length > 0);
}
