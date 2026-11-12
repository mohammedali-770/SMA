/**
 * The priced part of the menu graph, mapped from database rows.
 *
 * Shared by `CatalogProvider`'s full load and its foreground price refresh, so
 * the two cannot drift: a product, tier or option is mapped the same way
 * whichever read produced it. Pure and framework-free, so it is tested under
 * Node.
 */
import { mapModifierGroup, mapProduct } from '../lib/mappers';
import type {
  DbModifier,
  DbModifierGroup,
  DbProduct,
  DbProductModifierGroup,
  DbProductVariant,
} from '../types/db';
import type { ModifierGroup, Product } from '../types/models';

export interface PricedMenuRows {
  products: DbProduct[];
  productVariants: DbProductVariant[];
  modifiers: DbModifier[];
  modifierGroups: DbModifierGroup[];
  links: DbProductModifierGroup[];
}

export interface PricedMenu {
  products: Product[];
  modifierGroupsById: Record<string, ModifierGroup>;
}

export function mapPricedMenu(rows: PricedMenuRows): PricedMenu {
  const products = rows.products.map((p) => mapProduct(p, rows.links, rows.productVariants));
  const modifierGroupsById: Record<string, ModifierGroup> = {};
  for (const g of rows.modifierGroups) {
    modifierGroupsById[g.id] = mapModifierGroup(g, rows.modifiers);
  }
  return { products, modifierGroupsById };
}
