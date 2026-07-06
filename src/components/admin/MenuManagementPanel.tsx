import React, { useState, useRef } from 'react';
import { Download, Edit, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Product, Category } from '../../types';
import { getCSVTemplateData, parseCSVMenu } from '../../utils/calculations';
import { ADMIN_LOCALES } from './adminLocales';

export const MenuManagementPanel: React.FC = () => {
  const {
    categories, products, branches,
    addCategory, updateCategory, deleteCategory,
    addProduct, updateProduct, deleteProduct,
    toggleProductAvailability, isProductAvailableInBranch, bulkUploadMenu,
    currentUser, adminLang,
  } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';

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

  // CSV Parsing simulation state
  const [rawCsvText, setRawCsvText] = useState('');
  const [csvResult, setCsvResult] = useState<{ categories: Category[]; products: Product[]; errors: string[] } | null>(null);
  const [csvMsg, setCsvMsg] = useState('');
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
      imageUrl: prodImg || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80',
      isActive: true,
      modifierGroupIds: ['mg-heat-level']
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
    setProdImg('');
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
    setProdImg(p.imageUrl);
    setIsProductModalOpen(true);
  };

  // CSV Drag and drop / selection parser handler
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

  const handleCommitCSV = () => {
    if (isAccountant || !csvResult || csvResult.products.length === 0) return;
    bulkUploadMenu(csvResult.categories, csvResult.products);
    
    alert(adminLang === 'en' 
      ? `Successfully loaded ${csvResult.products.length} products to the active menu database!` 
      : `تم إدراج ${csvResult.products.length} وجبات بنجاح في منيو المطعم!`);

    setRawCsvText('');
    setCsvResult(null);
    setCsvMsg('');
    setMenuSubTab('products');
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

  return (
    <>
            <div className="space-y-4 animate-fade-in">
              
              {/* Sub tabs selectors */}
              <div className="flex border-b border-gray-200">
                <button 
                  onClick={() => setMenuSubTab('products')}
                  className={`py-2 px-4 text-xs font-black border-b-2 transition-all ${menuSubTab === 'products' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  {t.products_tab}
                </button>
                <button 
                  onClick={() => setMenuSubTab('categories')}
                  className={`py-2 px-4 text-xs font-black border-b-2 transition-all ${menuSubTab === 'categories' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  {t.categories_tab}
                </button>
                <button 
                  onClick={() => setMenuSubTab('csv')}
                  className={`py-2 px-4 text-xs font-black border-b-2 transition-all flex items-center gap-1.5 ${menuSubTab === 'csv' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>{t.csv_tab}</span>
                </button>
              </div>

              {/* SUB TAB 1: PRODUCT LIST & ADD FORM */}
              {menuSubTab === 'products' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black text-gray-800 uppercase">{t.products_tab}</h3>
                    <button 
                      onClick={() => { setEditingProduct(null); setIsProductModalOpen(true); }}
                      disabled={isAccountant}
                      className={`bg-primary text-white text-xs font-extrabold py-2 px-3.5 rounded-xl flex items-center gap-1 transition-all ${isAccountant ? 'opacity-50 cursor-not-allowed' : 'hover:scale-102'}`}
                    >
                      <Plus className="w-4 h-4" />
                      <span>{t.add_prod_btn}</span>
                    </button>
                  </div>

                  <div className="glass-card rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs text-gray-500" style={{ textAlign: isRTL ? 'right' : 'left' }}>
                      <thead className="bg-gray-50 text-[10px] text-gray-400 font-bold uppercase">
                        <tr>
                          <th className="px-4 py-3">Photo</th>
                          <th className="px-4 py-3">{t.product_name_en}</th>
                          <th className="px-4 py-3">{t.product_name_ar}</th>
                          <th className="px-4 py-3">{t.category}</th>
                          <th className="px-4 py-3">{t.price}</th>
                          <th className="px-4 py-3">{t.calories}</th>
                          <th className="px-4 py-3">{t.actions}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {products.map(p => {
                          const catMatch = categories.find(c => c.id === p.categoryId);
                          return (
                            <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-4 py-2">
                                <img src={p.imageUrl} alt={p.nameEn} className="w-10 h-10 object-cover rounded-lg bg-gray-50 border border-gray-100" />
                              </td>
                              <td className="px-4 py-2 font-bold text-gray-900">{p.nameEn}</td>
                              <td className="px-4 py-2 font-bold text-gray-900">{p.nameAr}</td>
                              <td className="px-4 py-2 text-primary font-bold">
                                {catMatch ? (isRTL ? catMatch.nameAr : catMatch.nameEn) : 'No Category'}
                              </td>
                              <td className="px-4 py-2 font-black text-secondary">{p.price.toFixed(2)} SAR</td>
                              <td className="px-4 py-2 font-semibold text-gray-600">{p.calories} kcal</td>
                              <td className="px-4 py-2">
                                <div className="flex gap-1.5">
                                  <button 
                                    onClick={() => handleOpenEditProduct(p)}
                                    disabled={isAccountant}
                                    className="p-1 rounded bg-gray-50 border border-gray-100 text-gray-600 hover:bg-gray-100 hover:text-primary transition-all disabled:opacity-50"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => { if (confirm('Delete product?')) deleteProduct(p.id); }}
                                    disabled={isAccountant}
                                    className="p-1 rounded bg-gray-50 border border-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* SUB TAB 2: CATEGORY LIST & ADD FORM */}
              {menuSubTab === 'categories' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black text-gray-800 uppercase">{t.categories_tab}</h3>
                    <button 
                      onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true); }}
                      disabled={isAccountant}
                      className={`bg-primary text-white text-xs font-extrabold py-2 px-3.5 rounded-xl flex items-center gap-1 transition-all ${isAccountant ? 'opacity-50 cursor-not-allowed' : 'hover:scale-102'}`}
                    >
                      <Plus className="w-4 h-4" />
                      <span>{t.add_cat_btn}</span>
                    </button>
                  </div>

                  <div className="glass-card rounded-2xl overflow-hidden max-w-xl">
                    <table className="w-full text-left text-xs text-gray-500" style={{ textAlign: isRTL ? 'right' : 'left' }}>
                      <thead className="bg-gray-50 text-[10px] text-gray-400 font-bold uppercase">
                        <tr>
                          <th className="px-4 py-3">Category Name (EN)</th>
                          <th className="px-4 py-3">Category Name (AR)</th>
                          <th className="px-4 py-3">{t.actions}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {categories.map(c => (
                          <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-4 py-3 font-extrabold text-primary">{c.nameEn}</td>
                            <td className="px-4 py-3 font-extrabold text-primary">{c.nameAr}</td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1.5">
                                <button 
                                  onClick={() => handleOpenEditCategory(c)}
                                  disabled={isAccountant}
                                  className="p-1 rounded bg-gray-50 border border-gray-100 text-gray-600 hover:bg-gray-100 hover:text-primary transition-all disabled:opacity-50"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={() => { if (confirm('Delete Category? All associated products will be disabled.')) deleteCategory(c.id); }}
                                  disabled={isAccountant}
                                  className="p-1 rounded bg-gray-50 border border-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* SUB TAB 3: SMART EXCEL/CSV BULK MENU UPLOADER */}
              {menuSubTab === 'csv' && (
                <div className="glass-card p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-black text-gray-900">{t.csv_title}</h3>
                    <p className="text-xs text-gray-400 mt-1">{t.csv_help}</p>
                  </div>

                  {/* Template download link button */}
                  <a 
                    href={getCSVTemplateData()} 
                    download="spicy_meal_menu_template.csv"
                    className="inline-flex items-center gap-1.5 text-xs text-secondary font-black hover:underline"
                  >
                    <Download className="w-4 h-4" />
                    <span>{t.download_template}</span>
                  </a>

                  {/* Drag and Drop uploader box */}
                  <div className="border-2 border-dashed border-slate-200 hover:border-[#422e87] rounded-2xl p-6 text-center transition-all cursor-pointer bg-white/40">
                    <input 
                      type="file" 
                      accept=".csv" 
                      onChange={handleFileUpload}
                      ref={fileInputRef}
                      className="hidden" 
                    />
                    <div onClick={() => fileInputRef.current?.click()} className="space-y-1">
                      <FileSpreadsheet className="w-8 h-8 text-primary/40 mx-auto" />
                      <p className="text-xs font-bold text-gray-700">{t.drag_drop}</p>
                      <p className="text-[10px] text-gray-400">supports raw text sheets</p>
                    </div>
                  </div>

                  {/* Pasted text container fallback */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black text-gray-400 uppercase">{t.pasted_csv}</label>
                    <textarea 
                      rows={4}
                      value={rawCsvText}
                      onChange={(e) => setRawCsvText(e.target.value)}
                      placeholder="category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url"
                      className="w-full text-[10px] font-mono p-2.5 border border-gray-100 bg-gray-50/50 rounded-xl outline-none focus:bg-white"
                    ></textarea>
                  </div>

                  <button 
                    onClick={handleParseCSV}
                    className="bg-primary text-white text-xs font-extrabold py-2 px-4 rounded-xl shadow-xs"
                  >
                    {t.parse_btn}
                  </button>

                  {/* Render parser outputs */}
                  {csvResult && (
                    <div className="border border-purple-100 bg-purple-50/20 rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-purple-50">
                        <span className="text-xs font-black text-primary">{csvMsg}</span>
                        <span className="text-xs bg-secondary text-white font-black px-2.5 py-0.5 rounded-full">
                          {t.parsed_count}: {csvResult.products.length}
                        </span>
                      </div>

                      {/* Validator reports */}
                      {csvResult.errors.length > 0 ? (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl space-y-1">
                          <h4 className="text-[10px] font-black text-red-700 uppercase">{t.errors}:</h4>
                          <ul className="list-disc pl-4 text-[9.5px] text-red-600 font-semibold space-y-0.5">
                            {csvResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                          </ul>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-green-50 text-green-700 text-[10px] rounded-lg font-bold border border-green-100">
                          ✓ {t.no_errors}
                        </div>
                      )}

                      {/* Preview table of products parsed */}
                      <div className="max-h-[140px] overflow-y-auto border border-gray-100 rounded-xl bg-white">
                        <table className="w-full text-[10px] text-gray-500 text-left">
                          <thead className="bg-gray-50 text-gray-400 font-bold uppercase">
                            <tr>
                              <th className="px-3 py-2">Parsed Name (EN)</th>
                              <th className="px-3 py-2">Price</th>
                              <th className="px-3 py-2">Calories</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {csvResult.products.map((cp, idx) => (
                              <tr key={idx}>
                                <td className="px-3 py-1.5 font-bold text-gray-800">{cp.nameEn}</td>
                                <td className="px-3 py-1.5 font-bold text-secondary">{cp.price.toFixed(2)} SAR</td>
                                <td className="px-3 py-1.5">{cp.calories} kcal</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <button 
                        onClick={handleCommitCSV}
                        disabled={isAccountant || csvResult.products.length === 0}
                        className={`w-full text-center text-xs font-black py-2.5 rounded-xl transition-all ${isAccountant || csvResult.products.length === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-secondary text-white hover:bg-secondary/95'}`}
                      >
                        {t.commit_btn}
                      </button>
                    </div>
                  )}

                </div>
              )}

            </div>

      {/* MODAL 5: CATEGORY CREATE/EDIT DRAWER */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveCategory} className="glass-panel w-full max-w-sm overflow-hidden p-6 space-y-4 rounded-[2rem] shadow-2xl" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="flex justify-between items-center pb-3 border-b border-slate-200/50">
              <h3 className="text-sm font-black text-slate-800 uppercase">{editingCategory ? 'Edit Menu Category' : 'Create Menu Category'}</h3>
              <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Category English Name</label>
                <input 
                  type="text"
                  required
                  value={catNameEn}
                  onChange={(e) => setCatNameEn(e.target.value)}
                  placeholder="e.g., Crunchy Sides"
                  className="glass-input w-full text-xs p-2.5 outline-none text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Category Arabic Name</label>
                <input 
                  type="text"
                  required
                  value={catNameAr}
                  onChange={(e) => setCatNameAr(e.target.value)}
                  placeholder="مثال: مقبلات مقرمشة"
                  className="glass-input w-full text-xs p-2.5 outline-none text-slate-800"
                />
              </div>
            </div>

            <button type="submit" className="glass-btn-primary w-full py-2.5 text-xs">
              {t.save}
            </button>
          </form>
        </div>
      )}

      {/* MODAL 6: PRODUCT CREATE/EDIT DRAWER */}
      {isProductModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveProduct} className="glass-panel w-full max-w-md overflow-hidden p-6 space-y-4 rounded-[2rem] shadow-2xl" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="flex justify-between items-center pb-3 border-b border-slate-200/50">
              <h3 className="text-sm font-black text-slate-800 uppercase">{editingProduct ? 'Edit Menu Product' : 'Create Menu Product'}</h3>
              <button type="button" onClick={() => setIsProductModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">{t.product_name_en}</label>
                  <input 
                    type="text"
                    required
                    value={prodNameEn}
                    onChange={(e) => setProdNameEn(e.target.value)}
                    placeholder="Spicy Tender Strips"
                    className="glass-input w-full text-xs p-2 outline-none text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">{t.product_name_ar}</label>
                  <input 
                    type="text"
                    required
                    value={prodNameAr}
                    onChange={(e) => setProdNameAr(e.target.value)}
                    placeholder="ستربس الدجاج الحار"
                    className="glass-input w-full text-xs p-2 outline-none text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Description (EN)</label>
                  <textarea 
                    value={prodDescEn}
                    onChange={(e) => setProdDescEn(e.target.value)}
                    className="glass-input w-full text-xs p-2 outline-none text-slate-800"
                    rows={2}
                  ></textarea>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Description (AR)</label>
                  <textarea 
                    value={prodDescAr}
                    onChange={(e) => setProdDescAr(e.target.value)}
                    className="glass-input w-full text-xs p-2 outline-none text-slate-800"
                    rows={2}
                  ></textarea>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Price (SAR)</label>
                  <input 
                    type="number"
                    step="0.01"
                    required
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    className="glass-input w-full text-xs p-2 outline-none text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Calories</label>
                  <input 
                    type="number"
                    required
                    value={prodCalories}
                    onChange={(e) => setProdCalories(e.target.value)}
                    className="glass-input w-full text-xs p-2 outline-none text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Category</label>
                  <select 
                    required
                    value={prodCatId}
                    onChange={(e) => setProdCatId(e.target.value)}
                    className="glass-input w-full text-xs p-2 outline-none text-slate-800 font-bold"
                  >
                    <option value="">-- Choose --</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{isRTL ? c.nameAr : c.nameEn}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Image URL</label>
                <input 
                  type="text"
                  value={prodImg}
                  onChange={(e) => setProdImg(e.target.value)}
                  placeholder="https://unsplash..."
                  className="glass-input w-full text-xs p-2 outline-none text-slate-800"
                />
              </div>
            </div>

            <button type="submit" className="glass-btn-primary w-full py-2.5 text-xs">
              {t.save}
            </button>
          </form>
        </div>
      )}
    </>
  );
};
