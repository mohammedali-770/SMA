/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
  BarChart3, Layers, ClipboardList, Store,
  Download, Plus, Trash2, Edit,
  Volume2, VolumeX, ShieldAlert, FileSpreadsheet, Eye, Settings
} from 'lucide-react';
import { useApp, canTransitionOrder } from '../context/AppContext';
import { Product, Category, Branch, OrderStatus, Order } from '../types';
import { getCSVTemplateData, parseCSVMenu, getVATBreakdown } from '../utils/calculations';
import { ADMIN_LOCALES } from './admin/adminLocales';
import { ReportsPanel } from './admin/ReportsPanel';
import { SettingsPanel } from './admin/SettingsPanel';
import { StatsPanel } from './admin/StatsPanel';
import { BranchPoliciesPanel } from './admin/BranchPoliciesPanel';


export const AdminDashboard: React.FC = () => {
  const {
    branches, categories, products, orders, profiles, currentUser, setCurrentUser,
    updateOrderStatus, addCategory, updateCategory, deleteCategory, addProduct,
    updateProduct, deleteProduct, toggleProductAvailability, isProductAvailableInBranch,
    updateBranchSettings, bulkUploadMenu, adminLang, setAdminLang, newOrderAlert, setNewOrderAlert, playNotificationSound,
    soundMuted, setSoundMuted,
    brandSettings, updateBrandSettings, lazywaitSettings, updateLazywaitSettings,
    paymentSettings, updatePaymentSettings, smsSettings, updateSmsSettings,
    notificationSettings, updateNotificationSettings, loyaltySettings, updateLoyaltySettings,
    updateCustomerPoints
  } = useApp();

  const [activeTab, setActiveTab] = useState<'stats' | 'orders' | 'menu' | 'branches' | 'reports' | 'settings'>('stats');
  const [menuSubTab, setMenuSubTab] = useState<'categories' | 'products' | 'csv'>('products');
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  
  // Dialogs and edits states
  const [activeReceiptOrder, setActiveReceiptOrder] = useState<Order | null>(null);
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

  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';

  // Active-order count drives the sidebar "Live Orders" badge.
  const activeOrdersCount = orders
    .filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    .length;

  // Handles updating an order's status
  const handleUpdateStatus = (orderId: string, status: OrderStatus) => {
    if (isAccountant) return;
    updateOrderStatus(orderId, status);
    
    // Auto update the view dialog if open
    if (activeReceiptOrder?.id === orderId) {
      const match = orders.find(o => o.id === orderId);
      if (match) {
        setActiveReceiptOrder({ ...match, status });
      }
    }
  };

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

  // Active orders filter list
  const filteredOrders = orders.filter(o => {
    const matchesSearch = o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) || 
                          o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.customerPhone.includes(orderSearch);
    
    const matchesFilter = orderFilter === 'all' || o.status === orderFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex-1 glass-panel flex flex-col h-full min-h-[700px] rounded-2xl overflow-hidden select-none" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      
      {/* Realtime Alert Pulsing banner if newOrderAlert is active */}
      {newOrderAlert && (
        <div className="bg-secondary text-white p-3.5 flex justify-between items-center animate-pulse z-40">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5" />
            <span className="text-xs font-black tracking-wide">{t.realtime_pulse}</span>
          </div>
          <div className="flex gap-2">
            {!soundMuted && (
              <button
                onClick={() => playNotificationSound()}
                className="bg-white/20 hover:bg-white/30 text-white text-[10px] font-bold py-1 px-3 rounded-md transition-colors"
              >
                🔔 {isRTL ? 'إعادة صوت الرنين' : 'Replay Ring'}
              </button>
            )}
            <button 
              onClick={() => setNewOrderAlert(false)}
              className="bg-white text-secondary text-[10px] font-black py-1 px-3 rounded-md shadow-xs"
            >
              {t.dismiss}
            </button>
          </div>
        </div>
      )}

      {/* Admin Title bar Header */}
      <div className="bg-white/20 backdrop-blur-md border-b border-slate-200/60 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-lg font-black text-primary flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-secondary" />
            {t.dashboard_title}
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">{isRTL ? 'نظام التحكم والربط المباشر لفروع سبايسي ميل' : 'Real-time synchronization console connected to live Fast-Food branches'}</p>
        </div>

        {/* Global configurations / Language / Session roles */}
        <div className="flex flex-wrap items-center gap-3 self-end sm:self-auto">
          {/* Audio sound toggler */}
          <button
            onClick={() => setSoundMuted(!soundMuted)}
            className={`p-2 rounded-xl border transition-all ${soundMuted ? 'bg-red-50 text-red-500 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}
            title={soundMuted ? t.sound_alert_off : t.sound_alert_on}
          >
            {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Session Role switcher */}
          <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl border border-gray-200">
            <span className="text-[10px] text-gray-500 font-extrabold px-1.5 uppercase">{t.role}:</span>
            {profiles.filter(p => p.role !== 'customer').map(p => (
              <button 
                key={p.role}
                onClick={() => setCurrentUser(p)}
                className={`text-[10px] font-black px-2.5 py-1 rounded-lg capitalize transition-all ${currentUser.role === p.role ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-white/50'}`}
              >
                {p.fullName.split(' ')[0]} ({p.role})
              </button>
            ))}
          </div>

          {/* Admin panel English/Arabic translation switcher */}
          <button 
            onClick={() => setAdminLang(adminLang === 'en' ? 'ar' : 'en')}
            className="text-xs bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-xl font-bold text-gray-800 flex items-center gap-1"
          >
            ✕ {adminLang.toUpperCase()}
          </button>
        </div>
      </div>

      {/* Accountant role alert guard bar */}
      {isAccountant && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2 text-amber-900 text-xs font-semibold">
          <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span>{t.role_accountant_warning}</span>
        </div>
      )}

      {/* Main Row: Sidebar Tabs and Tab Viewports */}
      <div className="flex-1 flex flex-col md:flex-row">
        
        {/* Responsive Left Sidebar */}
        <div className="w-full md:w-[220px] bg-white/20 backdrop-blur-md border-b md:border-b-0 md:border-r border-slate-200/60 p-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          <button 
            onClick={() => setActiveTab('stats')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'stats' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>{isRTL ? 'الملخص اليومي' : 'Sales Overview'}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('orders')}
            className={`w-full text-left flex items-center justify-between text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'orders' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              <span>{isRTL ? 'الطلبات المباشرة' : 'Live Orders'}</span>
            </div>
            {activeOrdersCount > 0 && (
              <span className={`text-[9px] px-2 py-0.5 rounded-full ${activeTab === 'orders' ? 'bg-white text-primary' : 'bg-[#e02d3d] text-white'} font-black`}>
                {activeOrdersCount}
              </span>
            )}
          </button>

          <button 
            onClick={() => { setActiveTab('menu'); setMenuSubTab('products'); }}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'menu' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <Layers className="w-4 h-4" />
            <span>{isRTL ? 'إدارة المنيو والأسعار' : 'Menu Management'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('branches')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'branches' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <Store className="w-4 h-4" />
            <span>{isRTL ? 'تخصيص الفروع والتوفر' : 'Branch Policies'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('reports')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'reports' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isRTL ? 'التقارير والتحليلات المالية' : 'Financial Reports'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'settings' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <Settings className="w-4 h-4" />
            <span>{isRTL ? 'الربط السحابي والإعدادات' : 'Integrations & Settings'}</span>
          </button>
        </div>

        {/* Dynamic Tab Viewport container */}
        <div className="flex-1 p-4 overflow-y-auto">
          
          {/* TAB 1: SALES OVERVIEW & KPIs */}
          {activeTab === 'stats' && <StatsPanel />}

          {/* TAB 2: LIVE ORDERS STEAM */}
          {activeTab === 'orders' && (
            <div className="space-y-4 animate-fade-in">
              
              {/* Filter controls bar */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">{t.live_alerts}</h3>
                
                <div className="flex flex-wrap gap-1.5 bg-slate-200/50 backdrop-blur-md p-1 rounded-xl border border-slate-300/30">
                  {['all', 'received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'].map(st => (
                    <button 
                      key={st}
                      onClick={() => setOrderFilter(st)}
                      className={`text-[9.5px] font-bold px-2.5 py-1 rounded-lg uppercase transition-all ${orderFilter === st ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
                    >
                      {st === 'all' ? (isRTL ? 'الكل' : 'All') : st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live search input */}
              <div className="relative">
                <input 
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder={isRTL ? 'ابحث برقم الطلب، اسم العميل، جوال العميل...' : 'Search by order#, client, phone...'}
                  className="glass-input w-full text-xs rounded-xl py-2.5 px-4 outline-none text-slate-800"
                />
              </div>

              {/* Data Table */}
              <div className="glass-card rounded-2xl overflow-hidden overflow-x-auto">
                <table className="w-full text-left text-xs text-gray-500" style={{ textAlign: isRTL ? 'right' : 'left' }}>
                  <thead className="bg-gray-50 text-[10px] text-gray-400 font-bold uppercase">
                    <tr>
                      <th className="px-4 py-3">{t.order_id}</th>
                      <th className="px-4 py-3">{t.customer}</th>
                      <th className="px-4 py-3">{t.branch}</th>
                      <th className="px-4 py-3">{t.total_sar}</th>
                      <th className="px-4 py-3">{t.status}</th>
                      <th className="px-4 py-3">{t.sync}</th>
                      <th className="px-4 py-3">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredOrders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3.5 font-black text-primary">{order.orderNumber}</td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-gray-900">{order.customerName}</div>
                          <div className="text-[10px] text-gray-400">{order.customerPhone}</div>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-gray-700">
                          {isRTL ? order.branchNameAr : order.branchNameEn}
                        </td>
                        <td className="px-4 py-3.5 font-bold text-secondary">
                          {order.total.toFixed(2)} SAR
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-[9.5px] font-black px-2.5 py-0.5 rounded-full uppercase ${
                            order.status === 'delivered' 
                              ? 'bg-green-100 text-green-700'
                              : order.status === 'cancelled'
                              ? 'bg-red-100 text-red-700'
                              : order.status === 'received'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${
                            order.orderSyncStatus === 'synced' ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'
                          }`}>
                            {order.orderSyncStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <button 
                              onClick={() => setActiveReceiptOrder(order)}
                              className="bg-primary/5 hover:bg-primary hover:text-white border border-primary/10 text-primary py-1 px-2.5 rounded text-[10px] font-bold transition-colors flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>{t.view_details}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredOrders.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-gray-400 font-bold">
                          {t.no_orders}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {/* TAB 3: MENU & CONTENT MANAGEMENT (PHASE 8 NEW FEATURE) */}
          {activeTab === 'menu' && (
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
          )}

          {/* TAB 4: BRANCH MANAGEMENT & CUSTOM AVAILABILITY MATRIX */}
          {activeTab === 'branches' && <BranchPoliciesPanel />}

          {/* TAB 5: FINANCIAL REPORTS & ANALYTICS (PHASE 9) */}
          {activeTab === 'reports' && <ReportsPanel />}

          {/* TAB 6: INTEGRATIONS & SETTINGS (PHASE 10) */}
          {activeTab === 'settings' && <SettingsPanel />}
        </div>
      </div>

      {/* DETAILED DIGITAL RECEIPT DIALOG MODAL */}
      {activeReceiptOrder && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md overflow-hidden rounded-[2rem] shadow-2xl animate-scale-up" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="p-5 bg-white/20 border-b border-white/10 flex justify-between items-center">
              <div>
                <h4 className="text-xs font-black text-gray-500 uppercase">{isRTL ? 'تعديل حالة الكاشير الموحدة' : 'Live POS Status Controller'}</h4>
                <p className="text-sm font-extrabold text-primary">{activeReceiptOrder.orderNumber}</p>
              </div>
              <button 
                onClick={() => setActiveReceiptOrder(null)}
                className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center font-bold text-gray-400 hover:bg-gray-100 transition-all"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[480px] overflow-y-auto text-xs text-gray-700">
              
              {/* Order Status Controller dropdown selector */}
              <div className="bg-purple-50/30 border border-purple-100 p-3 rounded-xl space-y-2">
                <label className="block text-[10px] font-black text-primary uppercase">{isRTL ? 'تعديل حالة الطلب الحالية:' : 'SET REALTIME ORDER STATUS:'}</label>
                <div className="flex gap-2">
                  <select 
                    disabled={isAccountant}
                    value={activeReceiptOrder.status}
                    onChange={(e) => handleUpdateStatus(activeReceiptOrder.id, e.target.value as OrderStatus)}
                    className="flex-1 bg-white border border-gray-200 rounded-lg p-2 font-bold outline-none text-xs text-gray-800 disabled:opacity-50"
                  >
                    <option value="received" disabled={!canTransitionOrder(activeReceiptOrder.status, 'received')}>Received</option>
                    <option value="preparing" disabled={!canTransitionOrder(activeReceiptOrder.status, 'preparing')}>Preparing</option>
                    <option value="ready" disabled={!canTransitionOrder(activeReceiptOrder.status, 'ready')}>Ready (POS Buzzer)</option>
                    <option value="out_for_delivery" disabled={!canTransitionOrder(activeReceiptOrder.status, 'out_for_delivery')}>Out for Delivery</option>
                    <option value="delivered" disabled={!canTransitionOrder(activeReceiptOrder.status, 'delivered')}>Delivered</option>
                    <option value="cancelled" disabled={!canTransitionOrder(activeReceiptOrder.status, 'cancelled')}>Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Invoice Breakdown Details */}
              <div className="border border-gray-100 rounded-2xl p-3 space-y-2 bg-gray-50/50">
                <div className="flex justify-between">
                  <span className="text-gray-400">Customer:</span>
                  <span className="font-bold text-gray-800">{activeReceiptOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Phone:</span>
                  <span className="font-bold text-gray-800">{activeReceiptOrder.customerPhone}</span>
                </div>
                {activeReceiptOrder.address && (
                  <div className="pt-1.5 border-t border-gray-100">
                    <span className="text-gray-400 block text-[10px] mb-0.5">Delivery Short Address:</span>
                    <span className="font-bold text-gray-800 bg-white p-1.5 border border-gray-100 rounded-lg block leading-relaxed">
                      {activeReceiptOrder.address.label} • {activeReceiptOrder.address.description} <br/>
                      <span className="text-primary font-black uppercase text-[10px]">{activeReceiptOrder.address.nationalShortAddress}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Items Table inside Dialog */}
              <div className="space-y-2">
                <span className="block text-[10px] font-black text-gray-400 uppercase tracking-wider">Ordered Items:</span>
                <div className="space-y-1.5">
                  {activeReceiptOrder.items.map(item => (
                    <div key={item.id} className="flex justify-between items-center p-2 bg-white border border-gray-100 rounded-xl">
                      <div>
                        <div className="flex items-center gap-1 font-bold text-gray-900">
                          <span>{item.quantity}x</span>
                          <span>{isRTL ? item.nameAr : item.nameEn}</span>
                        </div>
                        {item.selectedModifiers.length > 0 && (
                          <p className="text-[9.5px] text-gray-400 pl-4 mt-0.5">
                            + {item.selectedModifiers.map(m => isRTL ? m.nameAr : m.nameEn).join(', ')}
                          </p>
                        )}
                      </div>
                      <span className="font-black text-secondary">{(item.price * item.quantity).toFixed(2)} SAR</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Simple billing table */}
              <div className="pt-2 border-t border-gray-100 space-y-1">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal:</span>
                  <span>{activeReceiptOrder.subtotal.toFixed(2)} SAR</span>
                </div>
                {activeReceiptOrder.deliveryFee > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Delivery Fee:</span>
                    <span>+{activeReceiptOrder.deliveryFee.toFixed(2)} SAR</span>
                  </div>
                )}
                {(activeReceiptOrder.discountAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>{isRTL ? 'خصم القسيمة' : 'Coupon Discount'}:</span>
                    <span>-{(activeReceiptOrder.discountAmount ?? 0).toFixed(2)} SAR</span>
                  </div>
                )}
                {(activeReceiptOrder.loyaltyDiscountAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-purple-600">
                    <span>{isRTL ? 'خصم نقاط الولاء' : 'Loyalty Discount'}:</span>
                    <span>-{(activeReceiptOrder.loyaltyDiscountAmount ?? 0).toFixed(2)} SAR</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-gray-900 text-sm pt-1 border-t border-gray-50">
                  <span>Grand Total (VAT Inclusive):</span>
                  <span>{activeReceiptOrder.total.toFixed(2)} SAR</span>
                </div>
              </div>

              {/* Mandatory VAT details stamp */}
              <div className="p-2 bg-gray-50 rounded-lg text-[9.5px] text-gray-400 flex justify-between">
                <span>{brandSettings?.vatPercentage || 15}% Saudi VAT component:</span>
                <span className="font-semibold">{getVATBreakdown(activeReceiptOrder.total, brandSettings?.vatPercentage || 15).vatAmount} SAR</span>
              </div>

            </div>
          </div>
        </div>
      )}

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

    </div>
  );
};
