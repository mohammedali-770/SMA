import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Banknote, Check, CreditCard, Gift, LifeBuoy, MapPin, ShieldCheck, Sliders, Wallet } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';
import { NumericCommitField } from './view/NumericCommitField';
import { Price } from '../Price';
import { PaymentMethod, availableMethods } from '../../lib/payment';
import { mapConfig } from '../../lib/map';
import { admin, catalog } from '../../lib/api';
import { isPlaceholderValue, mailtoLink, telLink, whatsappLink } from '../../lib/supportContact';

export const SettingsPanel: React.FC = () => {
  const {
    brandSettings, updateBrandSettings, loyaltySettings, updateLoyaltySettings,
    profiles, updateCustomerPoints, loyaltyMutationsEnabled, currentUser, adminLang,
    paymentSettings, updatePaymentSettings,
  } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const [settingsSubTab, setSettingsSubTab] = useState<'brand' | 'payments' | 'maps' | 'loyalty' | 'support'>('brand');
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
              <div className="space-y-5 text-xs" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
                <div className="flex justify-between items-center pb-2.5 border-b border-con-line">
                  <div>
                    <h3 className="text-sm font-black text-con-text uppercase tracking-wider">
                      {isRTL ? 'إعدادات النظام' : 'System Settings'}
                    </h3>
                    <p className="text-[10px] text-con-text-3 font-bold mt-0.5">
                      {isRTL ? 'تخصيص الهوية التجارية والضريبة وطرق الدفع والخرائط وبرنامج الولاء' : 'Customize branding, VAT, payment methods, maps, and the loyalty program'}
                    </p>
                  </div>
                </div>

                {/* SUB-TAB SELECTOR GRID */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-con-line">
                  <button
                    onClick={() => setSettingsSubTab('brand')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'brand' 
                        ? 'bg-con-surface-2 text-ember border-con-line' 
                        : 'bg-con-surface text-con-text-2 border-transparent hover:bg-con-surface'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'الهوية والضريبة' : 'Brand & VAT'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('payments')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'payments'
                        ? 'bg-con-surface-2 text-ember border-con-line'
                        : 'bg-con-surface text-con-text-2 border-transparent hover:bg-con-surface'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'طرق الدفع' : 'Payment Methods'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('maps')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'maps'
                        ? 'bg-con-surface-2 text-ember border-con-line'
                        : 'bg-con-surface text-con-text-2 border-transparent hover:bg-con-surface'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'الخرائط' : 'Map Settings'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('loyalty')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'loyalty' 
                        ? 'bg-con-surface-2 text-ember border-con-line' 
                        : 'bg-con-surface text-con-text-2 border-transparent hover:bg-con-surface'
                    }`}
                  >
                    <Gift className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'برنامج النقاط والولاء' : 'Loyalty Program'}</span>
                  </button>

                  <button
                    onClick={() => setSettingsSubTab('support')}
                    className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                      settingsSubTab === 'support'
                        ? 'bg-con-surface-2 text-ember border-con-line'
                        : 'bg-con-surface text-con-text-2 border-transparent hover:bg-con-surface'
                    }`}
                  >
                    <LifeBuoy className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'التواصل والدعم' : 'Support & Contact'}</span>
                  </button>
                </div>

                {/* SETTINGS SUB-TAB CONTENT PANEL */}
                <div className="rounded-[var(--radius-ds-lg)] border border-con-line bg-con-surface p-5">
                  
                  {/* SUB-TAB 1: BRAND & VAT */}
                  {settingsSubTab === 'brand' && (
                    <div className="space-y-4">
                      {/*
                        A "ZATCA Active" status pill used to sit here. Nothing is
                        active: there is no ZATCA/Fatoora integration, no invoice
                        sequence and no seller VAT registration number anywhere in
                        the system. A green-lit status badge for an integration
                        that does not exist is worse than no badge, so it is gone
                        rather than reworded.
                      */}
                      <div className="border-b border-con-line pb-2">
                        <span className="font-black text-con-text text-xs uppercase">{isRTL ? 'تخصيص الهوية وشروط الاستخدام والضريبة' : 'Brand Corporate Design & VAT Rules'}</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'رابط شعار العلامة التجارية' : 'Logo Image URL'}</label>
                          <input 
                            type="text"
                            value={brandSettings.logoUrl}
                            onChange={(e) => updateBrandSettings({ logoUrl: e.target.value })}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'اللون الأساسي للعلامة (HEX)' : 'Primary Color Theme'}</label>
                          <div className="flex gap-2">
                            <input 
                              type="color"
                              value={brandSettings.primaryColor}
                              onChange={(e) => updateBrandSettings({ primaryColor: e.target.value })}
                              className="w-8 h-8 rounded border border-con-line overflow-hidden cursor-pointer"
                              disabled={isAccountant}
                            />
                            <input 
                              type="text"
                              value={brandSettings.primaryColor}
                              onChange={(e) => updateBrandSettings({ primaryColor: e.target.value })}
                              className="ds-motion min-h-11 flex-1 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 font-ds-num"
                              disabled={isAccountant}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'اللون الثانوي للعلامة (HEX)' : 'Secondary Color Theme'}</label>
                          <div className="flex gap-2">
                            <input 
                              type="color"
                              value={brandSettings.secondaryColor}
                              onChange={(e) => updateBrandSettings({ secondaryColor: e.target.value })}
                              className="w-8 h-8 rounded border border-con-line overflow-hidden cursor-pointer"
                              disabled={isAccountant}
                            />
                            <input 
                              type="text"
                              value={brandSettings.secondaryColor}
                              onChange={(e) => updateBrandSettings({ secondaryColor: e.target.value })}
                              className="ds-motion min-h-11 flex-1 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 font-ds-num"
                              disabled={isAccountant}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-con-surface-2 rounded-xl space-y-3">
                          <span className="font-extrabold text-ember text-[10px] block border-b border-con-line pb-1">{isRTL ? 'إعدادات ضريبة القيمة المضافة بالمملكة' : 'Saudi Arabia VAT Regulatory Config'}</span>
                          
                          <div className="grid grid-cols-2 gap-3">
                            {/*
                              VAT is the tax rate applied to every order total.
                              It commits on blur/Enter and refuses a blank or
                              out-of-range entry: the previous
                              `parseFloat(e.target.value) || 0` persisted a real
                              0% the moment the field was cleared to retype it,
                              and receipts recompute tax from the LIVE rate, so
                              that silently re-split the tax on historical
                              receipts too. Capped at 100 — a rate above that is
                              always a typo.
                            */}
                            <div>
                              <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'نسبة الضريبة المضافة (%)' : 'VAT Percentage'}</label>
                              <NumericCommitField
                                label={isRTL ? 'نسبة الضريبة المضافة (%)' : 'VAT Percentage'}
                                value={brandSettings.vatPercentage}
                                onCommit={(v) => { if (v !== null) updateBrandSettings({ vatPercentage: v }); }}
                                disabled={isAccountant}
                                min={0}
                                max={100}
                                suffix="%"
                              />
                            </div>

                            <div>
                              <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'الأسعار تشمل الضريبة' : 'Prices Include VAT'}</label>
                              <select
                                value={brandSettings.vatIncluded ? 'true' : 'false'}
                                onChange={(e) => updateBrandSettings({ vatIncluded: e.target.value === 'true' })}
                                className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                                disabled={isAccountant}
                              >
                                <option value="true">{isRTL ? 'نعم (شاملة ١٥٪)' : 'Yes (Inclusive)'}</option>
                                <option value="false">{isRTL ? 'لا (مضافة عند الفاتورة)' : 'No (Exclusive)'}</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="p-3 bg-con-surface-2 rounded-xl space-y-3">
                          <span className="font-extrabold text-ember text-[10px] block border-b border-con-line pb-1">{isRTL ? 'قنوات الدعم والتواصل' : 'Customer Support Desks'}</span>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'هاتف خدمة العملاء' : 'Support Phone'}</label>
                              <input 
                                type="text"
                                value={brandSettings.supportPhone}
                                onChange={(e) => updateBrandSettings({ supportPhone: e.target.value })}
                                className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                                disabled={isAccountant}
                              />
                            </div>

                            <div>
                              <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'رقم الواتساب التجاري' : 'WhatsApp Hotline'}</label>
                              <input 
                                type="text"
                                value={brandSettings.whatsappNumber}
                                onChange={(e) => updateBrandSettings({ whatsappNumber: e.target.value })}
                                className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                                disabled={isAccountant}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'سياسة الخصوصية بالإنجليزية' : 'Privacy Policy (EN)'}</label>
                          <textarea 
                            value={brandSettings.privacyPolicyEn}
                            onChange={(e) => updateBrandSettings({ privacyPolicyEn: e.target.value })}
                            rows={3}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'سياسة الخصوصية بالعربية' : 'سياسة الخصوصية (AR)'}</label>
                          <textarea 
                            value={brandSettings.privacyPolicyAr}
                            onChange={(e) => updateBrandSettings({ privacyPolicyAr: e.target.value })}
                            rows={3}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'شروط وأحكام الخدمة بالإنجليزية' : 'Terms & Conditions (EN)'}</label>
                          <textarea 
                            value={brandSettings.termsEn}
                            onChange={(e) => updateBrandSettings({ termsEn: e.target.value })}
                            rows={3}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'شروط وأحكام الخدمة بالعربية' : 'الشروط والأحكام (AR)'}</label>
                          <textarea 
                            value={brandSettings.termsAr}
                            onChange={(e) => updateBrandSettings({ termsAr: e.target.value })}
                            rows={3}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 border-t border-con-line pt-3">
                        <span className="text-[10px] text-mint font-bold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          {isRTL ? 'تم حفظ الهوية التجارية وتحديثها تلقائياً!' : 'Brand preferences updated automatically!'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB: PAYMENT METHODS (admin-configurable availability) */}
                  {settingsSubTab === 'payments' && (
                    <div className="space-y-4">
                      <div className="border-b border-con-line pb-2 flex justify-between items-center">
                        <div>
                          <span className="font-black text-con-text text-xs uppercase block">{isRTL ? 'توفر طرق الدفع' : 'Payment Method Availability'}</span>
                          <span className="text-[9.5px] text-con-text-3 font-bold">{isRTL ? 'تحكّم في الدفع الإلكتروني والنقدي — يُطبَّق على السلة والطلبات فوراً' : 'Control online vs cash — applied to checkout and new orders immediately'}</span>
                        </div>
                        <span className="text-[8px] bg-info-tint text-ember px-2 py-0.5 rounded font-black flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'للمشرف فقط' : 'Admin only'}
                        </span>
                      </div>

                      {isAccountant ? (
                        <div className="p-4 bg-warn-tint border border-warn-line rounded-xl text-amber-ink text-[11px] font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-ink flex-shrink-0" />
                          {isRTL ? 'طرق الدفع للعرض فقط — التعديل متاح للمشرف.' : 'Payment methods are view-only for accountants — editing is admin-only.'}
                        </div>
                      ) : null}

                      {/* Current live availability (from the server, not the draft) */}
                      <div className="p-3 bg-con-surface-2 border border-con-line rounded-xl flex flex-wrap items-center gap-2 text-[10px] font-bold">
                        <span className="text-con-text-2 uppercase tracking-wide">{isRTL ? 'الوضع الحالي:' : 'Live now:'}</span>
                        <span className={`px-2 py-0.5 rounded-full ${paymentSettings.onlineEnabled ? 'bg-mint-tint text-mint' : 'bg-con-surface-2 text-con-text-2'}`}>
                          {isRTL ? 'إلكتروني' : 'Online'} {paymentSettings.onlineEnabled ? (isRTL ? 'مفعّل' : 'ON') : (isRTL ? 'معطّل' : 'OFF')}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full ${paymentSettings.cashEnabled ? 'bg-mint-tint text-mint' : 'bg-con-surface-2 text-con-text-2'}`}>
                          {isRTL ? 'نقدي' : 'Cash'} {paymentSettings.cashEnabled ? (isRTL ? 'مفعّل' : 'ON') : (isRTL ? 'معطّل' : 'OFF')}
                        </span>
                        {paymentSettings.outageMode && (
                          <span className="px-2 py-0.5 rounded-full bg-warn-tint text-amber-ink">{isRTL ? 'وضع انقطاع الدفع' : 'Outage mode'}</span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* ONLINE toggle */}
                        <div className="p-3.5 bg-con-surface border border-con-line rounded-2xl space-y-2">
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-ember" />
                            <span className="font-black text-con-text text-[11px]">{isRTL ? 'الدفع الإلكتروني' : 'Online Payment'}</span>
                          </div>
                          <p className="text-[9.5px] text-con-text-3 font-semibold leading-relaxed">
                            {isRTL ? 'بوابة الدفع غير مفعّلة بعد؛ الطلبات الإلكترونية لا تُرسل للكاشير حتى يتأكد الدفع.' : 'No gateway yet; online orders are held from POS until payment is verified.'}
                          </p>
                          <select
                            value={payForm.onlineEnabled ? 'true' : 'false'}
                            onChange={(e) => setPayForm(f => ({ ...f, onlineEnabled: e.target.value === 'true' }))}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="true">{isRTL ? 'مفعّل' : 'Enabled'}</option>
                            <option value="false">{isRTL ? 'معطّل' : 'Disabled'}</option>
                          </select>
                        </div>

                        {/* CASH toggle */}
                        <div className="p-3.5 bg-con-surface border border-con-line rounded-2xl space-y-2">
                          <div className="flex items-center gap-2">
                            <Banknote className="w-4 h-4 text-mint" />
                            <span className="font-black text-con-text text-[11px]">{isRTL ? 'الدفع النقدي (عند الاستلام)' : 'Cash Payment (on Pickup/Delivery)'}</span>
                          </div>
                          <p className="text-[9.5px] text-con-text-3 font-semibold leading-relaxed">
                            {isRTL ? 'الطلبات النقدية تُرسل للكاشير كغير مدفوعة؛ يُحصّل المبلغ من العميل.' : 'Cash orders are sent to POS as unpaid; collect the amount from the customer.'}
                          </p>
                          <select
                            value={payForm.cashEnabled ? 'true' : 'false'}
                            onChange={(e) => setPayForm(f => ({ ...f, cashEnabled: e.target.value === 'true' }))}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="true">{isRTL ? 'مفعّل' : 'Enabled'}</option>
                            <option value="false">{isRTL ? 'معطّل' : 'Disabled'}</option>
                          </select>
                        </div>

                        {/* DEFAULT method */}
                        <div className="p-3.5 bg-con-surface border border-con-line rounded-2xl space-y-2">
                          <span className="font-black text-con-text text-[11px] block">{isRTL ? 'الطريقة الافتراضية' : 'Default Method'}</span>
                          <p className="text-[9.5px] text-con-text-3 font-semibold leading-relaxed">
                            {isRTL ? 'الطريقة المختارة مسبقاً في السلة (يجب أن تكون مفعّلة).' : 'Preselected in checkout (must be an enabled method).'}
                          </p>
                          <select
                            value={payForm.defaultMethod ?? ''}
                            onChange={(e) => setPayForm(f => ({ ...f, defaultMethod: (e.target.value || null) as PaymentMethod | null }))}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="">{isRTL ? 'تلقائي (أول طريقة مفعّلة)' : 'Auto (first enabled)'}</option>
                            <option value="online" disabled={!payForm.onlineEnabled}>{isRTL ? 'إلكتروني' : 'Online'}</option>
                            <option value="cash" disabled={!payForm.cashEnabled}>{isRTL ? 'نقدي' : 'Cash'}</option>
                          </select>
                        </div>

                        {/* OUTAGE mode */}
                        <div className="p-3.5 bg-con-surface border border-con-line rounded-2xl space-y-2">
                          <span className="font-black text-con-text text-[11px] block">{isRTL ? 'وضع انقطاع الدفع الإلكتروني' : 'Online Outage Mode'}</span>
                          <p className="text-[9.5px] text-con-text-3 font-semibold leading-relaxed">
                            {isRTL ? 'علامة توضيحية عند تعطّل البوابة (تُعرض للفريق فقط).' : 'A label flag for when the gateway is down (informational for staff).'}
                          </p>
                          <select
                            value={payForm.outageMode ? 'true' : 'false'}
                            onChange={(e) => setPayForm(f => ({ ...f, outageMode: e.target.value === 'true' }))}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant || paySaving}
                          >
                            <option value="false">{isRTL ? 'إيقاف' : 'Off'}</option>
                            <option value="true">{isRTL ? 'تفعيل' : 'On'}</option>
                          </select>
                        </div>
                      </div>

                      {/* Contextual warnings mirroring what the customer will see */}
                      {payBothDisabled && (
                        <div className="p-3 bg-danger-tint border border-danger-line rounded-xl text-danger-ds text-[11px] font-bold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-danger-ds flex-shrink-0" />
                          {isRTL ? 'لا توجد طريقة دفع مفعّلة — لن يتمكّن العملاء من إتمام الطلب. فعّل النقدي أو الإلكتروني.' : 'No payment method is enabled — customers cannot check out. Enable cash or online.'}
                        </div>
                      )}
                      {payOnlineOffCashOn && !payBothDisabled && (
                        <div className="p-3 bg-info-tint border border-info-line rounded-xl text-sky text-[11px] font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-sky flex-shrink-0" />
                          {isRTL ? 'الدفع الإلكتروني معطّل والنقدي مفعّل — تستمر العمليات نقداً، وتُرسل الطلبات للكاشير كغير مدفوعة.' : 'Online is off and cash is on — operations continue on cash; orders go to POS as unpaid.'}
                        </div>
                      )}
                      {!payForm.onlineEnabled && !payBothDisabled && (
                        <div className="p-3 bg-warn-tint border border-warn-line rounded-xl text-amber-ink text-[11px] font-bold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-ink flex-shrink-0" />
                          {isRTL ? 'لن يتمكّن العملاء من الدفع إلكترونياً.' : 'Customers will not be able to pay online.'}
                        </div>
                      )}
                      {payForm.cashEnabled && (
                        <div className="p-3 bg-warn-tint border border-warn-line rounded-xl text-amber-ink text-[11px] font-bold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-ink flex-shrink-0" />
                          {isRTL ? 'طلبات الدفع النقدي تُرسل إلى نقطة البيع كغير مدفوعة. على الكاشير/السائق تحصيل المبلغ.' : 'Cash payment orders will be sent to POS as unpaid. Cashier/driver must collect payment.'}
                        </div>
                      )}

                      {payError && (
                        <div className="p-3 bg-danger-tint border border-danger-line rounded-xl text-danger-ds text-[11px] font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-danger-ds flex-shrink-0" /> {payError}
                        </div>
                      )}

                      <div className="flex justify-end items-center gap-3 border-t border-con-line pt-3">
                        {paySaved && !payDirty && (
                          <span className="text-[10px] text-mint font-bold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> {isRTL ? 'تم الحفظ' : 'Saved'}
                          </span>
                        )}
                        <button
                          onClick={handleSavePayments}
                          disabled={isAccountant || paySaving || !payDirty}
                          className="bg-ember hover:bg-ember text-on-ember text-[11px] font-black py-2 px-4 rounded-xl transition-colors disabled:opacity-40"
                        >
                          {paySaving ? (isRTL ? 'جاري الحفظ…' : 'Saving…') : (isRTL ? 'حفظ طرق الدفع' : 'Save Payment Settings')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB: MAP SETTINGS (provider status; no secret values) */}
                  {settingsSubTab === 'maps' && (
                    <div className="space-y-4">
                      <div className="border-b border-con-line pb-2 flex justify-between items-center">
                        <div>
                          <span className="font-black text-con-text text-xs uppercase block">{isRTL ? 'إعدادات الخريطة' : 'Map Settings'}</span>
                          <span className="text-[9.5px] text-con-text-3 font-bold">{isRTL ? 'مزوّد الخرائط لرسم مناطق التوصيل واختيار موقع العميل' : 'Provider for delivery-zone drawing + customer location picker'}</span>
                        </div>
                        <span className="text-[8px] bg-info-tint text-ember px-2 py-0.5 rounded font-black flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'قيم عامة فقط' : 'Public config only'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 bg-con-surface border border-con-line rounded-2xl">
                          <span className="text-[9px] font-black text-con-text-3 uppercase block">{isRTL ? 'المزوّد الحالي' : 'Current provider'}</span>
                          <p className="text-sm font-black text-con-text mt-1 capitalize">{mapConfig.provider}</p>
                        </div>
                        <div className="p-3 bg-con-surface border border-con-line rounded-2xl">
                          <span className="text-[9px] font-black text-con-text-3 uppercase block">{isRTL ? 'الرمز العام مُهيّأ' : 'Public token configured'}</span>
                          <p className={`text-sm font-black mt-1 ${mapConfig.isConfigured ? 'text-mint' : 'text-danger-ds'}`}>
                            {mapConfig.isConfigured ? (isRTL ? 'نعم' : 'Yes') : (isRTL ? 'لا' : 'No')}
                          </p>
                        </div>
                        <div className="p-3 bg-con-surface border border-con-line rounded-2xl md:col-span-2">
                          <span className="text-[9px] font-black text-con-text-3 uppercase block">{isRTL ? 'رابط النمط' : 'Style URL'}</span>
                          <p className="text-[11px] font-mono font-bold text-con-text-2 mt-1 break-all">{mapConfig.styleUrl}</p>
                        </div>
                      </div>

                      {mapConfig.tokenPresentButInvalid ? (
                        <div className="p-3 bg-danger-tint border border-danger-line rounded-xl text-danger-ds text-[11px] font-bold flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>
                            {isRTL
                              ? 'الرمز المضبوط لا يبدأ بـ pk. — يجب أن يكون رمز Mapbox العام (pk.). لا تستخدم رمزاً سرياً (sk.) في متغيرات VITE_.'
                              : 'The configured token does not start with pk. — it must be a Mapbox public token (pk.). Never use a secret (sk.) token in VITE_ variables.'}
                          </span>
                        </div>
                      ) : !mapConfig.isConfigured && (
                        <div className="p-3 bg-warn-tint border border-warn-line rounded-xl text-amber-ink text-[11px] font-bold flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>
                            {isRTL
                              ? 'لم يتم ضبط رمز Mapbox العام. أضف VITE_MAPBOX_PUBLIC_TOKEN في بيئة Vercel لتفعيل الخرائط. لن يتعطّل باقي النظام.'
                              : 'Mapbox public token is not set. Add VITE_MAPBOX_PUBLIC_TOKEN to your Vercel env to enable maps. The rest of the dashboard keeps working.'}
                          </span>
                        </div>
                      )}

                      <div className="bg-con-surface-2 border border-con-line p-3 rounded-xl text-con-text-2 text-[10px] leading-relaxed">
                        <span className="font-extrabold text-con-text-2 block mb-0.5">{isRTL ? 'حماية الرمز' : 'Token restriction'}</span>
                        {isRTL
                          ? 'الرمز العام (pk.) قابل للنشر مثل مفتاح anon، لكن قيّده حسب النطاق/التطبيق من لوحة Mapbox. لا تضع الأسرار في متغيرات VITE_.'
                          : 'The public token (pk.) is shippable like the anon key, but restrict it by URL/app in the Mapbox dashboard. Never place secret keys in VITE_ variables.'}
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 6: LOYALTY PROGRAM */}
                  {settingsSubTab === 'loyalty' && (
                    <div className="space-y-4">
                      <div className="border-b border-con-line pb-2 flex justify-between items-center">
                        <span className="font-black text-con-text text-xs uppercase">{isRTL ? 'برنامج المكافآت والنقاط الموحد' : 'Brand Customer Loyalty & Rewards System'}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-con-text-3 font-bold">{isRTL ? 'برنامج النقاط:' : 'Loyalty State:'}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${loyaltySettings.isEnabled ? 'bg-mint-tint text-mint' : 'bg-con-surface-2 text-con-text-2'}`}>
                            {loyaltySettings.isEnabled ? (isRTL ? 'مفعل' : 'ENABLED') : (isRTL ? 'معطل' : 'DISABLED')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'النقاط الممنوحة لكل ريال صرف' : 'Points Earned per Real Spent'}</label>
                          <input 
                            type="number"
                            value={loyaltySettings.pointsPerRiyal}
                            onChange={(e) => updateLoyaltySettings({ pointsPerRiyal: parseFloat(e.target.value) || 0 })}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'الحد الأدنى لاستبدال النقاط' : 'Min Points to Redeem'}</label>
                          <input 
                            type="number"
                            value={loyaltySettings.minPointsToRedeem}
                            onChange={(e) => updateLoyaltySettings({ minPointsToRedeem: parseInt(e.target.value) || 0 })}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'قيمة الخصم لكل نقطة (SAR)' : 'Discount Credit Value per Point (SAR)'}</label>
                          <input 
                            type="number"
                            step="0.01"
                            value={loyaltySettings.discountPerPoint}
                            onChange={(e) => updateLoyaltySettings({ discountPerPoint: parseFloat(e.target.value) || 0 })}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 font-ds-num"
                            disabled={isAccountant}
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-con-text-3 uppercase mb-1">{isRTL ? 'تفعيل نظام المكافآت المالي' : 'Active Rewards Campaign'}</label>
                          <select
                            value={loyaltySettings.isEnabled ? 'true' : 'false'}
                            onChange={(e) => updateLoyaltySettings({ isEnabled: e.target.value === 'true' })}
                            className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            disabled={isAccountant}
                          >
                            <option value="true">{isRTL ? 'نعم (مكافآت نشطة)' : 'Yes (Active Campaign)'}</option>
                            <option value="false">{isRTL ? 'لا (إيقاف الحملة)' : 'No (Disable Program)'}</option>
                          </select>
                        </div>
                      </div>

                      {/* LOYALTY SUMMARY STATISTICS */}
                      <div className="p-4 bg-con-surface-2 border border-con-line rounded-2xl space-y-3">
                        <span className="font-extrabold text-ember text-[10px] block border-b border-con-line pb-1">{isRTL ? 'مؤشرات أداء العملاء ونقاط الولاء (Loyalty Statistics)' : 'Corporate Customer Loyalty Metrics (Real-time Live Audit)'}</span>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                          <div className="bg-con-surface p-3 rounded-xl border border-con-line">
                            <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">{isRTL ? 'إجمالي الأعضاء المسجلين' : 'Active Loyalty Members'}</span>
                            <p className="text-sm font-black text-con-text mt-1">
                              {profiles.filter(p => p.role === 'customer').length} {isRTL ? 'عميل' : 'Users'}
                            </p>
                            <span className="text-[8px] text-mint font-bold block mt-0.5">● Live Database</span>
                          </div>

                          <div className="bg-con-surface p-3 rounded-xl border border-con-line">
                            <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">{isRTL ? 'إجمالي النقاط المجمعة' : 'Accumulated Point Balances'}</span>
                            <p className="text-sm font-black text-con-text mt-1">
                              {profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0).toLocaleString()} {isRTL ? 'نقطة' : 'Points'}
                            </p>
                            <span className="text-[8px] text-con-text-3 block mt-0.5">{isRTL ? 'رصيد مستحق للعملاء' : 'Active liability points'}</span>
                          </div>

                          <div className="bg-con-surface p-3 rounded-xl border border-con-line">
                            <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">{isRTL ? 'إجمالي قيمة خصومات النقاط' : 'Deducted Points Discount Value'}</span>
                            <p className="text-sm font-black text-ember mt-1">
                              <Price amount={profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0) * (loyaltySettings.discountPerPoint || 0.1)} />
                            </p>
                            <span className="text-[8px] text-con-text-3 block mt-0.5">{isRTL ? 'مستقطعة من قيمة الفواتير المكتملة' : 'Calculated at active conversions'}</span>
                          </div>

                          <div className="bg-con-surface p-3 rounded-xl border border-con-line">
                            <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">{isRTL ? 'متوسط قيمة الاسترداد لكل عميل' : 'Average Cashback per User'}</span>
                            <p className="text-sm font-black text-mint mt-1">
                              <Price
                                amount={profiles.filter(p => p.role === 'customer').length
                                  ? (profiles.filter(p => p.role === 'customer').reduce((sum, p) => sum + (p.loyaltyPoints || 0), 0) * (loyaltySettings.discountPerPoint || 0.1) / profiles.filter(p => p.role === 'customer').length)
                                  : 0}
                                lang={adminLang}
                              />
                            </p>
                            <span className="text-[8px] text-con-text-3 block mt-0.5">{isRTL ? 'قيمة مضافة للمشتريات' : 'Avg customer wallet balance'}</span>
                          </div>
                        </div>

                        {/* CUSTOMER LOYALTY LEDGER & REAL-TIME POINT ADJUSTMENTS */}
                        <div className="space-y-3 pt-3.5 border-t border-con-line">
                          <span className="font-extrabold text-con-text text-[10px] block uppercase tracking-wider">
                            {isRTL ? 'سجل أرصدة نقاط ولاء العملاء (Customer Loyalty Ledger)' : 'Customer Loyalty Ledger & Point Adjustments'}
                          </span>
                          {!loyaltyMutationsEnabled && (
                            <p className="text-[9px] text-con-text-2 font-bold bg-con-surface-2 border border-con-line rounded-lg p-2">
                              {isRTL
                                ? 'أرصدة النقاط للعرض فقط في هذه النسخة — لا يوجد إجراء خلفي لتعديل النقاط بعد.'
                                : 'Point balances are read-only in this build — there is no backend routine to adjust loyalty points yet.'}
                            </p>
                          )}

                          <div className="grid grid-cols-1 gap-2.5">
                            {profiles.filter(p => p.role === 'customer').map(customer => {
                              const currentPoints = customer.loyaltyPoints || 0;
                              const currentValue = currentPoints * (loyaltySettings.discountPerPoint || 0.1);
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
                                <div key={customer.id} className="bg-con-surface border border-con-line p-3.5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-con-line transition-all">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-info-tint flex items-center justify-center font-black text-xs text-ember border border-info-line">
                                      {customer.fullName.split(' ').map(n => n[0]).join('')}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h4 className="text-xs font-black text-con-text">{customer.fullName}</h4>
                                        <span className="text-[8px] font-black bg-info-tint text-ember px-1.5 py-0.5 rounded-md uppercase">{tier}</span>
                                      </div>
                                      <p className="text-[10px] text-con-text-3 font-medium">{customer.phoneNumber} • {customer.email}</p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4 bg-con-surface-2 px-3 py-2 rounded-xl border border-info-line self-start md:self-auto min-w-[130px]">
                                    <div>
                                      <span className="text-[8px] font-bold text-con-text-3 uppercase block">{isRTL ? 'النقاط المتوفرة' : 'Point Balance'}</span>
                                      <div className="flex items-baseline gap-1">
                                        <span className="text-sm font-black text-ember">{currentPoints}</span>
                                        <span className="text-[8px] text-con-text-3 font-bold">{isRTL ? 'نقب' : 'pts'}</span>
                                      </div>
                                      <span className="text-[8px] text-con-text-3 font-medium block mt-0.5">
                                        (= <Price amount={currentValue} lang={adminLang} />)
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
                                        className="ds-motion min-h-9 w-16 rounded-[var(--radius-ds-sm)] border border-con-line bg-con-surface px-1.5 text-center font-ds-num text-[13px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
                                        disabled={isAccountant}
                                      />
                                      <button
                                        onClick={handleAddPoints}
                                        disabled={pointsLocked || !adjustmentValue}
                                        className="bg-mint-tint hover:bg-mint-tint text-on-ember text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                                      >
                                        +{isRTL ? 'إضافة' : 'Add'}
                                      </button>
                                      <button
                                        onClick={handleDeductPoints}
                                        disabled={pointsLocked || !adjustmentValue || currentPoints <= 0}
                                        className="bg-danger-tint hover:bg-danger-tint text-on-ember text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                                      >
                                        -{isRTL ? 'خصم' : 'Deduct'}
                                      </button>
                                    </div>
                                    <div className="flex gap-1 justify-end">
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, currentPoints + 50)}
                                        disabled={pointsLocked}
                                        className="text-[8px] bg-con-surface-2 hover:bg-con-surface-2 text-con-text-2 px-1.5 py-0.5 rounded font-extrabold"
                                      >
                                        +50
                                      </button>
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, Math.max(0, currentPoints - 50))}
                                        disabled={pointsLocked || currentPoints < 50}
                                        className="text-[8px] bg-con-surface-2 hover:bg-con-surface-2 text-con-text-2 px-1.5 py-0.5 rounded font-extrabold disabled:opacity-40"
                                      >
                                        -50
                                      </button>
                                      <button 
                                        onClick={() => updateCustomerPoints(customer.id, currentPoints + 100)}
                                        disabled={pointsLocked}
                                        className="text-[8px] bg-con-surface-2 hover:bg-con-surface-2 text-con-text-2 px-1.5 py-0.5 rounded font-extrabold"
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

                  {/* SUB-TAB 5: SUPPORT & CONTACT */}
                  {settingsSubTab === 'support' && (
                    <SupportContactSection isRTL={isRTL} readOnly={isAccountant} />
                  )}

                </div>
              </div>
            );
};

/**
 * Contact & Support settings — admin-configurable channels shown in the mobile
 * app's Legal & Support screen. Self-contained: reads/writes the app_settings
 * singleton directly (RLS: public SELECT, admin-only UPDATE — customers can
 * never write). Values that would be hidden in the app (invalid or template/
 * placeholder text) get an inline warning so the admin sees exactly what the
 * customer will see.
 */
const SupportContactSection: React.FC<{ isRTL: boolean; readOnly: boolean }> = ({ isRTL, readOnly }) => {
  const empty = {
    support_phone: '', support_whatsapp: '', support_email: '',
    support_hours_en: '', support_hours_ar: '', support_desc_en: '', support_desc_ar: '',
    support_phone_enabled: false, support_whatsapp_enabled: false, support_email_enabled: false,
  };
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await catalog.settings();
        if (!active) return;
        setForm({
          support_phone: s.support_phone ?? '', support_whatsapp: s.support_whatsapp ?? '',
          support_email: s.support_email ?? '',
          support_hours_en: s.support_hours_en ?? '', support_hours_ar: s.support_hours_ar ?? '',
          support_desc_en: s.support_desc_en ?? '', support_desc_ar: s.support_desc_ar ?? '',
          support_phone_enabled: s.support_phone_enabled ?? false,
          support_whatsapp_enabled: s.support_whatsapp_enabled ?? false,
          support_email_enabled: s.support_email_enabled ?? false,
        });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const set = (k: keyof typeof empty, v: string | boolean) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  // What the CUSTOMER will actually get (same pure rules as the mobile app).
  const phoneOk = telLink(form.support_phone) !== null;
  const whatsOk = whatsappLink(form.support_whatsapp) !== null;
  const emailOk = mailtoLink(form.support_email) !== null;

  const warn = (enabled: boolean, value: string, ok: boolean): string | null => {
    if (!enabled) return isRTL ? 'القناة غير مفعّلة — لن تظهر للعملاء.' : 'Channel disabled — hidden from customers.';
    if (!value.trim()) return isRTL ? 'لا توجد قيمة — القناة ستبقى مخفية.' : 'No value — the channel stays hidden.';
    if (isPlaceholderValue(value)) return isRTL ? 'قيمة مؤقتة (Placeholder) — لن تُعرض للعملاء أبداً.' : 'Placeholder value — will never be shown to customers.';
    if (!ok) return isRTL ? 'قيمة غير صالحة — القناة ستبقى مخفية.' : 'Invalid value — the channel stays hidden.';
    return null;
  };

  const save = () => {
    setSaving(true); setError(null); setSaved(false);
    void (async () => {
      try {
        await admin.updateSettings({
          support_phone: form.support_phone.trim() || null,
          support_whatsapp: form.support_whatsapp.trim() || null,
          support_email: form.support_email.trim() || null,
          support_hours_en: form.support_hours_en.trim() || null,
          support_hours_ar: form.support_hours_ar.trim() || null,
          support_desc_en: form.support_desc_en.trim() || null,
          support_desc_ar: form.support_desc_ar.trim() || null,
          support_phone_enabled: form.support_phone_enabled,
          support_whatsapp_enabled: form.support_whatsapp_enabled,
          support_email_enabled: form.support_email_enabled,
        });
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    })();
  };

  if (loading) return <p className="text-[10px] font-bold text-con-text-3">{isRTL ? 'جارٍ التحميل…' : 'Loading…'}</p>;

  const channelRows: {
    key: 'phone' | 'whatsapp' | 'email';
    label: string; placeholder: string; value: string; enabled: boolean; ok: boolean;
    valueKey: 'support_phone' | 'support_whatsapp' | 'support_email';
    enabledKey: 'support_phone_enabled' | 'support_whatsapp_enabled' | 'support_email_enabled';
  }[] = [
    { key: 'phone', label: isRTL ? 'هاتف الدعم' : 'Support phone', placeholder: '+9665XXXXXXXX'.replace('XXXXXXXX', '51234567'), value: form.support_phone, enabled: form.support_phone_enabled, ok: phoneOk, valueKey: 'support_phone', enabledKey: 'support_phone_enabled' },
    { key: 'whatsapp', label: isRTL ? 'واتساب الدعم' : 'WhatsApp number', placeholder: '+966512345678', value: form.support_whatsapp, enabled: form.support_whatsapp_enabled, ok: whatsOk, valueKey: 'support_whatsapp', enabledKey: 'support_whatsapp_enabled' },
    { key: 'email', label: isRTL ? 'بريد الدعم' : 'Support email', placeholder: 'support@spicymeal.sa', value: form.support_email, enabled: form.support_email_enabled, ok: emailOk, valueKey: 'support_email', enabledKey: 'support_email_enabled' },
  ];

  return (
    <div className="space-y-4">
      <div className="border-b border-con-line pb-2 flex justify-between items-center">
        <div>
          <span className="font-black text-con-text text-xs uppercase block">{isRTL ? 'التواصل والدعم' : 'Support & Contact'}</span>
          <span className="text-[9.5px] text-con-text-3 font-bold">
            {isRTL ? 'القنوات الظاهرة في تطبيق العملاء (المستندات والدعم). تُخفى أي قناة غير مفعّلة أو غير صالحة.' : 'Channels shown in the customer app (Legal & Support). Disabled or invalid channels are hidden automatically.'}
          </span>
        </div>
        <span className="text-[8px] bg-info-tint text-ember px-2 py-0.5 rounded font-black flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'تعديل للمشرف فقط' : 'Admin-only writes'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {channelRows.map((row) => {
          const w = warn(row.enabled, row.value, row.ok);
          return (
            <div key={row.key} className="p-3 bg-con-surface border border-con-line rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black text-con-text-2 uppercase">{row.label}</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={readOnly}
                    onChange={(e) => set(row.enabledKey, e.target.checked)}
                  />
                  <span className="text-[9px] font-bold text-con-text-2">{isRTL ? 'مفعّلة' : 'Enabled'}</span>
                </label>
              </div>
              <input
                type="text"
                dir="ltr"
                value={row.value}
                disabled={readOnly}
                placeholder={row.placeholder}
                onChange={(e) => set(row.valueKey, e.target.value)}
                className="w-full border border-con-line rounded-lg px-2 py-1.5 text-xs font-bold"
              />
              {w ? <p className="text-[9px] font-bold text-amber-ink flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {w}</p>
                 : <p className="text-[9px] font-bold text-mint flex items-center gap-1"><Check className="w-3 h-3" /> {isRTL ? 'ستظهر للعملاء' : 'Visible to customers'}</p>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 bg-con-surface border border-con-line rounded-2xl space-y-1.5">
          <span className="text-[9px] font-black text-con-text-2 uppercase">{isRTL ? 'ساعات العمل (إنجليزي)' : 'Working hours (English)'}</span>
          <input type="text" value={form.support_hours_en} disabled={readOnly} placeholder="Daily 11:00–23:00"
            onChange={(e) => set('support_hours_en', e.target.value)}
            className="w-full border border-con-line rounded-lg px-2 py-1.5 text-xs font-bold" />
        </div>
        <div className="p-3 bg-con-surface border border-con-line rounded-2xl space-y-1.5">
          <span className="text-[9px] font-black text-con-text-2 uppercase">{isRTL ? 'ساعات العمل (عربي)' : 'Working hours (Arabic)'}</span>
          <input type="text" dir="rtl" value={form.support_hours_ar} disabled={readOnly} placeholder="يومياً ١١:٠٠–٢٣:٠٠"
            onChange={(e) => set('support_hours_ar', e.target.value)}
            className="w-full border border-con-line rounded-lg px-2 py-1.5 text-xs font-bold" />
        </div>
        <div className="p-3 bg-con-surface border border-con-line rounded-2xl space-y-1.5">
          <span className="text-[9px] font-black text-con-text-2 uppercase">{isRTL ? 'وصف الدعم (إنجليزي، اختياري)' : 'Support description (English, optional)'}</span>
          <input type="text" value={form.support_desc_en} disabled={readOnly} placeholder="We reply within minutes."
            onChange={(e) => set('support_desc_en', e.target.value)}
            className="w-full border border-con-line rounded-lg px-2 py-1.5 text-xs font-bold" />
        </div>
        <div className="p-3 bg-con-surface border border-con-line rounded-2xl space-y-1.5">
          <span className="text-[9px] font-black text-con-text-2 uppercase">{isRTL ? 'وصف الدعم (عربي، اختياري)' : 'Support description (Arabic, optional)'}</span>
          <input type="text" dir="rtl" value={form.support_desc_ar} disabled={readOnly} placeholder="نرد خلال دقائق."
            onChange={(e) => set('support_desc_ar', e.target.value)}
            className="w-full border border-con-line rounded-lg px-2 py-1.5 text-xs font-bold" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={readOnly || saving}
          className="bg-ember text-on-ember text-xs font-black px-4 py-2 rounded-xl disabled:opacity-50"
        >
          {saving ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…') : (isRTL ? 'حفظ' : 'Save')}
        </button>
        {saved ? <span className="text-[10px] font-black text-mint flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {isRTL ? 'تم الحفظ' : 'Saved'}</span> : null}
        {error ? <span className="text-[10px] font-black text-danger-ds flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {error}</span> : null}
        {readOnly ? <span className="text-[9px] font-bold text-con-text-3">{isRTL ? 'عرض فقط (محاسب)' : 'View-only (accountant)'}</span> : null}
      </div>
    </div>
  );
};
