import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { productToDbInsert, productToDbUpdate } from './mappers';

const product: Product = {
  id: 'p-inactive',
  categoryId: 'c1',
  nameEn: 'Hidden Product',
  nameAr: 'منتج مخفي',
  descriptionEn: 'edited text',
  descriptionAr: 'نص معدل',
  price: 25,
  calories: 500,
  imageUrl: 'https://example.test/product.jpg',
  // Deliberately FALSE: this fixture exists to prove the generic edit contract
  // does not carry the flag, so it has to differ from the default.
  earnsLoyaltyPoints: false,
  variants: [],
  isActive: true, // reconstructed by the current edit form; must not reach DB
  modifierGroupIds: ['real-group-id'],
};

describe('product write mapping', () => {
  it('keeps activation state out of generic product edits', () => {
    const patch = productToDbUpdate(product);
    expect(patch).not.toHaveProperty('is_active');
    // Same rule, same reason: an administrator set this item to earn nothing,
    // and correcting its price must not quietly restore earning. The fixture
    // carries `earnsLoyaltyPoints: false`, so a mapper that leaked the field
    // would be caught here rather than in production.
    expect(patch).not.toHaveProperty('earns_loyalty_points');
    expect(patch).toMatchObject({
      category_id: 'c1',
      name_en: 'Hidden Product',
      price: 25,
      image_url: 'https://example.test/product.jpg',
    });
  });

  it('still sets activation explicitly when creating a new product', () => {
    const { id: _id, ...newProduct } = product;
    const insert = productToDbInsert({ ...newProduct, isActive: true }, 7);
    expect(insert.is_active).toBe(true);
    expect(insert.sort_order).toBe(7);
  });
});
