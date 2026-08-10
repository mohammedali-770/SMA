import type { Product } from '../../types';

export interface ProductSaveFields {
  categoryId: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  price: number;
  calories: number;
  imageUrl: string;
}

/**
 * Build the domain product payload used by the admin create/edit form.
 *
 * Editing is deliberately identity/state preserving: a text/price edit must not
 * silently reactivate an inactive product or replace real modifier-group links
 * with a hard-coded demo id. New products start active with no fabricated links;
 * modifier links are managed by their own join-table workflow.
 */
export function productSaveData(
  fields: ProductSaveFields,
  editing: Product | null,
): Omit<Product, 'id'> {
  return {
    ...fields,
    isActive: editing?.isActive ?? true,
    modifierGroupIds: editing ? [...editing.modifierGroupIds] : [],
  };
}
