// @vitest-environment jsdom
/**
 * F-TAA4-005: replacing a product's photo must retire the OLD object only after
 * the product write is known to have succeeded. The save used to be
 * fire-and-forget and the delete ran unconditionally after it, so a refused
 * write left the live product pointing at a deleted file.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Category, Product } from '../../types';

const { removeByUrl } = vi.hoisted(() => ({ removeByUrl: vi.fn() }));
vi.mock('../../lib/api', () => ({
  menuOrder: { categories: vi.fn(), products: vi.fn() },
  productImages: { removeByUrl, upload: vi.fn() },
}));

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

import { MenuManagementPanel } from './MenuManagementPanel';

const OLD = 'https://ref.supabase.co/storage/v1/object/public/product-images/products/old.jpg';
const NEW = 'https://ref.supabase.co/storage/v1/object/public/product-images/products/new.jpg';
const category = { id: 'c1', nameEn: 'Sides', nameAr: 'مقبلات' } as Category;
const product = {
  id: 'p1',
  categoryId: 'c1',
  nameEn: 'Fries',
  nameAr: 'بطاطس',
  descriptionEn: '',
  descriptionAr: '',
  price: 5,
  calories: 300,
  imageUrl: OLD,
  isActive: true,
  modifierGroupIds: [],
  variants: [],
} as unknown as Product;

const updateProduct = vi.fn();
function mockContext() {
  useApp.mockReturnValue({
    categories: [category],
    products: [product],
    branches: [],
    addCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    addProduct: vi.fn(),
    updateProduct,
    deleteProduct: vi.fn(),
    toggleProductAvailability: vi.fn(),
    isProductAvailableInBranch: () => true,
    bulkUploadMenu: vi.fn(),
    currentUser: { role: 'admin' },
    adminLang: 'en',
  });
}

function replacePhotoAndSave() {
  fireEvent.click(screen.getByLabelText('Edit product'));
  fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: NEW } });
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext();
});
afterEach(() => cleanup());

describe('old product image cleanup', () => {
  it('does NOT delete the old image when the product write fails', async () => {
    updateProduct.mockResolvedValue(false);
    render(<MenuManagementPanel />);
    replacePhotoAndSave();
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(removeByUrl).not.toHaveBeenCalled();
  });

  it('does NOT delete the old image while the write is still in flight', async () => {
    let settle!: (ok: boolean) => void;
    updateProduct.mockReturnValue(
      new Promise<boolean>((r) => {
        settle = r;
      }),
    );
    render(<MenuManagementPanel />);
    replacePhotoAndSave();
    await new Promise((r) => setTimeout(r, 0));
    expect(removeByUrl).not.toHaveBeenCalled();
    settle(true);
    await waitFor(() => expect(removeByUrl).toHaveBeenCalledWith(OLD));
  });

  it('deletes the old image once the write has succeeded', async () => {
    updateProduct.mockResolvedValue(true);
    render(<MenuManagementPanel />);
    replacePhotoAndSave();
    await waitFor(() => expect(removeByUrl).toHaveBeenCalledTimes(1));
    expect(removeByUrl).toHaveBeenCalledWith(OLD);
  });

  it('does not touch the image when it was not replaced', async () => {
    updateProduct.mockResolvedValue(true);
    render(<MenuManagementPanel />);
    fireEvent.click(screen.getByLabelText('Edit product'));
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(removeByUrl).not.toHaveBeenCalled();
  });
});
