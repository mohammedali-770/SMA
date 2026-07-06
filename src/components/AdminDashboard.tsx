/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  BarChart3, Layers, ClipboardList, Store, Search, 
  Upload, Download, Plus, Trash2, Edit, Check, AlertCircle, 
  Volume2, VolumeX, ShieldAlert, FileSpreadsheet, RefreshCw, Eye,
  Settings, Sliders, CreditCard, MessageSquare, Bell, Gift
} from 'lucide-react';
import { useApp, canTransitionOrder } from '../context/AppContext';
import { Product, Category, Branch, OrderStatus, Order } from '../types';
import { getCSVTemplateData, parseCSVMenu, getVATBreakdown } from '../utils/calculations';

const ADMIN_LOCALES = {
  en: {
    dashboard_title: 'Spicy Meal Command Center',
    role_alert: 'Role-Based Access Guard',
    role_accountant_warning: 'Accountant profile active: Database write and POS state modifications are disabled.',
    stats_revenue: 'Today\'s Gross Sales',
    stats_orders: 'Total Active Orders',
    stats_ticket: 'Average Ticket Value',
    stats_branches: 'Operational Branches',
    live_alerts: 'Live Incoming Orders Stream',
    sound_alert_on: 'Realtime POS sound is enabled',
    sound_alert_off: 'POS audio mute is active',
    order_id: 'Order ID',
    customer: 'Customer',
    branch: 'Branch',
    total_sar: 'Total (SAR)',
    status: 'Status',
    sync: 'POS Sync',
    actions: 'Actions',
    view_details: 'View Receipt',
    no_orders: 'No incoming orders yet.',
    categories_tab: 'Menu Categories',
    products_tab: 'Menu Products',
    csv_tab: 'Excel/CSV Bulk Import',
    branch_tab: 'Branch Availability Matrix',
    add_cat_btn: 'Add Category',
    add_prod_btn: 'Add Product',
    edit_branch_title: 'Edit Branch Policy',
    delivery_fee: 'Delivery Fee',
    min_order: 'Min. Order SAR',
    status_open: 'Open',
    status_closed: 'Closed / Under Maintenance',
    csv_title: 'CSV Bulk Menu Upload',
    csv_help: 'Upload a CSV spreadsheet to bulk-add categories and products. Download our starter template below.',
    download_template: 'Download CSV Spreadsheet Template',
    drag_drop: 'Click to select or paste CSV contents raw below',
    pasted_csv: 'Or paste raw CSV comma-separated lines here:',
    parse_btn: 'Validate and Parse Spreadsheet',
    parsed_success: 'Spreadsheet parsed successfully!',
    parsed_count: 'Detected products',
    commit_btn: 'Commit Bulk Upload to Menu',
    errors: 'Parsing Errors',
    no_errors: 'No errors. Clean formatting.',
    product_name_en: 'Product Name (EN)',
    product_name_ar: 'Product Name (AR)',
    price: 'Price SAR (VAT inclusive)',
    calories: 'Calories',
    category: 'Category',
    save: 'Save Changes',
    cancel: 'Cancel',
    realtime_pulse: 'Incoming order alert buzzer active!',
    dismiss: 'Dismiss Alert',
    role: 'Session Role',
  },
  ar: {
    dashboard_title: 'لوحة تحكم سبايسي ميل الإدارية',
    role_alert: 'حارس الصلاحيات والأدوار',
    role_accountant_warning: 'حساب محاسب نشط: تم تعطيل تعديل الأسعار والمنيو والتحكم بحالات الطلب.',
    stats_revenue: 'إجمالي المبيعات اليومية',
    stats_orders: 'الطلبات النشطة اليوم',
    stats_ticket: 'متوسط الفاتورة الشرائية',
    stats_branches: 'الفروع المفتوحة الآن',
    live_alerts: 'بث الطلبات المباشرة الواردة',
    sound_alert_on: 'صوت التنبيهات المباشر نشط',
    sound_alert_off: 'صوت التنبيهات مكتوم',
    order_id: 'رقم الطلب',
    customer: 'العميل',
    branch: 'الفرع',
    total_sar: 'المجموع (ر.س)',
    status: 'الحالة',
    sync: 'مزامنة الكاشير',
    actions: 'الإجراءات',
    view_details: 'عرض الفاتورة',
    no_orders: 'لا توجد طلبات واردة حالياً.',
    categories_tab: 'تصنيفات الطعام',
    products_tab: 'قائمة وجبات المنيو',
    csv_tab: 'رفع منيو بملف Excel/CSV',
    branch_tab: 'مصفوفة توفر المنتجات بالفروع',
    add_cat_btn: 'إضافة تصنيف جديد',
    add_prod_btn: 'إضافة منتج جديد',
    edit_branch_title: 'تعديل سياسات التوصيل بالفرع',
    delivery_fee: 'رسوم التوصيل',
    min_order: 'الحد الأدنى بالريال',
    status_open: 'مفتوح',
    status_closed: 'مغلق للصيانة / مغلق الآن',
    csv_title: 'رفع قائمة الطعام الذكي',
    csv_help: 'قم بتحميل جدول البيانات بصيغة CSV لرفع وتحديث المنيو دفعة واحدة لجميع الفروع.',
    download_template: 'تحميل نموذج ملف Excel الجاهز',
    drag_drop: 'انقر لتحديد الملف أو الصق محتوياته بالأسفل',
    pasted_csv: 'أو الصق أسطر الـ CSV هنا مباشرة للتجربة الفورية:',
    parse_btn: 'فحص وتدقيق الجدول المرفوع',
    parsed_success: 'تم فحص وتدقيق الجدول بنجاح تام!',
    parsed_count: 'عدد الوجبات المستخرجة',
    commit_btn: 'حفظ وتحديث المنيو النهائي',
    errors: 'أخطاء التنسيق',
    no_errors: 'تنسيق سليم بالكامل وخالي من الأخطاء.',
    product_name_en: 'اسم الوجبة (إنجليزي)',
    product_name_ar: 'اسم الوجبة (عربي)',
    price: 'السعر شامل ضريبة ١٥٪',
    calories: 'السعرات الحرارية',
    category: 'التصنيف',
    save: 'حفظ التغييرات',
    cancel: 'إلغاء',
    realtime_pulse: 'تنبيه طوارئ: تم تلقي طلب جديد حار!',
    dismiss: 'إيقاف التنبيه',
    role: 'دور الجلسة الحالية',
  }
};

export const AdminDashboard: React.FC = () => {
  const {
    branches, categories, products, orders, profiles, currentUser, setCurrentUser,
    updateOrderStatus, addCategory, updateCategory, deleteCategory, addProduct,
    updateProduct, deleteProduct, toggleProductAvailability, isProductAvailableInBranch,
    updateBranchSettings, bulkUploadMenu, adminLang, setAdminLang, newOrderAlert, setNewOrderAlert, playNotificationSound,
    brandSettings, updateBrandSettings, lazywaitSettings, updateLazywaitSettings,
    paymentSettings, updatePaymentSettings, smsSettings, updateSmsSettings,
    notificationSettings, updateNotificationSettings, loyaltySettings, updateLoyaltySettings,
    updateCustomerPoints
  } = useApp();

  const [activeTab, setActiveTab] = useState<'stats' | 'orders' | 'menu' | 'branches' | 'reports' | 'settings'>('stats');
  const [settingsSubTab, setSettingsSubTab] = useState<'brand' | 'lazywait' | 'payments' | 'sms' | 'notifications' | 'loyalty'>('brand');
  const [pointAdjustments, setPointAdjustments] = useState<{ [profileId: string]: string }>({});
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState<string | null>(null);
  const [syncingMenu, setSyncingMenu] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<'sales_by_day' | 'sales_by_branch' | 'sales_by_product' | 'coupon_usage' | 'delivery_fees' | 'lazywait_report'>('sales_by_day');
  const [reportBranchId, setReportBranchId] = useState<string>('all');
  const [reportStartDate, setReportStartDate] = useState<string>('2026-07-01');
  const [reportEndDate, setReportEndDate] = useState<string>('2026-07-31');
  const [menuSubTab, setMenuSubTab] = useState<'categories' | 'products' | 'csv'>('products');
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false);
  
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

  // Stats aggregate computations
  const totalRevenue = orders
    .filter(o => o.status === 'delivered')
    .reduce((acc, o) => acc + o.total, 0);

  const activeOrdersCount = orders
    .filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    .length;

  const averageTicketValue = orders.length > 0 
    ? Number((orders.reduce((acc, o) => acc + o.total, 0) / orders.length).toFixed(2))
    : 0;

  const operationalBranchesCount = branches.filter(b => b.isActive).length;

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

    const pData = {
      categoryId: prodCatId,
      nameEn: prodNameEn,
      nameAr: prodNameAr,
      descriptionEn: prodDescEn,
      descriptionAr: prodDescAr,
      price: parseFloat(prodPrice) || 20.00,
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
            {!isMuted && (
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
            onClick={() => setIsMuted(!isMuted)}
            className={`p-2 rounded-xl border transition-all ${isMuted ? 'bg-red-50 text-red-500 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}
            title={isMuted ? t.sound_alert_off : t.sound_alert_on}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
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
          {activeTab === 'stats' && (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                
                {/* Metric Gross revenue */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_revenue}</span>
                  <p className="text-xl font-black text-[#422e87] mt-1">{totalRevenue.toFixed(2)} SAR</p>
                  <p className="text-[9px] text-green-600 font-bold mt-1">↑ 12.5% {isRTL ? 'منذ الأمس' : 'vs yesterday'}</p>
                </div>

                {/* Metric Active order counts */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_orders}</span>
                  <p className="text-xl font-black text-[#e02d3d] mt-1">{activeOrdersCount} {isRTL ? 'طلبات قيد المتابعة' : 'Active'}</p>
                  <p className="text-[9px] text-[#422e87] font-bold mt-1">● {orders.length - activeOrdersCount} {isRTL ? 'طلبات مكتملة اليوم' : 'Completed today'}</p>
                </div>

                {/* Metric ticket value */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_ticket}</span>
                  <p className="text-xl font-black text-slate-800 mt-1">{averageTicketValue.toFixed(2)} SAR</p>
                  <p className="text-[9px] text-gray-400 mt-1">{isRTL ? 'شامل ضريبة القيمة المضافة ١٥٪' : 'VAT-inclusive average ticket'}</p>
                </div>

                {/* Metric Operational branches */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_branches}</span>
                  <p className="text-xl font-black text-green-700 mt-1">{operationalBranchesCount} / {branches.length}</p>
                  <p className="text-[9px] text-[#e02d3d] font-bold mt-1">⚠ {branches.length - operationalBranchesCount} {isRTL ? 'فروع مغلقة للصيانة' : 'branches closed'}</p>
                </div>

              </div>

              {/* Graphic Daily Sales distribution Chart - SVG */}
              <div className="glass-card p-4 rounded-2xl">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider">{isRTL ? 'مبيعات فروع المملكة اليومية مقارنة بالأمس' : 'Daily Branch Sales Performance Distribution'}</h3>
                  <span className="text-[10px] bg-purple-50 text-primary font-bold px-2 py-0.5 rounded-full">{isRTL ? 'تحديث تلقائي' : 'Realtime Sync'}</span>
                </div>

                {/* SVG Chart */}
                <div className="h-44 w-full flex items-end justify-around pt-4 border-b border-gray-100">
                  {branches.map((b, i) => {
                    const bOrders = orders.filter(o => o.branchId === b.id);
                    const bSum = bOrders.reduce((acc, o) => acc + o.total, 0);
                    // calculate dynamic height percentage
                    const maxScale = Math.max(...branches.map(br => orders.filter(o => o.branchId === br.id).reduce((acc, o) => acc + o.total, 0))) || 100;
                    const pct = Math.max(12, (bSum / maxScale) * 100);

                    return (
                      <div key={b.id} className="flex flex-col items-center w-1/4">
                        <div className="text-[9px] font-black text-secondary mb-1">{bSum.toFixed(0)} SAR</div>
                        
                        {/* Dynamic Bar */}
                        <div 
                          className="w-8 rounded-t-lg bg-gradient-to-t from-primary to-secondary transition-all duration-500 shadow-xs"
                          style={{ height: `${pct}px` }}
                        ></div>
                        
                        <div className="text-[9.5px] font-extrabold text-gray-700 mt-2 truncate w-full text-center">
                          {isRTL ? b.nameAr.split('،')[0] : b.nameEn.split(',')[0]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

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
          {activeTab === 'branches' && (
            <div className="space-y-4 animate-fade-in">
              <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">{t.branch_tab}</h3>

              {/* Grid layout of Branches */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {branches.map(branch => (
                  <div key={branch.id} className="glass-card p-3.5 rounded-2xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-black text-gray-900">{isRTL ? branch.nameAr : branch.nameEn}</h4>
                        <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{isRTL ? branch.addressAr : branch.addressEn}</p>
                      </div>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${branch.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {branch.isActive ? 'OPEN' : 'CLOSED'}
                      </span>
                    </div>

                    {/* Operational parameters toggles */}
                    <div className="pt-2 border-t border-slate-200/50 text-[10px] text-gray-600 space-y-2">
                      <div className="flex justify-between items-center">
                        <span>{t.delivery_fee}:</span>
                        <input 
                          type="number"
                          disabled={isAccountant}
                          value={branch.deliveryFee}
                          onChange={(e) => updateBranchSettings(branch.id, { deliveryFee: parseFloat(e.target.value) || 0 })}
                          className="w-14 text-right bg-white/40 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                        />
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <span>{t.min_order}:</span>
                        <input 
                          type="number"
                          disabled={isAccountant}
                          value={branch.minDeliveryOrder}
                          onChange={(e) => updateBranchSettings(branch.id, { minDeliveryOrder: parseFloat(e.target.value) || 0 })}
                          className="w-14 text-right bg-white/40 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                        />
                      </div>

                      {/* Manual open close switch toggle */}
                      <button 
                        onClick={() => updateBranchSettings(branch.id, { isActive: !branch.isActive })}
                        disabled={isAccountant}
                        className={`w-full py-1.5 rounded text-center text-[9px] font-black uppercase transition-all disabled:opacity-50 ${branch.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                      >
                        {branch.isActive ? 'Close Branch Maintenance' : 'Open Branch Operational'}
                      </button>
                    </div>

                    {/* Custom Product Availability Sub Matrix */}
                    <div className="pt-2 border-t border-slate-200/50 space-y-1.5">
                      <span className="block text-[9px] text-gray-400 font-bold uppercase mb-1">{isRTL ? 'توفر الوجبات الفوري بالفرع:' : 'Branch Product Stock Availability:'}</span>
                      <div className="space-y-1 max-h-[140px] overflow-y-auto">
                        {products.map(p => {
                          const isAvailable = isProductAvailableInBranch(p.id, branch.id);
                          return (
                            <div key={p.id} className="flex justify-between items-center p-1.5 bg-white/30 rounded-lg text-[9.5px]">
                              <span className="font-semibold text-gray-700 truncate max-w-[130px]">{isRTL ? p.nameAr : p.nameEn}</span>
                              <button 
                                onClick={() => toggleProductAvailability(p.id, branch.id)}
                                disabled={isAccountant || !branch.isActive}
                                className={`text-[8px] font-black px-2 py-0.5 rounded uppercase disabled:opacity-50 ${isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                              >
                                {isAvailable ? 'Available' : 'Sold Out'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: FINANCIAL REPORTS & ANALYTICS (PHASE 9) */}
          {activeTab === 'reports' && (() => {
            // 1. Filtered orders for reporting (delivered within date range and branch)
            const filteredOrders = orders.filter(o => {
              if (reportBranchId !== 'all' && o.branchId !== reportBranchId) return false;
              const oDate = o.createdAt.substring(0, 10);
              return oDate >= reportStartDate && oDate <= reportEndDate;
            });

            const deliveredOrders = filteredOrders.filter(o => o.status === 'delivered');

            // 2. Aggregations
            const repGrossSales = deliveredOrders.reduce((sum, o) => sum + o.total, 0);
            const repDiscounts = deliveredOrders.reduce((sum, o) => sum + Math.max(0, (o.subtotal + o.deliveryFee) - o.total), 0);
            const repDeliveryFees = deliveredOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
            const repOrdersCount = deliveredOrders.length;

            // 3. Sales By Day Memo
            const dayReport = (() => {
              const map: { [date: string]: { subtotal: number; deliveryFee: number; discount: number; total: number; vat: number; ordersCount: number } } = {};
              deliveredOrders.forEach(o => {
                const date = o.createdAt.substring(0, 10);
                const disc = Math.max(0, (o.subtotal + o.deliveryFee) - o.total);
                // Extract VAT from the VAT-inclusive grand total actually charged,
                // consistent with the customer and admin receipts (not the
                // pre-discount, delivery-excluded subtotal).
                const { vatAmount } = getVATBreakdown(o.total, brandSettings?.vatPercentage || 15);
                if (!map[date]) map[date] = { subtotal: 0, deliveryFee: 0, discount: 0, total: 0, vat: 0, ordersCount: 0 };
                map[date].subtotal += o.subtotal;
                map[date].deliveryFee += o.deliveryFee;
                map[date].discount += disc;
                map[date].total += o.total;
                map[date].vat += vatAmount;
                map[date].ordersCount += 1;
              });
              return Object.keys(map).sort().map(date => ({ date, ...map[date] }));
            })();

            // 4. Sales By Branch Memo
            const branchReport = branches.map(b => {
              const bOrders = deliveredOrders.filter(o => o.branchId === b.id);
              const count = bOrders.length;
              const revenue = bOrders.reduce((sum, o) => sum + o.total, 0);
              const fees = bOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
              const disc = bOrders.reduce((sum, o) => sum + Math.max(0, (o.subtotal + o.deliveryFee) - o.total), 0);
              const avg = count > 0 ? revenue / count : 0;
              return {
                id: b.id,
                name: isRTL ? b.nameAr : b.nameEn,
                ordersCount: count,
                totalRevenue: revenue,
                deliveryFees: fees,
                avgTicket: avg,
                discounts: disc
              };
            });

            // 5. Sales By Product Memo
            const productReport = (() => {
              const map: { [id: string]: { name: string; category: string; qty: number; rev: number } } = {};
              deliveredOrders.forEach(o => {
                o.items.forEach(item => {
                  const pId = item.productId;
                  const pRef = products.find(p => p.id === pId);
                  const catRef = categories.find(c => c.id === pRef?.categoryId);
                  const name = isRTL ? (pRef?.nameAr || item.nameAr) : (pRef?.nameEn || item.nameEn);
                  const catName = isRTL ? (catRef?.nameAr || 'مقبلات وأطباق') : (catRef?.nameEn || 'Sides & Burgers');
                  if (!map[pId]) map[pId] = { name, category: catName, qty: 0, rev: 0 };
                  map[pId].qty += item.quantity;
                  map[pId].rev += item.price * item.quantity;
                });
              });
              return Object.keys(map).map(id => ({ id, ...map[id] })).sort((a, b) => b.rev - a.rev);
            })();

            // 6. Coupon Usage Memo
            const couponReport = (() => {
              const usageMap: { [code: string]: { code: string; count: number; savings: number } } = {
                'SPICY15': { code: 'SPICY15', count: 0, savings: 0 },
                'RIYADH10': { code: 'RIYADH10', count: 0, savings: 0 },
                'OTHER': { code: 'GENERAL/DISCOUNT', count: 0, savings: 0 }
              };
              deliveredOrders.forEach(o => {
                const disc = Math.max(0, (o.subtotal + o.deliveryFee) - o.total);
                if (disc > 0) {
                  const isS15 = Math.abs(disc - (o.subtotal * 0.15)) < 0.5;
                  const isR10 = Math.abs(disc - 10.00) < 0.1;
                  if (isS15) {
                    usageMap['SPICY15'].count += 1;
                    usageMap['SPICY15'].savings += disc;
                  } else if (isR10) {
                    usageMap['RIYADH10'].count += 1;
                    usageMap['RIYADH10'].savings += disc;
                  } else {
                    usageMap['OTHER'].count += 1;
                    usageMap['OTHER'].savings += disc;
                  }
                }
              });
              return Object.values(usageMap).filter(u => u.count > 0 || u.code !== 'GENERAL/DISCOUNT');
            })();

            // 7. Delivery Fees Memo
            const deliveryReport = branches.map(b => {
              const delOrders = deliveredOrders.filter(o => o.branchId === b.id && o.orderType === 'delivery');
              const count = delOrders.length;
              const fees = delOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
              const avg = count > 0 ? fees / count : 0;
              return {
                id: b.id,
                name: isRTL ? b.nameAr : b.nameEn,
                deliveryCount: count,
                totalFees: fees,
                avgFee: avg
              };
            });

            // 8. Lazywait Sync Memo
            const lazywaitReport = filteredOrders.map(o => {
              let err = '';
              let ref = '';
              if (o.orderSyncStatus === 'synced') {
                ref = 'LW-9' + o.orderNumber.substring(8);
              } else if (o.orderSyncStatus === 'sync_failed') {
                err = isRTL ? 'انتهاء مهلة طلب الاتصال' : 'Connection Timeout';
              } else if (o.orderSyncStatus === 'pending_sync') {
                err = isRTL ? 'في انتظار جدولة المزامنة' : 'In Sync Queue';
              } else {
                err = isRTL ? 'غير مجدول' : 'Not Scheduled';
              }
              return {
                orderId: o.id,
                orderNumber: o.orderNumber,
                date: o.createdAt.substring(0, 10),
                branch: isRTL ? o.branchNameAr : o.branchNameEn,
                total: o.total,
                status: o.orderSyncStatus,
                ref,
                error: err
              };
            });

            // Handle Export CSV
            const triggerCSVExport = () => {
              let csv = '';
              if (selectedReport === 'sales_by_day') {
                csv = "Date,Orders Count,Subtotal (SAR),Delivery Fees (SAR),Discounts (SAR),Net Sales (SAR),VAT Amount (SAR)\n" +
                  dayReport.map(r => `${r.date},${r.ordersCount},${r.subtotal.toFixed(2)},${r.deliveryFee.toFixed(2)},${r.discount.toFixed(2)},${r.total.toFixed(2)},${r.vat.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'sales_by_branch') {
                csv = "Branch,Orders Count,Total Revenue (SAR),Delivery Fees (SAR),Average Ticket (SAR),Discounts (SAR)\n" +
                  branchReport.map(r => `"${r.name}",${r.ordersCount},${r.totalRevenue.toFixed(2)},${r.deliveryFees.toFixed(2)},${r.avgTicket.toFixed(2)},${r.discounts.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'sales_by_product') {
                csv = "Product,Category,Quantity Sold,Total Revenue (SAR)\n" +
                  productReport.map(r => `"${r.name}","${r.category}",${r.qty},${r.rev.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'coupon_usage') {
                csv = "Coupon Code,Usage Count,Total Discounts Saved (SAR)\n" +
                  couponReport.map(r => `${r.code},${r.count},${r.savings.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'delivery_fees') {
                csv = "Branch,Delivery Count,Total Delivery Fees Collected (SAR),Average Delivery Fee (SAR)\n" +
                  deliveryReport.map(r => `"${r.name}",${r.deliveryCount},${r.totalFees.toFixed(2)},${r.avgFee.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'lazywait_report') {
                csv = "Order Number,Date,Branch,Total (SAR),Sync Status,Lazywait Reference,Error Log\n" +
                  lazywaitReport.map(r => `${r.orderNumber},${r.date},"${r.branch}",${r.total.toFixed(2)},${r.status},${r.ref || 'N/A'},"${r.error || ''}"`).join("\n");
              }

              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `spicymeal_${selectedReport}_${reportStartDate}_to_${reportEndDate}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            };

            return (
              <div className="space-y-5 animate-fade-in text-xs" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
                <div className="flex justify-between items-center pb-2.5 border-b border-slate-200/50">
                  <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">{isRTL ? 'نظام التقارير والتحليلات المالية' : 'Financial Reports & Sales Analytics'}</h3>
                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">{isRTL ? 'تقارير فورية ودقيقة متوافقة مع متطلبات الهيئة العامة للزكاة والضريبة والجمارك' : 'Realtime financial audits and cashier reconciliation logs'}</p>
                  </div>
                  <button 
                    onClick={triggerCSVExport}
                    className="glass-btn-secondary py-1.5 px-3 flex items-center gap-1.5 text-[10px]"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-600" />
                    <span>{isRTL ? 'تصدير التقرير كـ Excel/CSV' : 'Export Active Audit CSV'}</span>
                  </button>
                </div>

                {/* FILTERS PANEL */}
                <div className="glass-card p-4 rounded-2xl grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/20">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'فرع المبيعات المستهدف' : 'Branch Scope'}</label>
                    <select
                      value={reportBranchId}
                      onChange={(e) => setReportBranchId(e.target.value)}
                      className="glass-input w-full text-xs p-2 outline-none font-bold text-slate-800"
                    >
                      <option value="all">{isRTL ? 'جميع الفروع والسياسات' : 'All Branches'}</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{isRTL ? b.nameAr : b.nameEn}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'تاريخ البداية (من)' : 'Start Date (From)'}</label>
                    <input 
                      type="date"
                      value={reportStartDate}
                      onChange={(e) => setReportStartDate(e.target.value)}
                      className="glass-input w-full text-xs p-2 outline-none font-bold text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'تاريخ النهاية (إلى)' : 'End Date (To)'}</label>
                    <input 
                      type="date"
                      value={reportEndDate}
                      onChange={(e) => setReportEndDate(e.target.value)}
                      className="glass-input w-full text-xs p-2 outline-none font-bold text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'نوع التقرير المالي' : 'Reporting Metric'}</label>
                    <select
                      value={selectedReport}
                      onChange={(e) => setSelectedReport(e.target.value as any)}
                      className="glass-input w-full text-xs p-2 outline-none font-black text-primary"
                    >
                      <option value="sales_by_day">{isRTL ? 'المبيعات اليومية التفصيلية' : '1. Sales by Day'}</option>
                      <option value="sales_by_branch">{isRTL ? 'المبيعات حسب الفروع' : '2. Sales by Branch'}</option>
                      <option value="sales_by_product">{isRTL ? 'تحليل مبيعات المنتجات' : '3. Sales by Product'}</option>
                      <option value="coupon_usage">{isRTL ? 'تقرير استخدام الكوبونات' : '4. Coupon Usage'}</option>
                      <option value="delivery_fees">{isRTL ? 'رسوم التوصيل والخدمة' : '5. Delivery Service Fees'}</option>
                      <option value="lazywait_report">{isRTL ? 'مزامنة POS الكاشير المتكاملة' : '6. Lazywait POS Audit'}</option>
                    </select>
                  </div>
                </div>

                {/* AUDIT SUMMARY CARDS */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-400 uppercase">{isRTL ? 'إجمالي المبيعات المفلترة' : 'Filtered Sales Revenue'}</span>
                    <p className="text-base font-black text-[#422e87] mt-0.5">{repGrossSales.toFixed(2)} SAR</p>
                    <span className="text-[8px] text-gray-400">{isRTL ? 'شامل ضريبة القيمة المضافة ١٥٪' : 'Includes 15% VAT'}</span>
                  </div>

                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-400 uppercase">{isRTL ? 'عدد الطلبات المكتملة' : 'Completed Order Volume'}</span>
                    <p className="text-base font-black text-[#e02d3d] mt-0.5">{repOrdersCount} {isRTL ? 'طلب ناجح' : 'Orders'}</p>
                    <span className="text-[8px] text-gray-400">{isRTL ? 'خلال النطاق الزمني المحدد' : 'Within date range scope'}</span>
                  </div>

                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-400 uppercase">{isRTL ? 'إجمالي خصومات الكوبونات' : 'Total Coupon Savings'}</span>
                    <p className="text-base font-black text-slate-800 mt-0.5">{repDiscounts.toFixed(2)} SAR</p>
                    <span className="text-[8px] text-purple-600 font-bold">{isRTL ? 'مستقطعة من إيراد المبيعات' : 'Deducted from gross rev'}</span>
                  </div>

                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-400 uppercase">{isRTL ? 'رسوم التوصيل المحصلة' : 'Delivery Fees Collected'}</span>
                    <p className="text-base font-black text-green-700 mt-0.5">{repDeliveryFees.toFixed(2)} SAR</p>
                    <span className="text-[8px] text-gray-400">{isRTL ? 'من طلبات التوصيل الناجحة' : 'From completed deliveries'}</span>
                  </div>
                </div>

                {/* THE SELECTED TABULAR REPORT VIEWPORT */}
                <div className="glass-card rounded-[1.5rem] overflow-hidden bg-white/40">
                  <div className="p-3 border-b border-slate-200/50 bg-white/30 flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase text-slate-700">
                      {selectedReport === 'sales_by_day' && (isRTL ? 'تقرير حركة المبيعات اليومية' : 'Daily Sales Ledger')}
                      {selectedReport === 'sales_by_branch' && (isRTL ? 'توزيع المبيعات وأداء الفروع' : 'Branch Performance Audit')}
                      {selectedReport === 'sales_by_product' && (isRTL ? 'حجم مبيعات الوجبات والمنتجات' : 'Product Sales Distribution Ledger')}
                      {selectedReport === 'coupon_usage' && (isRTL ? 'كشوفات استخدام كوبونات الخصم' : 'Promo Coupon Usage Ledger')}
                      {selectedReport === 'delivery_fees' && (isRTL ? 'تحصيل رسوم التوصيل والمسافات' : 'Delivery Service Fees Audit')}
                      {selectedReport === 'lazywait_report' && (isRTL ? 'مطابقة ومزامنة نقاط البيع (Lazywait POS)' : 'Lazywait POS Synchronization Ledger')}
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 font-mono">
                      {reportStartDate} → {reportEndDate}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    {/* 1. SALES BY DAY */}
                    {selectedReport === 'sales_by_day' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-slate-100/60 text-[9px] uppercase text-slate-500 font-black">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'التاريخ اليومي' : 'Calendar Date'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'عدد الطلبات' : 'Orders Count'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'المبيعات قبل الخصم والرسوم' : 'Sales (Gross)'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'رسوم التوصيل' : 'Delivery Fees'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'خصومات الكوبونات' : 'Coupons Deduct'}</th>
                            <th className="py-2.5 px-4 text-right text-primary">{isRTL ? 'صافي المبيعات (شامل الضريبة)' : 'Net Revenue (SAR)'}</th>
                            <th className="py-2.5 px-4 text-right text-purple-700">{isRTL ? 'قيمة الضريبة ١٥٪' : 'VAT (15% Amount)'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {dayReport.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-8 text-gray-400">{isRTL ? 'لا توجد بيانات حركة مبيعات لهذا النطاق الزمني' : 'No sales ledger records for this scope.'}</td></tr>
                          ) : (
                            dayReport.map((r, i) => (
                              <tr key={i} className="hover:bg-white/50">
                                <td className="py-2.5 px-4 font-mono">{r.date}</td>
                                <td className="py-2.5 px-4 text-center">{r.ordersCount}</td>
                                <td className="py-2.5 px-4 text-right">{r.subtotal.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right">{r.deliveryFee.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right text-[#e02d3d] font-semibold">-{r.discount.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right text-primary font-black">{r.total.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right text-purple-700 font-mono">{r.vat.toFixed(2)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}

                    {/* 2. SALES BY BRANCH */}
                    {selectedReport === 'sales_by_branch' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-slate-100/60 text-[9px] uppercase text-slate-500 font-black">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'الفرع المستهدف' : 'Branch Location'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'حجم الطلبات' : 'Order Volume'}</th>
                            <th className="py-2.5 px-4 text-right text-primary">{isRTL ? 'إجمالي المبيعات' : 'Revenue Gross (SAR)'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'رسوم التوصيل المحصلة' : 'Delivery Service'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'الخصومات الممنوحة' : 'Promo Deduct'}</th>
                            <th className="py-2.5 px-4 text-right text-slate-900">{isRTL ? 'معدل قيمة الفاتورة' : 'Avg. Ticket Value'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {branchReport.map((r, i) => (
                            <tr key={i} className="hover:bg-white/50">
                              <td className="py-3 px-4 text-xs font-black text-slate-800">{r.name}</td>
                              <td className="py-3 px-4 text-center">{r.ordersCount}</td>
                              <td className="py-3 px-4 text-right text-primary font-black">{r.totalRevenue.toFixed(2)}</td>
                              <td className="py-3 px-4 text-right">{r.deliveryFees.toFixed(2)}</td>
                              <td className="py-3 px-4 text-right text-red-500">-{r.discounts.toFixed(2)}</td>
                              <td className="py-3 px-4 text-right font-mono text-xs">{r.avgTicket.toFixed(2)} SAR</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* 3. SALES BY PRODUCT */}
                    {selectedReport === 'sales_by_product' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-slate-100/60 text-[9px] uppercase text-slate-500 font-black">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'اسم الوجبة / المنتج' : 'Menu Item Name'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'التصنيف' : 'Category'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'الكمية المباعة' : 'Units Sold'}</th>
                            <th className="py-2.5 px-4 text-right text-primary">{isRTL ? 'صافي المبيعات المحققة' : 'Net Sales Revenue (SAR)'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {productReport.length === 0 ? (
                            <tr><td colSpan={4} className="text-center py-8 text-gray-400">{isRTL ? 'لم يتم بيع أي منتجات في النطاق الزمني المحدد' : 'No product sales recorded.'}</td></tr>
                          ) : (
                            productReport.map((r, i) => (
                              <tr key={i} className="hover:bg-white/50">
                                <td className="py-2.5 px-4 font-black text-slate-800 text-xs">{r.name}</td>
                                <td className="py-2.5 px-4 font-semibold text-slate-500">{r.category}</td>
                                <td className="py-2.5 px-4 text-center text-slate-900 font-black">{r.qty}</td>
                                <td className="py-2.5 px-4 text-right text-primary font-black">{r.rev.toFixed(2)} SAR</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}

                    {/* 4. COUPON USAGE */}
                    {selectedReport === 'coupon_usage' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-slate-100/60 text-[9px] uppercase text-slate-500 font-black">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'رمز الكوبون الترويجي' : 'Promo Coupon Code'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'مرات الاستخدام الناجحة' : 'Redemption Counts'}</th>
                            <th className="py-2.5 px-4 text-right text-[#e02d3d]">{isRTL ? 'إجمالي الخصومات الممنوحة' : 'Total Revenue Deductions (SAR)'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {couponReport.map((r, i) => (
                            <tr key={i} className="hover:bg-white/50">
                              <td className="py-3 px-4 font-black"><span className="bg-purple-100 text-[#422e87] px-2.5 py-1 rounded-lg font-mono text-xs">{r.code}</span></td>
                              <td className="py-3 px-4 text-center font-bold text-slate-800 text-sm">{r.count}</td>
                              <td className="py-3 px-4 text-right text-[#e02d3d] font-black text-sm">-{r.savings.toFixed(2)} SAR</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* 5. DELIVERY SERVICE FEES */}
                    {selectedReport === 'delivery_fees' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-slate-100/60 text-[9px] uppercase text-slate-500 font-black">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'الفرع المستفيد' : 'Operational Branch'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'عدد طلبات التوصيل' : 'Completed Deliveries'}</th>
                            <th className="py-2.5 px-4 text-right text-green-700">{isRTL ? 'إجمالي رسوم التوصيل المحصلة' : 'Total Delivery Revenue (SAR)'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'معدل رسوم التوصيل للطلب' : 'Average Delivery Fee'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {deliveryReport.map((r, i) => (
                            <tr key={i} className="hover:bg-white/50">
                              <td className="py-3 px-4 font-black text-slate-800 text-xs">{r.name}</td>
                              <td className="py-3 px-4 text-center">{r.deliveryCount}</td>
                              <td className="py-3 px-4 text-right text-green-700 font-black">{r.totalFees.toFixed(2)} SAR</td>
                              <td className="py-3 px-4 text-right font-mono">{r.avgFee.toFixed(2)} SAR</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* 6. LAZYWAIT POS AUDIT */}
                    {selectedReport === 'lazywait_report' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-slate-100/60 text-[9px] uppercase text-slate-500 font-black">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'رقم الطلب المحلي' : 'Local Order #'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'تاريخ الطلب' : 'Order Date'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'الفرع' : 'Branch Scope'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'قيمة الفاتورة' : 'Total (SAR)'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'حالة المزامنة السحابية' : 'POS Cloud Sync'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'مرجع Lazywait ID' : 'Lazywait POS Ref'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'تفاصيل سجل الأخطاء والعمليات' : 'Operation / Audit Logs'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {lazywaitReport.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-8 text-gray-400">{isRTL ? 'لا توجد طلبات في هذا النطاق الزمني لفحص المزامنة' : 'No records scheduled for cashier POS reconciliation.'}</td></tr>
                          ) : (
                            lazywaitReport.map((r, i) => (
                              <tr key={i} className="hover:bg-white/50 text-[10.5px]">
                                <td className="py-3 px-4 font-black text-slate-800">{r.orderNumber}</td>
                                <td className="py-3 px-4 font-semibold text-slate-500 font-mono">{r.date}</td>
                                <td className="py-3 px-4 font-bold text-slate-700">{r.branch}</td>
                                <td className="py-3 px-4 text-right font-black text-slate-900">{r.total.toFixed(2)}</td>
                                <td className="py-3 px-4 text-center">
                                  <span className={`text-[8.5px] font-black px-2 py-0.5 rounded-full ${
                                    r.status === 'synced' ? 'bg-green-100 text-green-700' :
                                    r.status === 'sync_failed' ? 'bg-red-100 text-red-700' :
                                    r.status === 'pending_sync' ? 'bg-amber-100 text-amber-700' :
                                    'bg-slate-100 text-slate-500'
                                  }`}>
                                    {r.status.toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-mono font-bold text-[#422e87]">{r.ref || <span className="text-gray-300">-</span>}</td>
                                <td className="py-3 px-4 text-slate-500 text-[10px] leading-tight truncate max-w-[200px]" title={r.error}>
                                  {r.status === 'synced' ? (
                                    <span className="text-green-600 font-bold">✓ {isRTL ? 'تمت مزامنة الطلب لنقاط البيع بنجاح' : 'تمت المزامنة'}</span>
                                  ) : (
                                    <span className="text-slate-400">⚠ {r.error}</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* HELPERS NOTES */}
                <div className="bg-[#422e87]/5 border border-[#422e87]/10 p-3 rounded-2xl flex items-start gap-2 text-slate-600 text-[10px] leading-relaxed">
                  <Check className="w-4 h-4 text-[#422e87] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-[#422e87] block mb-0.5">{isRTL ? 'إقرار ومطابقة الهيئة العامة للزكاة والضريبة والجمارك (Saudi VAT Audit Compliance)' : 'ZATCA Tax Invoice Audit Note:'}</span>
                    {isRTL ? (
                      'تعتبر هذه التقارير والتحليلات كشوف مبيعات فورية متوافقة بالكامل مع اللائحة التنفيذية لضريبة القيمة المضافة بالمملكة العربية السعودية بنسبة ١٥٪. جميع الأسعار الظاهرة شاملة الضريبة، ويتم استخلاص الوعاء الضريبي تلقائياً بناءً على العمليات الناجحة.'
                    ) : (
                      'All generated digital invoices and daily registers are fully compliant with the ZATCA Saudi Arabia 15% VAT directives. Tax components are extracted in real-time from gross sales at standard math: VAT = Total - (Total / 1.15).'
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 6: INTEGRATIONS & SETTINGS (PHASE 10) */}
          {activeTab === 'settings' && (() => {
            const isAccountant = currentUser.role === 'accountant';

            // Simulate Lazywait Connection Test
            const handleTestConnection = () => {
              setConnectionTesting(true);
              setConnectionResult(null);
              setTimeout(() => {
                setConnectionTesting(false);
                setConnectionResult(isRTL 
                  ? 'تم الاتصال بخوادم Lazywait بنجاح! رمز الاستجابة: 200 (مستقر)' 
                  : 'Successfully connected to Lazywait Cloud API! Status Code: 200 OK (Stable)'
                );
              }, 1200);
            };

            // Simulate Lazywait Menu Sync
            const handleSyncMenu = () => {
              setSyncingMenu(true);
              setSyncResult(null);
              setTimeout(() => {
                setSyncingMenu(false);
                setSyncResult(isRTL 
                  ? `تمت مزامنة ${products.length} وجبة و ${categories.length} أقسام مع كاشير Lazywait بنجاح!` 
                  : `Successfully synchronized ${products.length} menu items and ${categories.length} categories with Lazywait POS!`
                );
              }, 1500);
            };

            return (
              <div className="space-y-5 animate-fade-in text-xs animate-scale-up" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
                <div className="flex justify-between items-center pb-2.5 border-b border-slate-200/50">
                  <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                      {isRTL ? 'لوحة التحكم والربط السحابي' : 'Integrations & System Settings'}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {isRTL ? 'تخصيص الهوية التجارية وبوابات الدفع والربط مع الكاشير والتوصيل' : 'Customize branding, payment gateways, SMS alerts, and Lazywait POS syncing'}
                    </p>
                  </div>
                </div>

                {/* SUB-TAB SELECTOR GRID */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-slate-100">
                  <button
                    onClick={() => setSettingsSubTab('brand')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'brand' 
                        ? 'bg-[#422e87]/10 text-[#422e87] border-[#422e87]/20 shadow-xs' 
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'الهوية والضريبة' : 'Brand & VAT'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('lazywait')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'lazywait' 
                        ? 'bg-[#422e87]/10 text-[#422e87] border-[#422e87]/20 shadow-xs' 
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingMenu ? 'animate-spin' : ''}`} />
                    <span>{isRTL ? 'كاشير Lazywait' : 'Lazywait POS'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('payments')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'payments' 
                        ? 'bg-[#422e87]/10 text-[#422e87] border-[#422e87]/20 shadow-xs' 
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'بوابات الدفع' : 'Payment Gateways'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('sms')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'sms' 
                        ? 'bg-[#422e87]/10 text-[#422e87] border-[#422e87]/20 shadow-xs' 
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'رسائل الجوال SMS' : 'SMS Gateways'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('notifications')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'notifications' 
                        ? 'bg-[#422e87]/10 text-[#422e87] border-[#422e87]/20 shadow-xs' 
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'التنبيهات اللحظية' : 'Push Alerts'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('loyalty')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'loyalty' 
                        ? 'bg-[#422e87]/10 text-[#422e87] border-[#422e87]/20 shadow-xs' 
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <Gift className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'برنامج النقاط والولاء' : 'Loyalty Program'}</span>
                  </button>
                </div>

                {/* SETTINGS SUB-TAB CONTENT PANEL */}
                <div className="glass-card p-5 rounded-[1.5rem] bg-white/40">
                  
                  {/* SUB-TAB 1: BRAND & VAT */}
                  {settingsSubTab === 'brand' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <span className="font-black text-slate-800 text-xs uppercase">{isRTL ? 'تخصيص الهوية وشروط الاستخدام والضريبة' : 'Brand Corporate Design & VAT Rules'}</span>
                        <span className="text-[9px] bg-indigo-100 text-[#422e87] px-2 py-0.5 rounded font-black">{isRTL ? 'الوعاء الضريبي المعتمد' : 'ZATCA Active'}</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'رابط شعار العلامة التجارية' : 'Logo Image URL'}</label>
                          <input 
                            type="text"
                            value={brandSettings.logoUrl}
                            onChange={(e) => updateBrandSettings({ logoUrl: e.target.value })}
                            className="glass-input w-full p-2 font-bold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'اللون الأساسي للعلامة (HEX)' : 'Primary Color Theme'}</label>
                          <div className="flex gap-2">
                            <input 
                              type="color"
                              value={brandSettings.primaryColor}
                              onChange={(e) => updateBrandSettings({ primaryColor: e.target.value })}
                              className="w-8 h-8 rounded border border-gray-200 overflow-hidden cursor-pointer"
                              disabled={isAccountant}
                            />
                            <input 
                              type="text"
                              value={brandSettings.primaryColor}
                              onChange={(e) => updateBrandSettings({ primaryColor: e.target.value })}
                              className="glass-input flex-1 p-2 font-mono font-bold text-slate-700 text-xs"
                              disabled={isAccountant}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'اللون الثانوي للعلامة (HEX)' : 'Secondary Color Theme'}</label>
                          <div className="flex gap-2">
                            <input 
                              type="color"
                              value={brandSettings.secondaryColor}
                              onChange={(e) => updateBrandSettings({ secondaryColor: e.target.value })}
                              className="w-8 h-8 rounded border border-gray-200 overflow-hidden cursor-pointer"
                              disabled={isAccountant}
                            />
                            <input 
                              type="text"
                              value={brandSettings.secondaryColor}
                              onChange={(e) => updateBrandSettings({ secondaryColor: e.target.value })}
                              className="glass-input flex-1 p-2 font-mono font-bold text-slate-700 text-xs"
                              disabled={isAccountant}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-slate-50/60 rounded-xl space-y-3">
                          <span className="font-extrabold text-[#422e87] text-[10px] block border-b border-slate-100 pb-1">{isRTL ? 'إعدادات ضريبة القيمة المضافة بالمملكة' : 'Saudi Arabia VAT Regulatory Config'}</span>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'نسبة الضريبة المضافة (%)' : 'VAT Percentage'}</label>
                              <input 
                                type="number"
                                value={brandSettings.vatPercentage}
                                onChange={(e) => updateBrandSettings({ vatPercentage: parseFloat(e.target.value) || 0 })}
                                className="glass-input w-full p-2 font-bold text-slate-700 text-xs"
                                disabled={isAccountant}
                              />
                            </div>

                            <div>
                              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'الأسعار تشمل الضريبة' : 'Prices Include VAT'}</label>
                              <select
                                value={brandSettings.vatIncluded ? 'true' : 'false'}
                                onChange={(e) => updateBrandSettings({ vatIncluded: e.target.value === 'true' })}
                                className="glass-input w-full p-2 font-bold text-slate-700 text-xs"
                                disabled={isAccountant}
                              >
                                <option value="true">{isRTL ? 'نعم (شاملة ١٥٪)' : 'Yes (Inclusive)'}</option>
                                <option value="false">{isRTL ? 'لا (مضافة عند الفاتورة)' : 'No (Exclusive)'}</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="p-3 bg-slate-50/60 rounded-xl space-y-3">
                          <span className="font-extrabold text-[#422e87] text-[10px] block border-b border-slate-100 pb-1">{isRTL ? 'قنوات الدعم والتواصل' : 'Customer Support Desks'}</span>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'هاتف خدمة العملاء' : 'Support Phone'}</label>
                              <input 
                                type="text"
                                value={brandSettings.supportPhone}
                                onChange={(e) => updateBrandSettings({ supportPhone: e.target.value })}
                                className="glass-input w-full p-2 font-bold text-slate-700 text-xs"
                                disabled={isAccountant}
                              />
                            </div>

                            <div>
                              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'رقم الواتساب التجاري' : 'WhatsApp Hotline'}</label>
                              <input 
                                type="text"
                                value={brandSettings.whatsappNumber}
                                onChange={(e) => updateBrandSettings({ whatsappNumber: e.target.value })}
                                className="glass-input w-full p-2 font-bold text-slate-700 text-xs"
                                disabled={isAccountant}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'سياسة الخصوصية بالإنجليزية' : 'Privacy Policy (EN)'}</label>
                          <textarea 
                            value={brandSettings.privacyPolicyEn}
                            onChange={(e) => updateBrandSettings({ privacyPolicyEn: e.target.value })}
                            rows={3}
                            className="glass-input w-full p-2 font-semibold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'سياسة الخصوصية بالعربية' : 'سياسة الخصوصية (AR)'}</label>
                          <textarea 
                            value={brandSettings.privacyPolicyAr}
                            onChange={(e) => updateBrandSettings({ privacyPolicyAr: e.target.value })}
                            rows={3}
                            className="glass-input w-full p-2 font-semibold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'شروط وأحكام الخدمة بالإنجليزية' : 'Terms & Conditions (EN)'}</label>
                          <textarea 
                            value={brandSettings.termsEn}
                            onChange={(e) => updateBrandSettings({ termsEn: e.target.value })}
                            rows={3}
                            className="glass-input w-full p-2 font-semibold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'شروط وأحكام الخدمة بالعربية' : 'الشروط والأحكام (AR)'}</label>
                          <textarea 
                            value={brandSettings.termsAr}
                            onChange={(e) => updateBrandSettings({ termsAr: e.target.value })}
                            rows={3}
                            className="glass-input w-full p-2 font-semibold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                        <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          {isRTL ? 'تم حفظ الهوية التجارية وتحديثها تلقائياً!' : 'Brand preferences updated automatically!'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 2: LAZYWAIT CLOUD SYNC */}
                  {settingsSubTab === 'lazywait' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <span className="font-black text-slate-800 text-xs uppercase">{isRTL ? 'الربط السحابي مع كاشير Lazywait' : 'Lazywait POS Synchronization Engine'}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-400 font-bold">{isRTL ? 'حالة المكاملة:' : 'Integration Status:'}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${lazywaitSettings.isEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {lazywaitSettings.isEnabled ? (isRTL ? 'نشط' : 'ENABLED') : (isRTL ? 'معطل' : 'DISABLED')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'رابط واجهة برمجة التطبيقات (API URL)' : 'API Base URL'}</label>
                          <input 
                            type="text"
                            value={lazywaitSettings.baseUrl}
                            onChange={(e) => updateLazywaitSettings({ baseUrl: e.target.value })}
                            className="glass-input w-full p-2 font-mono text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'مفتاح المزامنة السري (API Key)' : 'Lazywait Secret Token'}</label>
                          <input 
                            type="password"
                            value={lazywaitSettings.apiKey}
                            onChange={(e) => updateLazywaitSettings({ apiKey: e.target.value })}
                            className="glass-input w-full p-2 font-mono text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'معرف العميل الكاشير (Client ID)' : 'Client Identifier'}</label>
                          <input 
                            type="text"
                            value={lazywaitSettings.clientId}
                            onChange={(e) => updateLazywaitSettings({ clientId: e.target.value })}
                            className="glass-input w-full p-2 font-mono text-xs"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      {/* TRIGGER SYNC TOGGLES */}
                      <div className="p-4 bg-slate-50/60 rounded-xl space-y-4">
                        <span className="font-extrabold text-[#422e87] text-[10px] block border-b border-slate-200/40 pb-1">{isRTL ? 'سياسات وقواعد المزامنة التلقائية' : 'Active Automation & Cloud Sync Protocols'}</span>
                        
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                            <div>
                              <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'الربط السحابي الكلي' : 'Global Integration'}</span>
                              <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'تمكين الربط مع Lazywait' : 'Master integration toggle'}</span>
                            </div>
                            <input 
                              type="checkbox"
                              checked={lazywaitSettings.isEnabled}
                              onChange={(e) => updateLazywaitSettings({ isEnabled: e.target.checked })}
                              className="w-4 h-4 cursor-pointer accent-primary"
                              disabled={isAccountant}
                            />
                          </div>

                          <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                            <div>
                              <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'مزامنة قائمة الوجبات' : 'Menu Syncing'}</span>
                              <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'مزامنة الوجبات تلقائياً' : 'Sync menu & categories'}</span>
                            </div>
                            <input 
                              type="checkbox"
                              checked={lazywaitSettings.isMenuSyncEnabled}
                              onChange={(e) => updateLazywaitSettings({ isMenuSyncEnabled: e.target.checked })}
                              className="w-4 h-4 cursor-pointer accent-primary"
                              disabled={isAccountant || !lazywaitSettings.isEnabled}
                            />
                          </div>

                          <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                            <div>
                              <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'مزامنة المخزون والتوفر' : 'Stock Matrix Sync'}</span>
                              <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'تزامن توفر الوجبات' : 'Sync item availabilities'}</span>
                            </div>
                            <input 
                              type="checkbox"
                              checked={lazywaitSettings.isStockSyncEnabled}
                              onChange={(e) => updateLazywaitSettings({ isStockSyncEnabled: e.target.checked })}
                              className="w-4 h-4 cursor-pointer accent-primary"
                              disabled={isAccountant || !lazywaitSettings.isEnabled}
                            />
                          </div>

                          <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                            <div>
                              <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'مزامنة فواتير الكاشير' : 'Live Invoices Sync'}</span>
                              <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'تصدير المبيعات للكاشير' : 'Push transactions to POS'}</span>
                            </div>
                            <input 
                              type="checkbox"
                              checked={lazywaitSettings.isOrderSyncEnabled}
                              onChange={(e) => updateLazywaitSettings({ isOrderSyncEnabled: e.target.checked })}
                              className="w-4 h-4 cursor-pointer accent-primary"
                              disabled={isAccountant || !lazywaitSettings.isEnabled}
                            />
                          </div>
                        </div>
                      </div>

                      {/* TACTILE TEST CONTROLLERS */}
                      <div className="p-4 bg-purple-50/40 border border-purple-100/60 rounded-xl space-y-3">
                        <span className="font-extrabold text-[#422e87] text-[10px] block">{isRTL ? 'مطابقة ومحاكاة الاتصال الفورية (POS API Simulator)' : 'POS Sandbox Sync Testing & Logging'}</span>
                        
                        <div className="flex flex-wrap gap-2.5">
                          <button
                            onClick={handleTestConnection}
                            disabled={connectionTesting || isAccountant || !lazywaitSettings.isEnabled}
                            className="glass-btn-secondary text-[10px] py-1.5 px-3 flex items-center gap-1.5 font-bold disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${connectionTesting ? 'animate-spin' : ''}`} />
                            <span>{isRTL ? 'اختبار جودة الاتصال المباشر' : 'Test API Endpoint Connection'}</span>
                          </button>

                          <button
                            onClick={handleSyncMenu}
                            disabled={syncingMenu || isAccountant || !lazywaitSettings.isEnabled || !lazywaitSettings.isMenuSyncEnabled}
                            className="glass-btn-primary text-[10px] py-1.5 px-3 flex items-center gap-1.5 font-bold disabled:opacity-50 text-white"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>{isRTL ? 'مزامنة وجبات المنيو الآن' : 'Push & Synchronize Menu Now'}</span>
                          </button>
                        </div>

                        {/* RESULT MESSAGES */}
                        {(connectionResult || connectionTesting) && (
                          <div className="p-2.5 bg-white border border-slate-100 rounded-lg font-mono text-[9.5px] text-slate-600 animate-slide-down">
                            {connectionTesting ? (
                              <span className="flex items-center gap-1.5 text-[#422e87] font-bold">
                                <span className="w-2 h-2 rounded-full bg-[#422e87] animate-ping" />
                                {isRTL ? 'جاري فحص بروتوكولات الاتصال ومطابقة API Key...' : 'Establishing secure handshake with Lazywait Cloud servers...'}
                              </span>
                            ) : (
                              <span className="text-green-600 font-bold block">✓ {connectionResult}</span>
                            )}
                          </div>
                        )}

                        {(syncResult || syncingMenu) && (
                          <div className="p-2.5 bg-white border border-slate-100 rounded-lg font-mono text-[9.5px] text-slate-600 animate-slide-down">
                            {syncingMenu ? (
                              <span className="flex items-center gap-1.5 text-primary font-bold">
                                <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                                {isRTL ? 'جاري تحويل وتكوين مصفوفة الوجبات وتحديث مخزون الفروع...' : 'Compiling active categories, options matrix, and pushing changes to POS...'}
                              </span>
                            ) : (
                              <span className="text-green-600 font-bold block">✓ {syncResult}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 3: PAYMENT GATEWAYS */}
                  {settingsSubTab === 'payments' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <span className="font-black text-slate-800 text-xs uppercase">{isRTL ? 'بوابات الدفع الإلكتروني والمدفوعات' : 'Online Merchant Payment Gateways'}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-400 font-bold">{isRTL ? 'بوابة الدفع:' : 'Gateway State:'}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${paymentSettings.isEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {paymentSettings.isEnabled ? (isRTL ? 'مفعلة' : 'ENABLED') : (isRTL ? 'معطلة' : 'DISABLED')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'مزود الخدمة المستهدف (Provider)' : 'Payment Provider Gateway'}</label>
                          <select
                            value={paymentSettings.providerName}
                            onChange={(e) => updatePaymentSettings({ providerName: e.target.value as any })}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant}
                          >
                            <option value="moyasar">{isRTL ? 'ميسر (Moyasar Saudi Payment)' : 'Moyasar Saudi Gateway'}</option>
                            <option value="paytabs">{isRTL ? 'بي تابس (PayTabs Middle East)' : 'PayTabs Merchant'}</option>
                            <option value="hyperpay">{isRTL ? 'هايبر باي (HyperPay Saudi)' : 'HyperPay Gateway'}</option>
                            <option value="sandbox">{isRTL ? 'وضع المحاكاة الافتراضي (Sandbox Mode)' : 'Developer Sandbox'}</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'المفتاح العام (Publishable Key)' : 'Merchant Publishable API Key'}</label>
                          <input 
                            type="text"
                            value={paymentSettings.publicKey}
                            onChange={(e) => updatePaymentSettings({ publicKey: e.target.value })}
                            className="glass-input w-full p-2 font-mono text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'المفتاح السري (Secret Key)' : 'Merchant Secret API Token'}</label>
                          <input 
                            type="password"
                            value={paymentSettings.secretKey}
                            onChange={(e) => updatePaymentSettings({ secretKey: e.target.value })}
                            className="glass-input w-full p-2 font-mono text-xs"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      <div className="p-3.5 bg-slate-50/60 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                          <div>
                            <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'تمكين بوابة الدفع المحددة' : 'Enable Active Gateway'}</span>
                            <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'تفعيل دفع مدى والبطاقات في التطبيق' : 'Accept Mada, Visa, Mastercard, Apple Pay'}</span>
                          </div>
                          <input 
                            type="checkbox"
                            checked={paymentSettings.isEnabled}
                            onChange={(e) => updatePaymentSettings({ isEnabled: e.target.checked })}
                            className="w-4 h-4 cursor-pointer accent-primary"
                            disabled={isAccountant}
                          />
                        </div>

                        <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                          <div>
                            <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'الوضع الحي للعمليات (Live Mode)' : 'Production / Live Mode'}</span>
                            <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'توجيه العمليات للشبكة الحية' : 'Routing active transactions to payment rails'}</span>
                          </div>
                          <input 
                            type="checkbox"
                            checked={paymentSettings.isLiveMode}
                            onChange={(e) => updatePaymentSettings({ isLiveMode: e.target.checked })}
                            className="w-4 h-4 cursor-pointer accent-primary"
                            disabled={isAccountant || !paymentSettings.isEnabled}
                          />
                        </div>
                      </div>

                      <div className="bg-amber-50/50 border border-amber-100 p-3 rounded-xl flex items-start gap-2 text-amber-900 text-[10px] leading-relaxed">
                        <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-extrabold block mb-0.5">{isRTL ? 'متطلبات بنك السعودية المركزي للامتثال (SAMA Payment Directives):' : 'SAMA PCI-DSS Security compliance:'}</span>
                          {isRTL ? (
                            'تتطلب الهيئة ربط قنوات الدفع ببروتوكولات التشفير الثنائي المتطورة ونشر تقارير المطابقة لتقليل مخاطر الاختراق وتسهيل دفع الفواتير عبر المحافظ المعتمدة مثل Apple Pay و mada.'
                          ) : (
                            'Compliance with PCI-DSS and SAMA regulation demands secure tokenization inside browser inputs. Secrets must remain on backend servers proxying gateways.'
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 4: SMS GATEWAYS */}
                  {settingsSubTab === 'sms' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <span className="font-black text-slate-800 text-xs uppercase">{isRTL ? 'إعدادات مزودي رسائل الجوال (SMS Gateway)' : 'OTP & System Notification SMS Gateways'}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-400 font-bold">{isRTL ? 'بوابة الرسائل:' : 'SMS Service Status:'}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${smsSettings.isEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {smsSettings.isEnabled ? (isRTL ? 'مفعلة' : 'ENABLED') : (isRTL ? 'معطلة' : 'DISABLED')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'مزود خدمة الرسائل (Gateway)' : 'SMS API Provider'}</label>
                          <select
                            value={smsSettings.providerName}
                            onChange={(e) => updateSmsSettings({ providerName: e.target.value as any })}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant}
                          >
                            <option value="unifonic">{isRTL ? 'يوني فونيك (Unifonic Saudi SMS)' : 'Unifonic Saudi Gateway'}</option>
                            <option value="mobily">{isRTL ? 'موبايلي رسائل (Mobily.ws)' : 'Mobily SMS Provider'}</option>
                            <option value="twilio">{isRTL ? 'تويليو (Twilio Global)' : 'Twilio International'}</option>
                            <option value="sandbox">{isRTL ? 'وضع التجربة والمحاكاة (Sandbox)' : 'Mock SMS Sandbox'}</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'مفتاح الرسائل السري (SMS Token/API Key)' : 'SMS Provider API Token'}</label>
                          <input 
                            type="password"
                            value={smsSettings.apiKey}
                            onChange={(e) => updateSmsSettings({ apiKey: e.target.value })}
                            className="glass-input w-full p-2 font-mono text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'اسم المرسل المسجل للهيئة (Sender ID)' : 'Approved Sender ID'}</label>
                          <input 
                            type="text"
                            value={smsSettings.senderId}
                            onChange={(e) => updateSmsSettings({ senderId: e.target.value })}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      <div className="p-3 bg-slate-50/60 rounded-xl flex items-center justify-between">
                        <div>
                          <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'إرسال الرسائل التنبيهية التلقائية' : 'Activate SMS Alerts'}</span>
                          <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'إرسال كود التحقق OTP وتحديثات الطلبات للعملاء' : 'Send verification codes and live order updates to customer mobile phones'}</span>
                        </div>
                        <input 
                          type="checkbox"
                          checked={smsSettings.isEnabled}
                          onChange={(e) => updateSmsSettings({ isEnabled: e.target.checked })}
                          className="w-4 h-4 cursor-pointer accent-primary"
                          disabled={isAccountant}
                        />
                      </div>

                      <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl flex items-start gap-2 text-slate-500 text-[10px] leading-relaxed">
                        <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-extrabold text-slate-700 block mb-0.5">{isRTL ? 'تنظيمات هيئة الاتصالات وتقنية المعلومات (CITC Compliance):' : 'CITC Sender ID Registration Note:'}</span>
                          {isRTL ? (
                            'يجب تسجيل اسم المرسل الموحد (Sender ID) لدى هيئة الاتصالات وتقنية المعلومات السعودية مسبقاً وتفادي الرموز غير المسجلة لتجنب حجب الرسائل التنبيهية للعملاء.'
                          ) : (
                            'All custom Sender IDs require validation and official routing clearance from CITC Saudi Arabia to ensure messages bypass standard local spam blocks.'
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 5: PUSH NOTIFICATIONS */}
                  {settingsSubTab === 'notifications' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <span className="font-black text-slate-800 text-xs uppercase">{isRTL ? 'التنبيهات اللحظية المباشرة (Push Notifications)' : 'Global App Push Notifications'}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-400 font-bold">{isRTL ? 'تنبيهات الأجهزة:' : 'Push Server State:'}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${notificationSettings.isEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {notificationSettings.isEnabled ? (isRTL ? 'نشطة' : 'ACTIVE') : (isRTL ? 'معطلة' : 'INACTIVE')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'مزود التنبيهات المعتمد (Push SDK)' : 'Push Server Engine'}</label>
                          <select
                            value={notificationSettings.providerName}
                            onChange={(e) => updateNotificationSettings({ providerName: e.target.value as any })}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant}
                          >
                            <option value="onesignal">{isRTL ? 'ون سيجنال (OneSignal Push Platform)' : 'OneSignal Cloud'}</option>
                            <option value="expo">{isRTL ? 'إكسبو نوتيفيكيشن (Expo Push API)' : 'Expo Push'}</option>
                            <option value="sandbox">{isRTL ? 'تنبيهات المتصفح الافتراضية (Sandbox)' : 'Local Browser Engine'}</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'معرف التطبيق والاتصال (App ID / API Key)' : 'App ID / API Authorization Key'}</label>
                          <input 
                            type="password"
                            value={notificationSettings.apiKey}
                            onChange={(e) => updateNotificationSettings({ apiKey: e.target.value })}
                            className="glass-input w-full p-2 font-mono text-xs"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      <div className="p-3 bg-slate-50/60 rounded-xl flex items-center justify-between">
                        <div>
                          <span className="font-extrabold text-slate-700 block text-[10px]">{isRTL ? 'تمكين التنبيهات اللحظية للجوّال' : 'Enable Mobile Device Push Notification Service'}</span>
                          <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'إرسال عروض ترويجية وتحديثات لحظية لتجهيز الطلب على هواتف العملاء' : 'Broadcast promos and order preparation status updates to iOS & Android customers'}</span>
                        </div>
                        <input 
                          type="checkbox"
                          checked={notificationSettings.isEnabled}
                          onChange={(e) => updateNotificationSettings({ isEnabled: e.target.checked })}
                          className="w-4 h-4 cursor-pointer accent-primary"
                          disabled={isAccountant}
                        />
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 6: LOYALTY PROGRAM */}
                  {settingsSubTab === 'loyalty' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <span className="font-black text-slate-800 text-xs uppercase">{isRTL ? 'برنامج المكافآت والنقاط الموحد' : 'Brand Customer Loyalty & Rewards System'}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-400 font-bold">{isRTL ? 'برنامج النقاط:' : 'Loyalty State:'}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${loyaltySettings.isEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {loyaltySettings.isEnabled ? (isRTL ? 'مفعل' : 'ENABLED') : (isRTL ? 'معطل' : 'DISABLED')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'النقاط الممنوحة لكل ريال صرف' : 'Points Earned per Real Spent'}</label>
                          <input 
                            type="number"
                            value={loyaltySettings.pointsPerRiyal}
                            onChange={(e) => updateLoyaltySettings({ pointsPerRiyal: parseFloat(e.target.value) || 0 })}
                            className="glass-input w-full p-2 font-bold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'الحد الأدنى لاستبدال النقاط' : 'Min Points to Redeem'}</label>
                          <input 
                            type="number"
                            value={loyaltySettings.minPointsToRedeem}
                            onChange={(e) => updateLoyaltySettings({ minPointsToRedeem: parseInt(e.target.value) || 0 })}
                            className="glass-input w-full p-2 font-bold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'قيمة الخصم لكل نقطة (SAR)' : 'Discount Credit Value per Point (SAR)'}</label>
                          <input 
                            type="number"
                            step="0.01"
                            value={loyaltySettings.discountPerPoint}
                            onChange={(e) => updateLoyaltySettings({ discountPerPoint: parseFloat(e.target.value) || 0 })}
                            className="glass-input w-full p-2 font-mono font-bold text-slate-700 text-xs"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{isRTL ? 'تفعيل نظام المكافآت المالي' : 'Active Rewards Campaign'}</label>
                          <select
                            value={loyaltySettings.isEnabled ? 'true' : 'false'}
                            onChange={(e) => updateLoyaltySettings({ isEnabled: e.target.value === 'true' })}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant}
                          >
                            <option value="true">{isRTL ? 'نعم (مكافآت نشطة)' : 'Yes (Active Campaign)'}</option>
                            <option value="false">{isRTL ? 'لا (إيقاف الحملة)' : 'No (Disable Program)'}</option>
                          </select>
                        </div>
                      </div>

                      {/* LOYALTY SUMMARY STATISTICS */}
                      <div className="p-4 bg-[#422e87]/5 border border-[#422e87]/10 rounded-2xl space-y-3 animate-fade-in">
                        <span className="font-extrabold text-[#422e87] text-[10px] block border-b border-[#422e87]/10 pb-1">{isRTL ? 'مؤشرات أداء العملاء ونقاط الولاء (Loyalty Statistics)' : 'Corporate Customer Loyalty Metrics (Real-time Live Audit)'}</span>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                          <div className="bg-white/80 p-3 rounded-xl border border-slate-100">
                            <span className="text-[8.5px] font-bold text-gray-400 uppercase block">{isRTL ? 'إجمالي الأعضاء المسجلين' : 'Active Loyalty Members'}</span>
                            <p className="text-sm font-black text-slate-800 mt-1">
                              {profiles.filter(p => p.role === 'customer').length} {isRTL ? 'عميل' : 'Users'}
                            </p>
                            <span className="text-[8px] text-green-600 font-bold block mt-0.5">● Live Database</span>
                          </div>

                          <div className="bg-white/80 p-3 rounded-xl border border-slate-100">
                            <span className="text-[8.5px] font-bold text-gray-400 uppercase block">{isRTL ? 'إجمالي النقاط المجمعة' : 'Accumulated Point Balances'}</span>
                            <p className="text-sm font-black text-slate-800 mt-1">
                              {profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0).toLocaleString()} {isRTL ? 'نقطة' : 'Points'}
                            </p>
                            <span className="text-[8px] text-slate-400 block mt-0.5">{isRTL ? 'رصيد مستحق للعملاء' : 'Active liability points'}</span>
                          </div>

                          <div className="bg-white/80 p-3 rounded-xl border border-slate-100">
                            <span className="text-[8.5px] font-bold text-gray-400 uppercase block">{isRTL ? 'إجمالي قيمة خصومات النقاط' : 'Deducted Points Discount Value'}</span>
                            <p className="text-sm font-black text-primary mt-1">
                              {(profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0) * (loyaltySettings.discountPerPoint || 0.1)).toFixed(2)} SAR
                            </p>
                            <span className="text-[8px] text-slate-400 block mt-0.5">{isRTL ? 'مستقطعة من قيمة الفواتير المكتملة' : 'Calculated at active conversions'}</span>
                          </div>

                          <div className="bg-white/80 p-3 rounded-xl border border-slate-100">
                            <span className="text-[8.5px] font-bold text-gray-400 uppercase block">{isRTL ? 'متوسط قيمة الاسترداد لكل عميل' : 'Average Cashback per User'}</span>
                            <p className="text-sm font-black text-green-700 mt-1">
                              {(profiles.filter(p => p.role === 'customer').length 
                                ? (profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0) * (loyaltySettings.discountPerPoint || 0.1) / profiles.filter(p => p.role === 'customer').length) 
                                : 0).toFixed(2)} SAR
                            </p>
                            <span className="text-[8px] text-slate-400 block mt-0.5">{isRTL ? 'قيمة مضافة للمشتريات' : 'Avg customer wallet balance'}</span>
                          </div>
                        </div>

                        {/* CUSTOMER LOYALTY LEDGER & REAL-TIME POINT ADJUSTMENTS */}
                        <div className="space-y-3 pt-3.5 border-t border-[#422e87]/10">
                          <span className="font-extrabold text-slate-800 text-[10px] block uppercase tracking-wider">
                            {isRTL ? 'سجل أرصدة نقاط ولاء العملاء (Customer Loyalty Ledger)' : 'Customer Loyalty Ledger & Point Adjustments'}
                          </span>

                          <div className="grid grid-cols-1 gap-2.5">
                            {profiles.filter(p => p.role === 'customer').map(customer => {
                              const currentPoints = customer.loyaltyPoints || 0;
                              const currentSAR = (currentPoints * (loyaltySettings.discountPerPoint || 0.1)).toFixed(2);
                              const tier = currentPoints >= 300 
                                ? (isRTL ? '👑 ذهبي' : '👑 Gold') 
                                : currentPoints >= 100 
                                ? (isRTL ? '✨ فضي' : '✨ Silver') 
                                : (isRTL ? '🥉 برونزي' : '🥉 Bronze');
                              
                              const adjustmentValue = pointAdjustments[customer.id] || '';

                              const handleAddPoints = () => {
                                const val = parseInt(adjustmentValue) || 0;
                                if (val > 0) {
                                  updateCustomerPoints(customer.id, currentPoints + val);
                                  setPointAdjustments(prev => ({ ...prev, [customer.id]: '' }));
                                }
                              };

                              const handleDeductPoints = () => {
                                const val = parseInt(adjustmentValue) || 0;
                                if (val > 0) {
                                  updateCustomerPoints(customer.id, currentPoints - val);
                                  setPointAdjustments(prev => ({ ...prev, [customer.id]: '' }));
                                }
                              };

                              return (
                                <div key={customer.id} className="bg-white border border-slate-100 p-3.5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs hover:border-[#422e87]/25 transition-all">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center font-black text-xs text-primary border border-purple-100/50">
                                      {customer.fullName.split(' ').map(n => n[0]).join('')}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h4 className="text-xs font-black text-slate-900">{customer.fullName}</h4>
                                        <span className="text-[8px] font-black bg-purple-100 text-primary px-1.5 py-0.5 rounded-md uppercase">{tier}</span>
                                      </div>
                                      <p className="text-[10px] text-gray-400 font-medium">{customer.phoneNumber} • {customer.email}</p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4 bg-[#422e87]/3 px-3 py-2 rounded-xl border border-purple-100/10 self-start md:self-auto min-w-[130px]">
                                    <div>
                                      <span className="text-[8px] font-bold text-gray-400 uppercase block">{isRTL ? 'النقاط المتوفرة' : 'Point Balance'}</span>
                                      <div className="flex items-baseline gap-1">
                                        <span className="text-sm font-black text-primary">{currentPoints}</span>
                                        <span className="text-[8px] text-slate-400 font-bold">{isRTL ? 'نقب' : 'pts'}</span>
                                      </div>
                                      <span className="text-[8px] text-slate-400 font-medium block mt-0.5">
                                        (= {currentSAR} SAR)
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2">
                                      <input 
                                        type="number"
                                        placeholder="Pts"
                                        value={adjustmentValue}
                                        onChange={(e) => setPointAdjustments(prev => ({ ...prev, [customer.id]: e.target.value }))}
                                        className="glass-input p-1.5 text-center font-mono font-bold text-xs text-slate-800 w-16"
                                        disabled={isAccountant}
                                      />
                                      <button 
                                        onClick={handleAddPoints}
                                        disabled={isAccountant || !adjustmentValue}
                                        className="bg-green-600 hover:bg-green-700 text-white text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                                      >
                                        +{isRTL ? 'إضافة' : 'Add'}
                                      </button>
                                      <button 
                                        onClick={handleDeductPoints}
                                        disabled={isAccountant || !adjustmentValue || currentPoints <= 0}
                                        className="bg-red-500 hover:bg-red-600 text-white text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                                      >
                                        -{isRTL ? 'خصم' : 'Deduct'}
                                      </button>
                                    </div>
                                    <div className="flex gap-1 justify-end">
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, currentPoints + 50)}
                                        disabled={isAccountant}
                                        className="text-[8px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-extrabold"
                                      >
                                        +50
                                      </button>
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, Math.max(0, currentPoints - 50))}
                                        disabled={isAccountant || currentPoints < 50}
                                        className="text-[8px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-extrabold disabled:opacity-40"
                                      >
                                        -50
                                      </button>
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, currentPoints + 100)}
                                        disabled={isAccountant}
                                        className="text-[8px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-extrabold"
                                      >
                                        +100
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            );
          })()}
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
