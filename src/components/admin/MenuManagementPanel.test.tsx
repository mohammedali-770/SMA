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
// Two price tiers, as a Lazywait-imported product has: `price` is the CHEAPEST
// one and the table must present it as a "from" price, not as the price.
const product = {
  id: 'p1', categoryId: 'c1', nameEn: 'Fries', nameAr: 'بطاطس',
  descriptionEn: '', descriptionAr: '', price: 5, calories: 300,
  imageUrl: 'https://example.test/f.jpg', isActive: true, modifierGroupIds: [],
  variants: [
    { id: 'v1', productId: 'p1', nameEn: 'Small', nameAr: 'صغير', price: 5,
      calories: 300, sortOrder: 1, isActive: true, lazywaitPriceId: 'LW_S' },
    { id: 'v2', productId: 'p1', nameEn: 'Large', nameAr: 'كبير', price: 13,
      calories: 600, sortOrder: 2, isActive: true, lazywaitPriceId: 'LW_L' },
  ],
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

  /**
   * The commit used to be fire-and-forget: it called bulkUploadMenu without
   * awaiting it, then unconditionally alerted "Successfully loaded N products"
   * using the PARSED count, and cleared the parsed result. A total failure and a
   * half-written menu were therefore indistinguishable from a clean import, and
   * the CSV needed to retry had already been discarded.
   *
   * The import is not transactional — rows go in one at a time — so the failure
   * path has to report what actually landed and keep the parsed result.
   */
  const HEADER =
    'category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url';
  const TWO_ROWS =
    `${HEADER}\n`
    + 'Burgers,برجر,Test Burger,برجر تجريبي,tasty,لذيذ,25.50,600,http://img\n'
    + 'Burgers,برجر,Second Burger,برجر ثاني,also tasty,لذيذ,30.00,700,http://img2';

  function parseTwoRows() {
    fireEvent.click(tab('Excel/CSV Bulk Import'));
    fireEvent.change(screen.getByPlaceholderText(/category_name_en/i), { target: { value: TWO_ROWS } });
    fireEvent.click(tab('Validate and Parse Spreadsheet'));
  }

  it('reports the count the server actually wrote, not the parsed count', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    // Two rows parsed, but the server reports one written and one skipped.
    bulkUploadMenu.mockResolvedValue({ success: true, count: 1, skipped: 1 });
    render(<MenuManagementPanel />);
    parseTwoRows();

    fireEvent.click(screen.getByRole('button', { name: 'Commit Bulk Upload to Menu' }));
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());

    const msg = String(alertSpy.mock.calls.at(-1)?.[0]);
    expect(msg).toContain('1 products');   // what was written
    expect(msg).not.toContain('2 products'); // NOT what was parsed
    expect(msg).toMatch(/1 product\(s\) were skipped/);
  });

  it('does not claim success when the import fails, and keeps the parsed CSV for a retry', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    // Failed after writing 1 of 2 — a partially imported menu, not a no-op.
    bulkUploadMenu.mockResolvedValue({ success: false, count: 1, skipped: 0 });
    render(<MenuManagementPanel />);
    parseTwoRows();

    fireEvent.click(screen.getByRole('button', { name: 'Commit Bulk Upload to Menu' }));
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());

    const msg = String(alertSpy.mock.calls.at(-1)?.[0]);
    expect(msg).toMatch(/failed/i);
    expect(msg).not.toMatch(/success/i);
    // Says the menu is now partially imported and that a retry duplicates rows.
    expect(msg).toMatch(/partially imported/i);
    expect(msg).toContain('1 of 2');

    // The parsed result survives, so the admin can inspect or retry it.
    expect(screen.getByRole('button', { name: 'Commit Bulk Upload to Menu' })).toBeTruthy();
  });

  it('cannot be double-submitted while a commit is in flight', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    // Never settles: the button must be disabled for the whole in-flight window.
    bulkUploadMenu.mockReturnValue(new Promise(() => {}));
    render(<MenuManagementPanel />);
    parseTwoRows();

    const btn = screen.getByRole('button', { name: 'Commit Bulk Upload to Menu' });
    fireEvent.click(btn);

    await vi.waitFor(() =>
      expect((screen.getByRole('button', { name: 'Importing…' }) as HTMLButtonElement).disabled).toBe(true));
    expect(bulkUploadMenu).toHaveBeenCalledTimes(1);
  });
});
