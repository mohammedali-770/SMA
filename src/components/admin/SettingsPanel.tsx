import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Banknote, Check, CreditCard, Gift, MapPin, ShieldCheck, Sliders, Wallet } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';
import { formatSAR } from '../../utils/calculations';
import { IntegrationCard } from './IntegrationCard';
import { LazywaitPanel } from './LazywaitPanel';
import { WhatsAppOtpPanel } from './WhatsAppOtpPanel';
import { EmailServerPanel } from './EmailServerPanel';
import { PaymentMethod, availableMethods } from '../../lib/payment';
import { mapConfig } from '../../lib/map';

export const SettingsPanel: React.FC = () => {
  const {
    brandSettings, updateBrandSettings, loyaltySettings, updateLoyaltySettings,
    integrationSettings, integrationsLoading, integrationsError, loadIntegrations, saveIntegration,
    profiles, updateCustomerPoints, loyaltyMutationsEnabled, currentUser, adminLang,
    paymentSettings, updatePaymentSettings,
  } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const [settingsSubTab, setSettingsSubTab] = useState<'brand' | 'integrations' | 'payments' | 'maps' | 'loyalty'>('brand');
  const [pointAdjustments, setPointAdjustments] = useState<{ [profileId: string]: string }>({});

  // ---- Payment-method availability (admin-editable, accountant read-only) ----
  // Local draft so interdependent toggles (a default must be an *enabled* method)
  // can be edited together, then persisted atomically via the SECURITY DEFINER RPC.
  const [payForm, setPayForm] = useState({
    onlineEnabled: paymentSettings.onlineEnabled,
    cashEnabled: paymentSettings.cashEnabled,
    defaultMethod: paymentSettings.defaultMethod as PaymentMethod | null,
    outageMode: paymentSettings.outageMode,
  });
  const [paySaving, setPaySaving] = useState(false);
  const [paySaved, setPaySaved] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // Re-sync the draft whenever the server value changes (initial load + post-save
  // re-read, which may coerce the default when its method is disabled).
  useEffect(() => {
    setPayForm({
      onlineEnabled: paymentSettings.onlineEnabled,
      cashEnabled: paymentSettings.cashEnabled,
      defaultMethod: paymentSettings.defaultMethod,
      outageMode: paymentSettings.outageMode,
    });
  }, [paymentSettings]);

            const isAccountant = currentUser.role === 'accountant';
            // Admin loyalty adjustments go through the admin-only
            // adjust_loyalty_points RPC; accountants remain read-only.
            const pointsLocked = isAccountant || !loyaltyMutationsEnabled;

            // Payment draft derived values (kept next to the JSX that reads them).
            const payDraftMethods = availableMethods({
              onlineEnabled: payForm.onlineEnabled, cashEnabled: payForm.cashEnabled,
              defaultMethod: payForm.defaultMethod, outageMode: payForm.outageMode,
            });
            const payBothDisabled = payDraftMethods.length === 0;
            const payOnlineOffCashOn = !payForm.onlineEnabled && payForm.cashEnabled;
            const payDirty =
              payForm.onlineEnabled !== paymentSettings.onlineEnabled ||
              payForm.cashEnabled !== paymentSettings.cashEnabled ||
              payForm.defaultMethod !== paymentSettings.defaultMethod ||
              payForm.outageMode !== paymentSettings.outageMode;
            const handleSavePayments = () => {
              setPaySaving(true); setPayError(null); setPaySaved(false);
              // Never send a default whose method is disabled — coerce to null so the
              // server resolves the first enabled method (place_order does the same).
              const def = payForm.defaultMethod && payDraftMethods.includes(payForm.defaultMethod)
                ? payForm.defaultMethod : null;
              void (async () => {
                try {
                  await updatePaymentSettings({
                    onlineEnabled: payForm.onlineEnabled,
                    cashEnabled: payForm.cashEnabled,
                    defaultMethod: def,
                    outageMode: payForm.outageMode,
                  });
                  setPaySaved(true);
                } catch (e) {
                  setPayError(e instanceof Error ? e.message : String(e));
                } finally {
                  setPaySaving(false);
                }
              })();
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
                    onClick={() => setSettingsSubTab('payments')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'payments'
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs'
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'طرق الدفع' : 'Payment Methods'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('maps')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'maps'
                        ? 'bg-primary/10 text-primary border-primary/20 shadow-xs'
                        : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'الخرائط' : 'Map Settings'}</span>
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
                          {(['payment', 'sms', 'push', 'lazywait', 'whatsapp', 'email'] as const).map(pt => (
                            <IntegrationCard
                              key={pt}
                              providerType={pt}
                              row={integrationSettings.find(r => r.provider_type === pt)}
                              disabled={isAccountant}
                              onSave={saveIntegration}
                            />
                          ))}
                          <WhatsAppOtpPanel disabled={isAccountant} />
                          <EmailServerPanel disabled={isAccountant} />
                          <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl flex items-start gap-2 text-slate-500 text-[10px] leading-relaxed">
                            <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <span className="font-extrabold text-slate-700 block mb-0.5">{isRTL ? 'تخزين آمن' : 'Secure storage'}</span>
                              {isRTL
                                ? 'يتم حفظ الأسرار على الخادم فقط ولا تصل للمتصفح. تكامل Lazywait للطلبات مفعّل من جهة الخادم؛ الدفع والرسائل غير مفعّلة بعد.'
                                : 'Secrets are stored server-side and never reach the browser. Lazywait order sync is wired server-side; payment and SMS are not activated yet.'}
                            </div>
                          </div>
                          <LazywaitPanel disabled={isAccountant} />
                        </>
                      )}
                    </div>
                  )}


                  {/* SUB-TAB: PAYMENT METHODS (admin-configurable availability) */}
                  {settingsSubTab === 'payments' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <div>
                          <span className="font-black text-slate-800 text-xs uppercase block">{isRTL ? 'توفر طرق الدفع' : 'Payment Method Availability'}</span>
                          <span className="text-[9.5px] text-slate-400 font-bold">{isRTL ? 'تحكّم في الدفع الإلكتروني والنقدي — يُطبَّق على السلة والطلبات فوراً' : 'Control online vs cash — applied to checkout and new orders immediately'}</span>
                        </div>
                        <span className="text-[8px] bg-indigo-100 text-primary px-2 py-0.5 rounded font-black flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'للمشرف فقط' : 'Admin only'}
                        </span>
                      </div>

                      {isAccountant ? (
                        <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-amber-900 text-[11px] font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          {isRTL ? 'طرق الدفع للعرض فقط — التعديل متاح للمشرف.' : 'Payment methods are view-only for accountants — editing is admin-only.'}
                        </div>
                      ) : null}

                      {/* Current live availability (from the server, not the draft) */}
                      <div className="p-3 bg-slate-50/70 border border-slate-200/50 rounded-xl flex flex-wrap items-center gap-2 text-[10px] font-bold">
                        <span className="text-slate-500 uppercase tracking-wide">{isRTL ? 'الوضع الحالي:' : 'Live now:'}</span>
                        <span className={`px-2 py-0.5 rounded-full ${paymentSettings.onlineEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                          {isRTL ? 'إلكتروني' : 'Online'} {paymentSettings.onlineEnabled ? (isRTL ? 'مفعّل' : 'ON') : (isRTL ? 'معطّل' : 'OFF')}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full ${paymentSettings.cashEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                          {isRTL ? 'نقدي' : 'Cash'} {paymentSettings.cashEnabled ? (isRTL ? 'مفعّل' : 'ON') : (isRTL ? 'معطّل' : 'OFF')}
                        </span>
                        {paymentSettings.outageMode && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{isRTL ? 'وضع انقطاع الدفع' : 'Outage mode'}</span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* ONLINE toggle */}
                        <div className="p-3.5 bg-white border border-slate-100 rounded-2xl space-y-2">
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-primary" />
                            <span className="font-black text-slate-800 text-[11px]">{isRTL ? 'الدفع الإلكتروني' : 'Online Payment'}</span>
                          </div>
                          <p className="text-[9.5px] text-slate-400 font-semibold leading-relaxed">
                            {isRTL ? 'بوابة الدفع غير مفعّلة بعد؛ الطلبات الإلكترونية لا تُرسل للكاشير حتى يتأكد الدفع.' : 'No gateway yet; online orders are held from POS until payment is verified.'}
                          </p>
                          <select
                            value={payForm.onlineEnabled ? 'true' : 'false'}
                            onChange={(e) => setPayForm(f => ({ ...f, onlineEnabled: e.target.value === 'true' }))}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="true">{isRTL ? 'مفعّل' : 'Enabled'}</option>
                            <option value="false">{isRTL ? 'معطّل' : 'Disabled'}</option>
                          </select>
                        </div>

                        {/* CASH toggle */}
                        <div className="p-3.5 bg-white border border-slate-100 rounded-2xl space-y-2">
                          <div className="flex items-center gap-2">
                            <Banknote className="w-4 h-4 text-green-600" />
                            <span className="font-black text-slate-800 text-[11px]">{isRTL ? 'الدفع النقدي (عند الاستلام)' : 'Cash Payment (on Pickup/Delivery)'}</span>
                          </div>
                          <p className="text-[9.5px] text-slate-400 font-semibold leading-relaxed">
                            {isRTL ? 'الطلبات النقدية تُرسل للكاشير كغير مدفوعة؛ يُحصّل المبلغ من العميل.' : 'Cash orders are sent to POS as unpaid; collect the amount from the customer.'}
                          </p>
                          <select
                            value={payForm.cashEnabled ? 'true' : 'false'}
                            onChange={(e) => setPayForm(f => ({ ...f, cashEnabled: e.target.value === 'true' }))}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="true">{isRTL ? 'مفعّل' : 'Enabled'}</option>
                            <option value="false">{isRTL ? 'معطّل' : 'Disabled'}</option>
                          </select>
                        </div>

                        {/* DEFAULT method */}
                        <div className="p-3.5 bg-white border border-slate-100 rounded-2xl space-y-2">
                          <span className="font-black text-slate-800 text-[11px] block">{isRTL ? 'الطريقة الافتراضية' : 'Default Method'}</span>
                          <p className="text-[9.5px] text-slate-400 font-semibold leading-relaxed">
                            {isRTL ? 'الطريقة المختارة مسبقاً في السلة (يجب أن تكون مفعّلة).' : 'Preselected in checkout (must be an enabled method).'}
                          </p>
                          <select
                            value={payForm.defaultMethod ?? ''}
                            onChange={(e) => setPayForm(f => ({ ...f, defaultMethod: (e.target.value || null) as PaymentMethod | null }))}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="">{isRTL ? 'تلقائي (أول طريقة مفعّلة)' : 'Auto (first enabled)'}</option>
                            <option value="online" disabled={!payForm.onlineEnabled}>{isRTL ? 'إلكتروني' : 'Online'}</option>
                            <option value="cash" disabled={!payForm.cashEnabled}>{isRTL ? 'نقدي' : 'Cash'}</option>
                          </select>
                        </div>

                        {/* OUTAGE mode */}
                        <div className="p-3.5 bg-white border border-slate-100 rounded-2xl space-y-2">
                          <span className="font-black text-slate-800 text-[11px] block">{isRTL ? 'وضع انقطاع الدفع الإلكتروني' : 'Online Outage Mode'}</span>
                          <p className="text-[9.5px] text-slate-400 font-semibold leading-relaxed">
                            {isRTL ? 'علامة توضيحية عند تعطّل البوابة (تُعرض للفريق فقط).' : 'A label flag for when the gateway is down (informational for staff).'}
                          </p>
                          <select
                            value={payForm.outageMode ? 'true' : 'false'}
                            onChange={(e) => setPayForm(f => ({ ...f, outageMode: e.target.value === 'true' }))}
                            className="glass-input w-full p-2 font-bold text-slate-800 text-xs"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="false">{isRTL ? 'إيقاف' : 'Off'}</option>
                            <option value="true">{isRTL ? 'تفعيل' : 'On'}</option>
                          </select>
                        </div>
                      </div>

                      {/* Contextual warnings mirroring what the customer will see */}
                      {payBothDisabled && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-800 text-[11px] font-bold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          {isRTL ? 'لا توجد طريقة دفع مفعّلة — لن يتمكّن العملاء من إتمام الطلب. فعّل النقدي أو الإلكتروني.' : 'No payment method is enabled — customers cannot check out. Enable cash or online.'}
                        </div>
                      )}
                      {payOnlineOffCashOn && !payBothDisabled && (
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-800 text-[11px] font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          {isRTL ? 'الدفع الإلكتروني معطّل والنقدي مفعّل — تستمر العمليات نقداً، وتُرسل الطلبات للكاشير كغير مدفوعة.' : 'Online is off and cash is on — operations continue on cash; orders go to POS as unpaid.'}
                        </div>
                      )}
                      {!payForm.onlineEnabled && !payBothDisabled && (
                        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-[11px] font-bold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          {isRTL ? 'لن يتمكّن العملاء من الدفع إلكترونياً.' : 'Customers will not be able to pay online.'}
                        </div>
                      )}
                      {payForm.cashEnabled && (
                        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-[11px] font-bold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          {isRTL ? 'طلبات الدفع النقدي تُرسل إلى نقطة البيع كغير مدفوعة. على الكاشير/السائق تحصيل المبلغ.' : 'Cash payment orders will be sent to POS as unpaid. Cashier/driver must collect payment.'}
                        </div>
                      )}

                      {payError && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-800 text-[11px] font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" /> {payError}
                        </div>
                      )}

                      <div className="flex justify-end items-center gap-3 border-t border-slate-100 pt-3">
                        {paySaved && !payDirty && (
                          <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> {isRTL ? 'تم الحفظ' : 'Saved'}
                          </span>
                        )}
                        <button
                          onClick={handleSavePayments}
                          disabled={isAccountant || paySaving || !payDirty}
                          className="bg-primary hover:bg-primary/90 text-white text-[11px] font-black py-2 px-4 rounded-xl transition-colors disabled:opacity-40"
                        >
                          {paySaving ? (isRTL ? 'جاري الحفظ…' : 'Saving…') : (isRTL ? 'حفظ طرق الدفع' : 'Save Payment Settings')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB: MAP SETTINGS (provider status; no secret values) */}
                  {settingsSubTab === 'maps' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                        <div>
                          <span className="font-black text-slate-800 text-xs uppercase block">{isRTL ? 'إعدادات الخريطة' : 'Map Settings'}</span>
                          <span className="text-[9.5px] text-slate-400 font-bold">{isRTL ? 'مزوّد الخرائط لرسم مناطق التوصيل واختيار موقع العميل' : 'Provider for delivery-zone drawing + customer location picker'}</span>
                        </div>
                        <span className="text-[8px] bg-indigo-100 text-primary px-2 py-0.5 rounded font-black flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'قيم عامة فقط' : 'Public config only'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 bg-white border border-slate-100 rounded-2xl">
                          <span className="text-[9px] font-black text-slate-400 uppercase block">{isRTL ? 'المزوّد الحالي' : 'Current provider'}</span>
                          <p className="text-sm font-black text-slate-800 mt-1 capitalize">{mapConfig.provider}</p>
                        </div>
                        <div className="p-3 bg-white border border-slate-100 rounded-2xl">
                          <span className="text-[9px] font-black text-slate-400 uppercase block">{isRTL ? 'الرمز العام مُهيّأ' : 'Public token configured'}</span>
                          <p className={`text-sm font-black mt-1 ${mapConfig.isConfigured ? 'text-green-600' : 'text-red-600'}`}>
                            {mapConfig.isConfigured ? (isRTL ? 'نعم' : 'Yes') : (isRTL ? 'لا' : 'No')}
                          </p>
                        </div>
                        <div className="p-3 bg-white border border-slate-100 rounded-2xl md:col-span-2">
                          <span className="text-[9px] font-black text-slate-400 uppercase block">{isRTL ? 'رابط النمط' : 'Style URL'}</span>
                          <p className="text-[11px] font-mono font-bold text-slate-600 mt-1 break-all">{mapConfig.styleUrl}</p>
                        </div>
                      </div>

                      {mapConfig.tokenPresentButInvalid ? (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-[11px] font-bold flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>
                            {isRTL
                              ? 'الرمز المضبوط لا يبدأ بـ pk. — يجب أن يكون رمز Mapbox العام (pk.). لا تستخدم رمزاً سرياً (sk.) في متغيرات VITE_.'
                              : 'The configured token does not start with pk. — it must be a Mapbox public token (pk.). Never use a secret (sk.) token in VITE_ variables.'}
                          </span>
                        </div>
                      ) : !mapConfig.isConfigured && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] font-bold flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>
                            {isRTL
                              ? 'لم يتم ضبط رمز Mapbox العام. أضف VITE_MAPBOX_PUBLIC_TOKEN في بيئة Vercel لتفعيل الخرائط. لن يتعطّل باقي النظام.'
                              : 'Mapbox public token is not set. Add VITE_MAPBOX_PUBLIC_TOKEN to your Vercel env to enable maps. The rest of the dashboard keeps working.'}
                          </span>
                        </div>
                      )}

                      <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl text-slate-500 text-[10px] leading-relaxed">
                        <span className="font-extrabold text-slate-700 block mb-0.5">{isRTL ? 'حماية الرمز' : 'Token restriction'}</span>
                        {isRTL
                          ? 'الرمز العام (pk.) قابل للنشر مثل مفتاح anon، لكن قيّده حسب النطاق/التطبيق من لوحة Mapbox. لا تضع الأسرار في متغيرات VITE_.'
                          : 'The public token (pk.) is shippable like the anon key, but restrict it by URL/app in the Mapbox dashboard. Never place secret keys in VITE_ variables.'}
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
