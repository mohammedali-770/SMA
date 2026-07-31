// @vitest-environment jsdom
/**
 * Menu management — focused regression tests.
 *
 * Only the contracts where a silent change costs money or data:
 *
 *   1. A product price must be REJECTED when it is not a positive finite
 *      number. It used to default to 20.00 SAR, which hid typos and turned a
 *      legitimate 0 into a real charge. The rejection is a hard stop.
 *   2. Delete must not fire when the confirm is declined — for products AND for
 *      categories, where the blast radius is larger (every product in the
 *      category is disabled).
 *   3. An accountant must not be able to create, edit or delete anything here.
 *
 * The app context is mocked (no Supabase, no realtime, no provider tree).
 * `AppContext` itself is exported from the mock because the design-system
 * primitives read the active language through `useDsLang`, which reads that
 * context defensively and falls back to English.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Category, Product } from '../../types';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

import { MenuManagementPanel } from './MenuManagementPanel';

const category = { id: 'c1', nameEn: 'Sides', nameAr: 'مقبلات' } as Category;
const product = {
  id: 'p1', categoryId: 'c1', nameEn: 'Fries', nameAr: 'بطاطس',
  descriptionEn: '', descriptionAr: '', price: 12, calories: 300,
  imageUrl: 'https://example.test/f.jpg', isActive: true, modifierGroupIds: [],
} as Product;

const addProduct = vi.fn();
const updateProduct = vi.fn();
const deleteProduct = vi.fn();
const addCategory = vi.fn();
const updateCategory = vi.fn();
const deleteCategory = vi.fn();
const bulkUploadMenu = vi.fn();

function mockContext(over: Record<string, unknown> = {}) {
  useApp.mockReturnValue({
    categories: [category],
    products: [product],
    branches: [],
    addCategory, updateCategory, deleteCategory,
    addProduct, updateProduct, deleteProduct,
    toggleProductAvailability: vi.fn(),
    isProductAvailableInBranch: () => true,
    bulkUploadMenu,
    currentUser: { role: 'admin' },
    adminLang: 'en',
    ...over,
  });
}

const tab = (name: string) => screen.getByRole('button', { name });
const submitDialog = () =>
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);

/** Open the create-product modal and fill everything except the price. */
function openNewProduct() {
  fireEvent.click(tab('Add Product'));
  fireEvent.change(screen.getByLabelText('Product Name (EN)'), { target: { value: 'Test Item' } });
  fireEvent.change(screen.getByLabelText('Product Name (AR)'), { target: { value: 'صنف' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'c1' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('product price validation — the money contract', () => {
  it('REJECTS a zero price instead of defaulting it', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<MenuManagementPanel />);
    openNewProduct();
    fireEvent.change(screen.getByLabelText('Price (SAR)'), { target: { value: '0' } });
    submitDialog();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(addProduct).not.toHaveBeenCalled();
  });

  it('REJECTS a negative price', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<MenuManagementPanel />);
    openNewProduct();
    fireEvent.change(screen.getByLabelText('Price (SAR)'), { target: { value: '-5' } });
    submitDialog();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(addProduct).not.toHaveBeenCalled();
  });

  it('REJECTS a non-numeric price', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<MenuManagementPanel />);
    openNewProduct();
    fireEvent.change(screen.getByLabelText('Price (SAR)'), { target: { value: 'abc' } });
    submitDialog();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(addProduct).not.toHaveBeenCalled();
  });

  it('accepts a valid price and sends it as a NUMBER', () => {
    render(<MenuManagementPanel />);
    openNewProduct();
    fireEvent.change(screen.getByLabelText('Price (SAR)'), { target: { value: '24.50' } });
    submitDialog();
    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(addProduct.mock.calls[0][0]).toMatchObject({
      categoryId: 'c1', nameEn: 'Test Item', nameAr: 'صنف', price: 24.5,
    });
  });

  it('will not submit without a category — an orphan product cannot be shown', () => {
    render(<MenuManagementPanel />);
    fireEvent.click(tab('Add Product'));
    fireEvent.change(screen.getByLabelText('Product Name (EN)'), { target: { value: 'Test Item' } });
    fireEvent.change(screen.getByLabelText('Product Name (AR)'), { target: { value: 'صنف' } });
    fireEvent.change(screen.getByLabelText('Price (SAR)'), { target: { value: '24.50' } });
    submitDialog();
    expect(addProduct).not.toHaveBeenCalled();
  });
});

describe('destructive confirmations', () => {
  it('does NOT delete a product when the confirm is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MenuManagementPanel />);
    fireEvent.click(screen.getByLabelText('Delete product'));
    expect(deleteProduct).not.toHaveBeenCalled();
  });

  it('deletes a product when the confirm is accepted', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MenuManagementPanel />);
    fireEvent.click(screen.getByLabelText('Delete product'));
    expect(deleteProduct).toHaveBeenCalledWith('p1');
  });

  it('does NOT delete a category when the confirm is declined', () => {
    // Larger blast radius: deleting a category disables every product in it.
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MenuManagementPanel />);
    fireEvent.click(tab('Menu Categories'));
    fireEvent.click(screen.getByLabelText('Delete category'));
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it('deletes a category when the confirm is accepted', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MenuManagementPanel />);
    fireEvent.click(tab('Menu Categories'));
    fireEvent.click(screen.getByLabelText('Delete category'));
    expect(deleteCategory).toHaveBeenCalledWith('c1');
  });
});

describe('accountant permission gate', () => {
  beforeEach(() => mockContext({ currentUser: { role: 'accountant' } }));

  it('disables add, edit and delete on products', () => {
    render(<MenuManagementPanel />);
    expect((tab('Add Product') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Edit product') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Delete product') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables add, edit and delete on categories', () => {
    render(<MenuManagementPanel />);
    fireEvent.click(tab('Menu Categories'));
    expect((tab('Add Category') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Edit category') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Delete category') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CSV bulk upload', () => {
  it('refuses to parse an empty paste box', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<MenuManagementPanel />);
    fireEvent.click(tab('Excel/CSV Bulk Import'));
    fireEvent.click(tab('Validate and Parse Spreadsheet'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(bulkUploadMenu).not.toHaveBeenCalled();
  });

  it('offers no commit control until a parse has run', () => {
    // Two-step on purpose: parse and review, then commit.
    render(<MenuManagementPanel />);
    fireEvent.click(tab('Excel/CSV Bulk Import'));
    expect(screen.queryByRole('button', { name: 'Commit Bulk Upload to Menu' })).toBeNull();
    expect(bulkUploadMenu).not.toHaveBeenCalled();
  });
});
