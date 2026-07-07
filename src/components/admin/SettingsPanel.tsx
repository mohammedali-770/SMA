import React, { useState } from 'react';
import { AlertCircle, Bell, Check, CreditCard, Gift, Layers, MessageSquare, RefreshCw, Sliders } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';
import { formatSAR, formatRiyadhDateTime } from '../../utils/calculations';

export const SettingsPanel: React.FC = () => {
  const {
    brandSettings, updateBrandSettings, lazywaitSettings, updateLazywaitSettings,
    paymentSettings, updatePaymentSettings, smsSettings, updateSmsSettings,
    notificationSettings, updateNotificationSettings, loyaltySettings, updateLoyaltySettings,
    integrationEvents, clearIntegrationEvents,
    profiles, updateCustomerPoints, currentUser, adminLang, products, categories,
  } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const [settingsSubTab, setSettingsSubTab] = useState<'brand' | 'lazywait' | 'payments' | 'sms' | 'notifications' | 'loyalty'>('brand');
  const [pointAdjustments, setPointAdjustments] = useState<{ [profileId: string]: string }>({});
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState<string | null>(null);
  const [syncingMenu, setSyncingMenu] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

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
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs' 
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
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs' 
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
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs' 
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
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs' 
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
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs' 
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
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs' 
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
                        <span className="text-[9px] bg-indigo-100 text-primary px-2 py-0.5 rounded font-black">{isRTL ? 'الوعاء الضريبي المعتمد' : 'ZATCA Active'}</span>
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
                          <span className="font-extrabold text-primary text-[10px] block border-b border-slate-100 pb-1">{isRTL ? 'إعدادات ضريبة القيمة المضافة بالمملكة' : 'Saudi Arabia VAT Regulatory Config'}</span>
                          
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
                          <span className="font-extrabold text-primary text-[10px] block border-b border-slate-100 pb-1">{isRTL ? 'قنوات الدعم والتواصل' : 'Customer Support Desks'}</span>
                          
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
                        <span className="font-extrabold text-primary text-[10px] block border-b border-slate-200/40 pb-1">{isRTL ? 'سياسات وقواعد المزامنة التلقائية' : 'Active Automation & Cloud Sync Protocols'}</span>
                        
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
                        <span className="font-extrabold text-primary text-[10px] block">{isRTL ? 'مطابقة ومحاكاة الاتصال الفورية (POS API Simulator)' : 'POS Sandbox Sync Testing & Logging'}</span>
                        
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
                              <span className="flex items-center gap-1.5 text-primary font-bold">
                                <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
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
                          <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'قناة احتياطية — تُستخدم فقط عند إيقاف إشعارات التطبيق (الرسائل النصية مدفوعة)' : 'Fallback channel — used only when app push is disabled (SMS is billable)'}</span>
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
                          <span className="text-[8px] text-slate-400 font-bold block mt-0.5">{isRTL ? 'القناة الأساسية — إشعارات مجانية داخل التطبيق لتحديثات الطلب (مفضّلة على الرسائل النصية)' : 'Primary channel — free in-app push for order updates, preferred over SMS'}</span>
                        </div>
                        <input 
                          type="checkbox"
                          checked={notificationSettings.isEnabled}
                          onChange={(e) => updateNotificationSettings({ isEnabled: e.target.checked })}
                          className="w-4 h-4 cursor-pointer accent-primary"
                          disabled={isAccountant}
                        />
                      </div>

                      {/* SIMULATED GATEWAY ACTIVITY LOG (SMS + PUSH) */}
                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-slate-700 text-[10px] flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                            {isRTL ? 'سجل نشاط بوابات الرسائل (محاكاة)' : 'Integration Activity Log — SMS & Push (simulated)'}
                          </span>
                          {integrationEvents.length > 0 && !isAccountant && (
                            <button
                              onClick={clearIntegrationEvents}
                              className="text-[9px] font-black text-slate-400 hover:text-secondary transition-colors"
                            >
                              {isRTL ? 'مسح السجل' : 'Clear log'}
                            </button>
                          )}
                        </div>
                        <p className="text-[8px] text-slate-400 font-bold leading-snug">
                          {isRTL
                            ? 'يتم تسجيل رسالة محاكاة عند تأكيد الطلب وعند كل تغيير في حالته — تُرسل عبر إشعارات التطبيق إن كانت مفعّلة، وإلا عبر الرسائل النصية كقناة احتياطية.'
                            : 'A simulated message is recorded on order confirmation and each status change — delivered via in-app push when enabled, otherwise SMS as a fallback.'}
                        </p>

                        {integrationEvents.length === 0 ? (
                          <div className="text-center py-5 text-[10px] text-slate-400 font-bold bg-slate-50/60 rounded-xl">
                            {isRTL ? 'لا يوجد نشاط بعد — أنشئ طلباً أو غيّر حالة طلب.' : 'No activity yet — place an order or change an order status.'}
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                            {integrationEvents.map(ev => (
                              <div key={ev.id} className="flex items-start gap-2 bg-white border border-slate-100 rounded-xl p-2.5 shadow-xs">
                                <span className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${ev.channel === 'sms' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-primary'}`}>
                                  {ev.channel === 'sms' ? <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> : <Bell className="w-3.5 h-3.5" aria-hidden="true" />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                                      {ev.channel === 'sms' ? 'SMS' : (isRTL ? 'إشعار' : 'PUSH')} · {ev.provider}
                                    </span>
                                    <span className="text-[8px] font-mono text-slate-400 truncate">→ {ev.recipient}</span>
                                  </div>
                                  <p className="text-[10px] text-slate-700 font-semibold mt-0.5 leading-snug break-words">{ev.message}</p>
                                  <span className="text-[8px] text-slate-300 font-mono block mt-0.5">{formatRiyadhDateTime(ev.createdAt)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
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
                      <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl space-y-3 animate-fade-in">
                        <span className="font-extrabold text-primary text-[10px] block border-b border-primary/10 pb-1">{isRTL ? 'مؤشرات أداء العملاء ونقاط الولاء (Loyalty Statistics)' : 'Corporate Customer Loyalty Metrics (Real-time Live Audit)'}</span>
                        
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
                              {formatSAR(profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0) * (loyaltySettings.discountPerPoint || 0.1), adminLang)}
                            </p>
                            <span className="text-[8px] text-slate-400 block mt-0.5">{isRTL ? 'مستقطعة من قيمة الفواتير المكتملة' : 'Calculated at active conversions'}</span>
                          </div>

                          <div className="bg-white/80 p-3 rounded-xl border border-slate-100">
                            <span className="text-[8.5px] font-bold text-gray-400 uppercase block">{isRTL ? 'متوسط قيمة الاسترداد لكل عميل' : 'Average Cashback per User'}</span>
                            <p className="text-sm font-black text-green-700 mt-1">
                              {formatSAR(profiles.filter(p => p.role === 'customer').length
                                ? (profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0) * (loyaltySettings.discountPerPoint || 0.1) / profiles.filter(p => p.role === 'customer').length) 
                                : 0, adminLang)}
                            </p>
                            <span className="text-[8px] text-slate-400 block mt-0.5">{isRTL ? 'قيمة مضافة للمشتريات' : 'Avg customer wallet balance'}</span>
                          </div>
                        </div>

                        {/* CUSTOMER LOYALTY LEDGER & REAL-TIME POINT ADJUSTMENTS */}
                        <div className="space-y-3 pt-3.5 border-t border-primary/10">
                          <span className="font-extrabold text-slate-800 text-[10px] block uppercase tracking-wider">
                            {isRTL ? 'سجل أرصدة نقاط ولاء العملاء (Customer Loyalty Ledger)' : 'Customer Loyalty Ledger & Point Adjustments'}
                          </span>

                          <div className="grid grid-cols-1 gap-2.5">
                            {profiles.filter(p => p.role === 'customer').map(customer => {
                              const currentPoints = customer.loyaltyPoints || 0;
                              const currentSAR = formatSAR(currentPoints * (loyaltySettings.discountPerPoint || 0.1), adminLang);
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
                                <div key={customer.id} className="bg-white border border-slate-100 p-3.5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs hover:border-primary/25 transition-all">
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

                                  <div className="flex items-center gap-4 bg-primary/3 px-3 py-2 rounded-xl border border-purple-100/10 self-start md:self-auto min-w-[130px]">
                                    <div>
                                      <span className="text-[8px] font-bold text-gray-400 uppercase block">{isRTL ? 'النقاط المتوفرة' : 'Point Balance'}</span>
                                      <div className="flex items-baseline gap-1">
                                        <span className="text-sm font-black text-primary">{currentPoints}</span>
                                        <span className="text-[8px] text-slate-400 font-bold">{isRTL ? 'نقب' : 'pts'}</span>
                                      </div>
                                      <span className="text-[8px] text-slate-400 font-medium block mt-0.5">
                                        (= {currentSAR})
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
};
