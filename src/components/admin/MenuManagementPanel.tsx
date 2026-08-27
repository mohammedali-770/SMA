import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Edit, FileSpreadsheet, Loader2, Plus, Trash2 } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { menuOrder as menuOrderApi, productImages as productImageApi } from '../../lib/api';
import { moveWithin, productsInCategory, sortRows } from '../../lib/menuOrdering';
import { isAllowedProductImageSize, isAllowedProductImageType } from '../../lib/productImages';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import { Product, Category } from '../../types';
import { getCSVTemplateData, parseCSVMenu } from '../../utils/calculations';
import { Price } from '../Price';
import { ADMIN_LOCALES } from './adminLocales';
import { AdminModal } from './view/shared/AdminModal';

const TH = 'px-4 py-3 text-start';
const TD = 'px-4 py-2 align-middle';

const ICON_BTN = [
  'ds-motion inline-flex size-8 items-center justify-center rounded-[var(--radius-ds-sm)]',
  'border border-con-line bg-con-surface-2 transition-colors duration-150',
  'hover:bg-con-surface disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

const TEXTAREA = [
  'ds-motion w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-2.5',
  'text-[13px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

const SELECT = [
  'ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[15px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

/**
 * Menu management — products, categories and the CSV bulk uploader.
 *
 * Every write, validation rule and confirmation is carried over unchanged. Two
 * worth naming because they are easy to "tidy" into bugs:
 *
 *   The product price is REJECTED when it is not a finite number above zero,
 *   rather than silently defaulting. The default it used to fall back to hid
 *   typos and turned a legitimate 0 into 20.00 SAR.
 *
 *   The CSV commit is a two-step: parse and review first, then commit. The
 *   parse is deliberately allowed to succeed WITH warnings, because a sheet with
 *   one bad row should still let the other ninety through after a human looks.
 */
export const MenuManagementPanel: React.FC = () => {
  const {
    categories, products,
    addCategory, updateCategory, deleteCategory,
    addProduct, updateProduct, deleteProduct,
    bulkUploadMenu, currentUser, adminLang, reload,
  } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';
  const family = useDsFontClass();

  const [menuSubTab, setMenuSubTab] = useState<'categories' | 'products' | 'csv'>('products');

  // Dialogs and edits states
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catNameEn, setCatNameEn] = useState('');
  const [catNameAr, setCatNameAr] = useState('');

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [prodNameEn, setProdNameEn] = useState('');
  const [prodNameAr, setProdNameAr] = useState('');
  const [prodDescEn, setProdDescEn] = useState('');
  const [prodDescAr, setProdDescAr] = useState('');
  const [prodPrice, setProdPrice] = useState('30.00');
  const [prodCalories, setProdCalories] = useState('500');
  const [prodCatId, setProdCatId] = useState('');
  const [prodImg, setProdImg] = useState('');
  // One in-flight reorder at a time. The RPC rewrites a whole list, so two
  // overlapping moves would race and the slower response would win.
  const [reordering, setReordering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  // Upload state for the product photo. `prodImg` stays the single source of
  // truth for what gets saved — an upload just fills it in, so a hand-pasted
  // URL and an uploaded one are indistinguishable downstream.
  const [imgUploading, setImgUploading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  // CSV Parsing simulation state
  const [rawCsvText, setRawCsvText] = useState('');
  const [csvResult, setCsvResult] = useState<{ categories: Category[]; products: Product[]; errors: string[] } | null>(null);
  const [csvMsg, setCsvMsg] = useState('');
  // The import writes one row per product and is not idempotent, so a second
  // click while the first is in flight would duplicate the whole menu.
  const [csvCommitting, setCsvCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handles saving a category
  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAccountant || !catNameEn || !catNameAr) return;

    if (editingCategory) {
      updateCategory(editingCategory.id, catNameEn, catNameAr);
    } else {
      addCategory(catNameEn, catNameAr);
    }

    setEditingCategory(null);
    setCatNameEn('');
    setCatNameAr('');
    setIsCategoryModalOpen(false);
  };

  const handleOpenEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCatNameEn(cat.nameEn);
    setCatNameAr(cat.nameAr);
    setIsCategoryModalOpen(true);
  };

  // Handles saving a product
  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAccountant || !prodNameEn || !prodNameAr || !prodCatId) return;

    // Reject an empty/invalid/non-positive price rather than silently defaulting
    // it to 20.00 SAR (which hid typos and mapped a legitimate 0 to 20).
    const parsedPrice = parseFloat(prodPrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      alert(isRTL ? 'الرجاء إدخال سعر صحيح أكبر من صفر.' : 'Please enter a valid price greater than 0.');
      return;
    }

    const pData = {
      categoryId: prodCatId,
      nameEn: prodNameEn,
      nameAr: prodNameAr,
      descriptionEn: prodDescEn,
      descriptionAr: prodDescAr,
      price: parsedPrice,
      calories: parseInt(prodCalories) || 0,
      // NO stock-photo default. This used to persist an Unsplash BURGER into
      // image_url for any product saved without one, so a chicken-wings row
      // carried a photo of a burger forever. The mobile ProductCard already
      // renders a neutral dish icon when image_url is null, which is honest;
      // a confidently wrong photo is not.
      imageUrl: prodImg.trim(),
      isActive: true,
      modifierGroupIds: ['mg-heat-level'],
      // A hand-authored product has no Lazywait price tiers. Tiers arrive
      // only through the catalog import, which is where the menu is owned.
      variants: [],
    };

    if (editingProduct) {
      updateProduct({
        ...pData,
        id: editingProduct.id
      });
    } else {
      addProduct(pData);
    }

    setEditingProduct(null);
    setProdNameEn('');
    setProdNameAr('');
    setProdDescEn('');
    setProdDescAr('');
    setProdPrice('30.00');
    setProdCalories('500');
    setProdCatId('');
    setProdImg(''); setImgError(null); if (imgFileRef.current) imgFileRef.current.value = '';
    setIsProductModalOpen(false);
  };

  const handleOpenEditProduct = (p: Product) => {
    setEditingProduct(p);
    setProdNameEn(p.nameEn);
    setProdNameAr(p.nameAr);
    setProdDescEn(p.descriptionEn);
    setProdDescAr(p.descriptionAr);
    setProdPrice(p.price.toString());
    setProdCalories(p.calories.toString());
    setProdCatId(p.categoryId);
    setProdImg(p.imageUrl); setImgError(null); if (imgFileRef.current) imgFileRef.current.value = '';
    setIsProductModalOpen(true);
  };

  // CSV Drag and drop / selection parser handler
  // Both tables render in the SAME order the customer sees, so what the
  // administrator rearranges is what the menu actually is.
  const orderedCategories = sortRows(categories);

  // Send the WHOLE list: the RPC assigns ranks 1..N from array position, so a
  // partial list would renumber the menu against a stale picture. Reload after,
  // because sort_order is what every subsequent move is computed from.
  const runReorder = async (fn: () => Promise<void>) => {
    setReordering(true); setOrderError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : String(err));
    } finally {
      setReordering(false);
    }
  };

  const moveCategory = (index: number, direction: 'up' | 'down') => {
    const ids = moveWithin(orderedCategories, index, direction);
    if (!ids) return;  // already at an end — no pointless write
    void runReorder(() => menuOrderApi.categories(ids));
  };

  const moveProduct = (categoryId: string, index: number, direction: 'up' | 'down') => {
    const siblings = productsInCategory(products, categoryId);
    const ids = moveWithin(siblings, index, direction);
    if (!ids) return;
    void runReorder(() => menuOrderApi.products(categoryId, ids));
  };

  // Validate BEFORE uploading so a rejected file costs no round trip, using the
  // same rules the bucket enforces server-side (jpg/png/webp, <= 5 MB).
  const onPickProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgError(null);
    if (!isAllowedProductImageType({ type: file.type, name: file.name })) {
      setImgError(isRTL ? 'صيغة غير مدعومة. استخدم JPG أو PNG أو WebP.' : 'Unsupported format. Use JPG, PNG, or WebP.');
      if (imgFileRef.current) imgFileRef.current.value = '';
      return;
    }
    if (!isAllowedProductImageSize(file.size)) {
      setImgError(isRTL ? 'حجم الصورة كبير جداً (الحد ٥ ميجابايت).' : 'Image too large (5 MB max).');
      if (imgFileRef.current) imgFileRef.current.value = '';
      return;
    }
    setImgUploading(true);
    const previous = prodImg;
    try {
      const { publicUrl } = await productImageApi.upload(file);
      setProdImg(publicUrl);
      // Clean up the object this product used to point at, but ONLY if we
      // produced it. An external URL is left alone — it is not ours to delete.
      // Deliberately after the new URL is in hand, so a failed upload never
      // destroys the image still on the row.
      void productImageApi.removeByUrl(previous);
    } catch (err) {
      setImgError(err instanceof Error ? err.message : String(err));
    } finally {
      setImgUploading(false);
    }
  };

  const handleParseCSV = () => {
    if (!rawCsvText.trim()) {
      alert(adminLang === 'en' ? 'Please paste CSV lines first' : 'الرجاء لصق خطوط CSV أولاً');
      return;
    }
    const result = parseCSVMenu(rawCsvText, categories);
    setCsvResult(result);
    if (result.errors.length > 0) {
      setCsvMsg(adminLang === 'en' ? 'Warnings detected. Inspect list below.' : 'تم كشف تنبيهات بالتنسيق. افحص القائمة أدناه.');
    } else {
      setCsvMsg(t.parsed_success);
    }
  };

  // The import is NOT transactional: products are inserted one row at a time, so
  // a failure part-way through leaves the earlier rows live. This used to fire
  // and forget, then unconditionally alert "Successfully loaded N products" and
  // clear the parsed result — so a total failure and a half-written menu both
  // looked like a clean success, and the parsed CSV needed to retry was gone.
  // Await the real outcome, report what actually landed, and keep the parsed
  // result on any non-clean path so the admin can inspect or retry.
  const handleCommitCSV = async () => {
    if (isAccountant || !csvResult || csvResult.products.length === 0) return;
    if (csvCommitting) return; // guard the double-click; the write is not idempotent
    setCsvCommitting(true);
    try {
      const result = await bulkUploadMenu(csvResult.categories, csvResult.products);
      const skippedNote = result.skipped > 0
        ? (adminLang === 'en'
          ? ` ${result.skipped} product(s) were skipped because their category could not be matched.`
          : ` تم تخطي ${result.skipped} منتج لعدم إمكانية مطابقة تصنيفها.`)
        : '';

      if (!result.success) {
        // count > 0 here means the menu is now partially imported. Say so plainly:
        // the admin has to reconcile it, and re-running would duplicate those rows.
        alert(adminLang === 'en'
          ? `Import failed after writing ${result.count} of ${csvResult.products.length} products. `
            + `The menu is now partially imported — review the products list before retrying, `
            + `because re-running will insert the first ${result.count} again.${skippedNote}`
          : `فشل الاستيراد بعد إدراج ${result.count} من ${csvResult.products.length} منتج. `
            + `المنيو الآن مستورد جزئياً — راجع قائمة المنتجات قبل إعادة المحاولة، `
            + `لأن إعادة التشغيل ستدرج أول ${result.count} مرة أخرى.${skippedNote}`);
        setCsvMsg(adminLang === 'en' ? 'Import failed. See the message above.' : 'فشل الاستيراد. انظر الرسالة أعلاه.');
        return; // keep rawCsvText and csvResult so the admin can inspect or retry
      }

      alert(adminLang === 'en'
        ? `Successfully loaded ${result.count} products to the active menu database!${skippedNote}`
        : `تم إدراج ${result.count} وجبات بنجاح في منيو المطعم!${skippedNote}`);

      setRawCsvText('');
      setCsvResult(null);
      setCsvMsg('');
      setMenuSubTab('products');
    } finally {
      setCsvCommitting(false);
    }
  };

  // Drag and drop CSV file parsing simulation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setRawCsvText(text);
        const result = parseCSVMenu(text, categories);
        setCsvResult(result);
        if (result.errors.length > 0) {
          setCsvMsg(adminLang === 'en' ? 'Spreadsheet has layout warnings' : 'الجدول يحتوي على تحذيرات بالتنسيق');
        } else {
          setCsvMsg(t.parsed_success);
        }
      }
    };
    reader.readAsText(file);
  };

  const subTab = (id: typeof menuSubTab, label: string, icon?: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setMenuSubTab(id)}
      aria-current={menuSubTab === id ? 'page' : undefined}
      className={[
        'ds-motion inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4',
        'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
        menuSubTab === id ? 'border-ember' : 'border-transparent hover:bg-con-surface-2',
      ].join(' ')}
    >
      {icon}
      <Text variant="label" tone={menuSubTab === id ? 'ember' : 'secondary'} as="span">{label}</Text>
    </button>
  );

  return (
    <>
      <div className="space-y-4">
        <div className="flex border-b border-con-line">
          {subTab('products', t.products_tab)}
          {subTab('categories', t.categories_tab)}
          {subTab('csv', t.csv_tab, <FileSpreadsheet className="size-3.5" aria-hidden="true" />)}
        </div>

        {/* A refused reorder must be visible: reorder_products rejects the whole
            call when an id is not in the category (a stale tab), and silently
            swallowing that would leave the administrator dragging rows that
            never move. */}
        {orderError && <Notice title={orderError} tone="blocking" />}

        {menuSubTab === 'products' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Text variant="heading" as="h3">{t.products_tab}</Text>
              <Button
                label={t.add_prod_btn}
                onClick={() => { setEditingProduct(null); setIsProductModalOpen(true); }}
                disabled={isAccountant}
                leading={<Plus className="size-4" aria-hidden="true" />}
              />
            </div>

            <Card flush className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-con-line">
                      {[isRTL ? 'الترتيب' : 'Order', 'Photo', t.product_name_en, t.product_name_ar, t.category, t.price, t.calories, t.actions].map((h, i) => (
                        <th key={h || `sp-${i}`} className={TH}>
                          <Text variant="caption" tone="tertiary" as="span">{h}</Text>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Grouped by category, then by rank within it — the order
                        the customer actually sees. Flat-by-arrival made "move
                        up" meaningless, because a product's neighbour in the
                        table was rarely its neighbour in the app. */}
                    {orderedCategories.flatMap((cat) => productsInCategory(products, cat.id)).map((p, flatIndex, flat) => {
                      const catMatch = categories.find(c => c.id === p.categoryId);
                      // Position WITHIN the category is what the arrows move,
                      // because reorder_products is category-scoped.
                      const siblings = flat.filter((x) => x.categoryId === p.categoryId);
                      const indexInCategory = siblings.findIndex((x) => x.id === p.id);
                      // Defensive: a product reaching this table from a cast or
                      // a stale cache can arrive without `variants`, and an
                      // admin menu that throws is worse than one that shows a
                      // product with no tiers.
                      const tiers = p.variants ?? [];
                      return (
                        <tr key={p.id} className="border-t border-con-line">
                          <td className={TD}>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => moveProduct(p.categoryId, indexInCategory, 'up')}
                                disabled={isAccountant || reordering || indexInCategory === 0}
                                aria-label={isRTL ? 'تحريك للأعلى' : 'Move up'} className={ICON_BTN}>
                                <ArrowUp className="size-3.5 text-con-text-2" aria-hidden="true" />
                              </button>
                              <button type="button" onClick={() => moveProduct(p.categoryId, indexInCategory, 'down')}
                                disabled={isAccountant || reordering || indexInCategory === siblings.length - 1}
                                aria-label={isRTL ? 'تحريك للأسفل' : 'Move down'} className={ICON_BTN}>
                                <ArrowDown className="size-3.5 text-con-text-2" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                          <td className={TD}>
                            {/* No stock-photo stand-in: an administrator must be
                                able to see WHICH products still have no image. */}
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt={p.nameEn}
                                className="size-10 rounded-[var(--radius-ds-sm)] border border-con-line bg-con-surface-2 object-cover" />
                            ) : (
                              <span className="flex size-10 items-center justify-center rounded-[var(--radius-ds-sm)] border border-dashed border-con-line bg-con-surface-2">
                                <Text variant="caption" tone="tertiary" as="span">—</Text>
                              </span>
                            )}
                          </td>
                          <td className={TD}><Text variant="label" as="span">{p.nameEn}</Text></td>
                          <td className={TD}><Text variant="label" as="span" dir="rtl">{p.nameAr}</Text></td>
                          <td className={TD}>
                            {/* An orphaned product is a real problem — it cannot
                                appear in the app menu at all — so it reads as a
                                warning rather than as grey filler. */}
                            {catMatch
                              ? <Text variant="body" tone="secondary" as="span">{isRTL ? catMatch.nameAr : catMatch.nameEn}</Text>
                              : <StatusPill label="No Category" tone="warning" />}
                          </td>
                          <td className={TD}>
                            {/* With price tiers the product's own price is the
                                CHEAPEST one, so it is labelled "from" rather
                                than presented as the price of anything. The
                                tiers are listed under it because that is where
                                the money actually lives — and because a tier
                                Lazywait has withdrawn still has to be visible
                                to staff to explain an old order. */}
                            <Text variant="label" as="span">
                              {tiers.length > 1 ? <>{isRTL ? 'من ' : 'from '}</> : null}
                              <Price amount={p.price} lang={adminLang} />
                            </Text>
                            {tiers.length > 1 ? (
                              <ul className="mt-1 space-y-0.5">
                                {tiers.map(v => (
                                  <li key={v.id} className="flex items-center gap-1.5">
                                    <Text variant="caption" tone={v.isActive ? 'secondary' : 'tertiary'} as="span">
                                      {isRTL ? v.nameAr : v.nameEn}
                                    </Text>
                                    <Text variant="caption" tone={v.isActive ? 'secondary' : 'tertiary'} as="span">
                                      <Price amount={v.price} lang={adminLang} />
                                    </Text>
                                    {v.isActive ? null : <StatusPill label={isRTL ? 'غير معروض' : 'Hidden'} tone="neutral" />}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td className={TD}>
                            <Text variant="body" tone="secondary" numeric as="span">{p.calories} kcal</Text>
                          </td>
                          <td className={TD}>
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => handleOpenEditProduct(p)} disabled={isAccountant}
                                aria-label={isRTL ? 'تعديل المنتج' : 'Edit product'} className={ICON_BTN}>
                                <Edit className="size-3.5 text-con-text-2" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => { if (confirm('Delete product?')) deleteProduct(p.id); }}
                                disabled={isAccountant}
                                aria-label={isRTL ? 'حذف المنتج' : 'Delete product'}
                                className={ICON_BTN}
                              >
                                <Trash2 className="size-3.5 text-danger-ds" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {menuSubTab === 'categories' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Text variant="heading" as="h3">{t.categories_tab}</Text>
              <Button
                label={t.add_cat_btn}
                onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true); }}
                disabled={isAccountant}
                leading={<Plus className="size-4" aria-hidden="true" />}
              />
            </div>

            <Card flush className="max-w-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-con-line">
                      {[isRTL ? 'الترتيب' : 'Order', 'Category Name (EN)', 'Category Name (AR)', t.actions].map((h, i) => (
                        <th key={h || `sp-${i}`} className={TH}>
                          <Text variant="caption" tone="tertiary" as="span">{h}</Text>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedCategories.map((c, i) => (
                      <tr key={c.id} className="border-t border-con-line">
                        <td className={`${TD} py-3`}>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => moveCategory(i, 'up')}
                              disabled={isAccountant || reordering || i === 0}
                              aria-label={isRTL ? 'تحريك للأعلى' : 'Move up'} className={ICON_BTN}>
                              <ArrowUp className="size-3.5 text-con-text-2" aria-hidden="true" />
                            </button>
                            <button type="button" onClick={() => moveCategory(i, 'down')}
                              disabled={isAccountant || reordering || i === orderedCategories.length - 1}
                              aria-label={isRTL ? 'تحريك للأسفل' : 'Move down'} className={ICON_BTN}>
                              <ArrowDown className="size-3.5 text-con-text-2" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                        <td className={`${TD} py-3`}><Text variant="label" as="span">{c.nameEn}</Text></td>
                        <td className={`${TD} py-3`}><Text variant="label" as="span" dir="rtl">{c.nameAr}</Text></td>
                        <td className={`${TD} py-3`}>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => handleOpenEditCategory(c)} disabled={isAccountant}
                              aria-label={isRTL ? 'تعديل الفئة' : 'Edit category'} className={ICON_BTN}>
                              <Edit className="size-3.5 text-con-text-2" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { if (confirm('Delete Category? All associated products will be disabled.')) deleteCategory(c.id); }}
                              disabled={isAccountant}
                              aria-label={isRTL ? 'حذف الفئة' : 'Delete category'}
                              className={ICON_BTN}
                            >
                              <Trash2 className="size-3.5 text-danger-ds" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {menuSubTab === 'csv' && (
          <Card className="space-y-4">
            <div>
              <Text variant="title" as="h3">{t.csv_title}</Text>
              <Text variant="body" tone="tertiary" as="p" className="mt-1">{t.csv_help}</Text>
            </div>

            <a
              href={getCSVTemplateData()}
              download="spicy_meal_menu_template.csv"
              className="ds-motion inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-ds-md)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Download className="size-4 text-ember" aria-hidden="true" />
              <Text variant="label" tone="ember" as="span" className="underline">{t.download_template}</Text>
            </a>

            <div className="rounded-[var(--radius-ds-lg)] border-2 border-dashed border-con-line bg-con-surface-2 p-6 text-center">
              <input type="file" accept=".csv" onChange={handleFileUpload} ref={fileInputRef} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label={isRTL ? 'اختيار ملف CSV للاستيراد' : 'Choose a CSV file to import'}
                className="ds-motion w-full space-y-1 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <FileSpreadsheet className="mx-auto size-8 text-con-text-3" aria-hidden="true" />
                <Text variant="label" as="p">{t.drag_drop}</Text>
                <Text variant="caption" tone="tertiary" as="p">supports raw text sheets</Text>
              </button>
            </div>

            <label className="block space-y-1.5">
              <Text variant="caption" tone="tertiary" as="span" className="block">
                {t.pasted_csv}
              </Text>
              <textarea
                rows={4}
                value={rawCsvText}
                onChange={(e) => setRawCsvText(e.target.value)}
                placeholder="category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url"
                className={`${TEXTAREA} font-ds-num`}
              />
            </label>

            <Button label={t.parse_btn} onClick={handleParseCSV} />

            {csvResult && (
              <div className="space-y-3 rounded-[var(--radius-ds-lg)] border border-con-line bg-con-surface-2 p-4">
                <div className="flex items-center justify-between gap-2 border-b border-con-line pb-2">
                  <Text variant="label" as="span">{csvMsg}</Text>
                  <StatusPill label={`${t.parsed_count}: ${csvResult.products.length}`} tone="info" />
                </div>

                {/* Warnings do NOT block the commit: a sheet with one bad row
                    should still let the other ninety through once a human has
                    read the list. */}
                {csvResult.errors.length > 0 ? (
                  <Notice title={`${t.errors}:`} tone="blocking">
                    <ul className="list-disc ps-4">
                      {csvResult.errors.map((err, i) => (
                        <li key={i}><Text variant="caption" tone="danger" as="span">{err}</Text></li>
                      ))}
                    </ul>
                  </Notice>
                ) : (
                  <Notice title={`✓ ${t.no_errors}`} tone="success" />
                )}

                <div className="max-h-[140px] overflow-y-auto rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-con-line">
                        {['Parsed Name (EN)', 'Price', 'Calories'].map((h) => (
                          <th key={h} className="px-3 py-2 text-start">
                            <Text variant="caption" tone="tertiary" as="span">{h}</Text>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvResult.products.map((cp, idx) => (
                        <tr key={idx} className="border-t border-con-line">
                          <td className="px-3 py-1.5"><Text variant="caption" as="span">{cp.nameEn}</Text></td>
                          <td className="px-3 py-1.5">
                            <Text variant="caption" as="span"><Price amount={cp.price} lang={adminLang} /></Text>
                          </td>
                          <td className="px-3 py-1.5">
                            <Text variant="caption" tone="secondary" numeric as="span">{cp.calories} kcal</Text>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Button
                  label={csvCommitting
                    ? (adminLang === 'en' ? 'Importing…' : '...جاري الاستيراد')
                    : t.commit_btn}
                  onClick={handleCommitCSV}
                  disabled={isAccountant || csvResult.products.length === 0 || csvCommitting}
                  className="w-full"
                />
              </div>
            )}
          </Card>
        )}
      </div>

      {isCategoryModalOpen && (
        <AdminModal
          title={editingCategory ? 'Edit Menu Category' : 'Create Menu Category'}
          isRTL={isRTL}
          onClose={() => setIsCategoryModalOpen(false)}
          size="md"
        >
          {/* The form lives INSIDE the body, not split across body and footer,
              so Enter-to-submit and the browser's own `required` validation
              keep working exactly as they did. */}
          <form onSubmit={handleSaveCategory} className="space-y-3">
            <Field
              label="Category English Name"
              required
              value={catNameEn}
              onValueChange={setCatNameEn}
              placeholder="e.g., Crunchy Sides"
            />
            <Field
              label="Category Arabic Name"
              required
              value={catNameAr}
              onValueChange={setCatNameAr}
              placeholder="مثال: مقبلات مقرمشة"
              dir="rtl"
            />
            <button
              type="submit"
              className="ds-motion inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-ds-md)] bg-ember px-4 transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Text variant="label" tone="onEmber" as="span">{t.save}</Text>
            </button>
          </form>
        </AdminModal>
      )}

      {isProductModalOpen && (
        <AdminModal
          title={editingProduct ? 'Edit Menu Product' : 'Create Menu Product'}
          isRTL={isRTL}
          onClose={() => setIsProductModalOpen(false)}
        >
          <form onSubmit={handleSaveProduct} className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={t.product_name_en} required value={prodNameEn} onValueChange={setProdNameEn} placeholder="Spicy Tender Strips" />
              <Field label={t.product_name_ar} required value={prodNameAr} onValueChange={setProdNameAr} placeholder="ستربس الدجاج الحار" dir="rtl" />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-2">
                <span className="text-start text-[13px] font-semibold text-con-text-2">Description (EN)</span>
                <textarea rows={2} value={prodDescEn} onChange={(e) => setProdDescEn(e.target.value)} className={`${TEXTAREA} ${family}`} />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-start text-[13px] font-semibold text-con-text-2">Description (AR)</span>
                <textarea rows={2} dir="rtl" value={prodDescAr} onChange={(e) => setProdDescAr(e.target.value)} className={`${TEXTAREA} font-ds-ar`} />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Field label="Price (SAR)" type="number" step="0.01" required numeric value={prodPrice} onValueChange={setProdPrice} />
              <Field label="Calories" type="number" required numeric value={prodCalories} onValueChange={setProdCalories} />
              <label className="flex flex-col gap-2">
                <span className="text-start text-[13px] font-semibold text-con-text-2">Category</span>
                <select required value={prodCatId} onChange={(e) => setProdCatId(e.target.value)} className={`${SELECT} ${family}`}>
                  <option value="">-- Choose --</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{isRTL ? c.nameAr : c.nameEn}</option>)}
                </select>
              </label>
            </div>

            {/* Product photo. Lazywait cannot supply one — its catalog `photo`
                field is null on every item — so the dashboard is the only way
                a menu item gets a real picture. Upload writes to the
                product-images bucket (admin-only via RLS) and fills the URL
                field below; pasting a URL by hand still works unchanged. */}
            <div className="flex flex-col gap-2">
              <span className="text-start text-[13px] font-semibold text-con-text-2">
                {isRTL ? 'صورة المنتج' : 'Product image'}
              </span>
              <div className="flex items-center gap-3">
                {prodImg ? (
                  <img
                    src={prodImg}
                    alt={isRTL ? 'معاينة صورة المنتج' : 'Product image preview'}
                    className="size-16 shrink-0 rounded-[var(--radius-ds-md)] object-cover"
                  />
                ) : (
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-ds-md)] bg-con-surface-2">
                    <Text variant="caption" tone="tertiary" as="span">{isRTL ? 'لا صورة' : 'None'}</Text>
                  </span>
                )}
                <input
                  ref={imgFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void onPickProductImage(e)}
                  disabled={imgUploading}
                  aria-label={isRTL ? 'اختر صورة المنتج' : 'Choose product image'}
                  className={`block w-full text-[13px] text-con-text-2 file:me-2 file:cursor-pointer file:rounded-[var(--radius-ds-md)] file:border-0 file:bg-ember file:px-3 file:py-1.5 file:text-[13px] file:font-bold file:text-on-ember ${family}`}
                />
              </div>
              {imgUploading && (
                <Text variant="caption" tone="secondary" as="span" className="flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" /> {isRTL ? 'جاري الرفع…' : 'Uploading…'}
                </Text>
              )}
              {imgError && <Notice title={imgError} tone="blocking" />}
              {prodImg && (
                <button
                  type="button"
                  onClick={() => { const was = prodImg; setProdImg(''); setImgError(null); if (imgFileRef.current) imgFileRef.current.value = ''; void productImageApi.removeByUrl(was); }}
                  className="self-start text-[13px] font-semibold text-con-text-2 underline"
                >
                  {isRTL ? 'إزالة الصورة' : 'Remove image'}
                </button>
              )}
              <Text variant="caption" tone="tertiary" as="p">
                {isRTL
                  ? 'JPG أو PNG أو WebP، بحد أقصى ٥ ميجابايت. بدون صورة يظهر رمز محايد في التطبيق — وهو أفضل من صورة لا تخص الصنف.'
                  : 'JPG, PNG, or WebP, 5 MB max. With no image the app shows a neutral icon — better than a photo of the wrong dish.'}
              </Text>
            </div>

            <Field label="Image URL" value={prodImg} onValueChange={setProdImg} placeholder="https://…" />

            <button
              type="submit"
              className="ds-motion inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-ds-md)] bg-ember px-4 transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Text variant="label" tone="onEmber" as="span">{t.save}</Text>
            </button>
          </form>
        </AdminModal>
      )}
    </>
  );
};
