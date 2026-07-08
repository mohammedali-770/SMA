import React, { useState } from 'react';
import { AlertCircle, Check, CreditCard, Gift, ShieldCheck, Sliders } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';
import { formatSAR } from '../../utils/calculations';
import { IntegrationCard } from './IntegrationCard';

export const SettingsPanel: React.FC = () => {
  const {
    brandSettings, updateBrandSettings, loyaltySettings, updateLoyaltySettings,
    integrationSettings, integrationsLoading, integrationsError, loadIntegrations, saveIntegration,
    profiles, updateCustomerPoints, loyaltyMutationsEnabled, currentUser, adminLang,
  } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const [settingsSubTab, setSettingsSubTab] = useState<'brand' | 'integrations' | 'loyalty'>('brand');
  const [pointAdjustments, setPointAdjustments] = useState<{ [profileId: string]: string }>({});

            const isAccountant = currentUser.role === 'accountant';
            // Admin loyalty adjustments go through the admin-only
            // adjust_loyalty_points RPC; accountants remain read-only.
            const pointsLocked = isAccountant || !loyaltyMutationsEnabled;

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
                    onClick={() => setSettingsSubTab('integrations')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'integrations'
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs'
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'التكامل والربط' : 'Integrations'}</span>
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

                  {/* SUB-TAB: INTEGRATIONS (secure, server-side settings) */}
                  {settingsSubTab === 'integrations' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <div>
                          <span className="font-black text-slate-800 text-xs uppercase block">{isRTL ? 'إعدادات التكامل الآمنة' : 'Secure Integration Settings'}</span>
                          <span className="text-[9.5px] text-slate-400 font-bold">{isRTL ? 'تُحفظ في قاعدة البيانات — المفاتيح السرية لا تُرسل للمتصفح أبداً' : 'Persisted in Supabase — secret keys are never sent to the browser'}</span>
                        </div>
                        <span className="text-[8px] bg-indigo-100 text-primary px-2 py-0.5 rounded font-black flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'للمشرف فقط' : 'Admin only'}
                        </span>
                      </div>

                      {isAccountant ? (
                        <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-amber-900 text-[11px] font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          {isRTL ? 'إعدادات التكامل متاحة للمشرف فقط.' : 'Integration settings are available to admins only.'}
                        </div>
                      ) : integrationsError ? (
                        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-800 text-[11px] font-bold flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />{integrationsError}</span>
                          <button onClick={() => { void loadIntegrations(); }} className="bg-red-600 text-white text-[10px] font-black py-1 px-3 rounded-lg">{isRTL ? 'إعادة المحاولة' : 'Retry'}</button>
                        </div>
                      ) : integrationsLoading ? (
                        <div className="py-8 text-center text-slate-400 text-xs font-bold animate-pulse">{isRTL ? 'جاري التحميل…' : 'Loading…'}</div>
                      ) : (
                        <>
                          {(['payment', 'sms', 'push', 'lazywait'] as const).map(pt => (
                            <IntegrationCard
                              key={pt}
                              providerType={pt}
                              row={integrationSettings.find(r => r.provider_type === pt)}
                              disabled={isAccountant}
                              onSave={saveIntegration}
                            />
                          ))}
                          <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl flex items-start gap-2 text-slate-500 text-[10px] leading-relaxed">
                            <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <span className="font-extrabold text-slate-700 block mb-0.5">{isRTL ? 'تخزين آمن فقط' : 'Secure storage only'}</span>
                              {isRTL
                                ? 'يتم حفظ الإعدادات بأمان. لم يتم تفعيل أي تكامل خارجي فعلي بعد (الدفع، الرسائل، الإشعارات، Lazywait).'
                                : 'Settings are saved securely. No real third-party integration is activated yet (payment, SMS, push, Lazywait).'}
                            </div>
                          </div>
                        </>
                      )}
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
                          {!loyaltyMutationsEnabled && (
                            <p className="text-[9px] text-slate-500 font-bold bg-slate-100/70 border border-slate-200/60 rounded-lg p-2">
                              {isRTL
                                ? 'أرصدة النقاط للعرض فقط في هذه النسخة — لا يوجد إجراء خلفي لتعديل النقاط بعد.'
                                : 'Point balances are read-only in this build — there is no backend routine to adjust loyalty points yet.'}
                            </p>
                          )}

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
                                        disabled={pointsLocked || !adjustmentValue}
                                        className="bg-green-600 hover:bg-green-700 text-white text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                                      >
                                        +{isRTL ? 'إضافة' : 'Add'}
                                      </button>
                                      <button
                                        onClick={handleDeductPoints}
                                        disabled={pointsLocked || !adjustmentValue || currentPoints <= 0}
                                        className="bg-red-500 hover:bg-red-600 text-white text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                                      >
                                        -{isRTL ? 'خصم' : 'Deduct'}
                                      </button>
                                    </div>
                                    <div className="flex gap-1 justify-end">
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, currentPoints + 50)}
                                        disabled={pointsLocked}
                                        className="text-[8px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-extrabold"
                                      >
                                        +50
                                      </button>
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, Math.max(0, currentPoints - 50))}
                                        disabled={pointsLocked || currentPoints < 50}
                                        className="text-[8px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-extrabold disabled:opacity-40"
                                      >
                                        -50
                                      </button>
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, currentPoints + 100)}
                                        disabled={pointsLocked}
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
