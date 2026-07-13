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
}

export interface MenuSection {
  category: Category;
  data: MenuSectionItem[];
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
  isAvailable: (productId: string, branchId: string) => boolean;
  hasModifiers: (product: Product) => boolean;
}): MenuSection[] {
  const { products, categories, branchId, query, searchIndex, isAvailable, hasModifiers } = opts;
  if (!branchId) return [];
  const q = query.trim().toLowerCase();
  const visible = products.filter((p) => {
    if (!p.isActive || !isAvailable(p.id, branchId)) return false;
    if (!q) return true;
    return (searchIndex.get(p.id) ?? '').includes(q);
  });
  return [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      category,
      data: visible
        .filter((p) => p.categoryId === category.id)
        .map((product) => ({ product, hasModifiers: hasModifiers(product) })),
    }))
    .filter((s) => s.data.length > 0);
}
