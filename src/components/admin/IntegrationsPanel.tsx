import React, { useState } from 'react';
import { AlertCircle, Check, CreditCard, MessageSquare, ShieldCheck, Store } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { IntegrationCard } from './IntegrationCard';
import { LazywaitPanel } from './LazywaitPanel';
import { WhatsAppOtpPanel } from './WhatsAppOtpPanel';
import { EmailServerPanel } from './EmailServerPanel';
import { TapPaymentPanel } from './TapPaymentPanel';

/**
 * Admin-only "Integrations" console — split out of Settings because the secure
 * integration slots grew into too many sub-sectors for one scroll. Providers are
 * grouped into sub-tabs (Payments / Messaging & Notifications / POS & Delivery),
 * each pairing the generic secure-config card with its live status/test panel.
 * Secrets are persisted server-side (secret_config) and never read back here.
 */
type IntegrationGroup = 'payments' | 'messaging' | 'pos';

export const IntegrationsPanel: React.FC = () => {
  const {
    integrationSettings, integrationsLoading, integrationsError, loadIntegrations, saveIntegration,
    currentUser, adminLang,
  } = useApp();
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';
  const [group, setGroup] = useState<IntegrationGroup>('payments');

  const rowFor = (pt: 'payment' | 'sms' | 'push' | 'lazywait' | 'whatsapp' | 'email') =>
    integrationSettings.find(r => r.provider_type === pt);

  const groups: { key: IntegrationGroup; icon: typeof CreditCard; label: string }[] = [
    { key: 'payments', icon: CreditCard, label: isRTL ? 'المدفوعات' : 'Payments' },
    { key: 'messaging', icon: MessageSquare, label: isRTL ? 'الرسائل والإشعارات' : 'Messaging & Notifications' },
    { key: 'pos', icon: Store, label: isRTL ? 'الكاشير والتوصيل' : 'POS & Delivery' },
  ];

  return (
    <div className="space-y-5 animate-fade-in text-xs animate-scale-up" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      {/* Header */}
      <div className="flex justify-between items-center pb-2.5 border-b border-slate-200/50">
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
            {isRTL ? 'الربط والتكاملات' : 'Integrations'}
          </h3>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">
            {isRTL
              ? 'بوابات الدفع والرسائل والإشعارات والربط مع الكاشير والتوصيل — تُحفظ الأسرار في الخادم ولا تصل للمتصفح أبداً'
              : 'Payment, messaging, notifications & POS — secrets are stored server-side, never sent to the browser'}
          </p>
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
          {/* GROUP SELECTOR */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-slate-100">
            {groups.map(g => {
              const Icon = g.icon;
              return (
                <button
                  key={g.key}
                  onClick={() => setGroup(g.key)}
                  className={`py-2 px-3.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                    group === g.key
                      ? 'bg-primary/10 text-primary border-primary/20 shadow-xs'
                      : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/80'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{g.label}</span>
                </button>
              );
            })}
          </div>

          {/* GROUP CONTENT */}
          <div className="glass-card p-5 rounded-[1.5rem] bg-white/40 space-y-4">
            {group === 'payments' && (
              <>
                <IntegrationCard providerType="payment" row={rowFor('payment')} disabled={isAccountant} onSave={saveIntegration} />
                <TapPaymentPanel disabled={isAccountant} />
              </>
            )}

            {group === 'messaging' && (
              <>
                <IntegrationCard providerType="whatsapp" row={rowFor('whatsapp')} disabled={isAccountant} onSave={saveIntegration} />
                <WhatsAppOtpPanel disabled={isAccountant} />
                <IntegrationCard providerType="sms" row={rowFor('sms')} disabled={isAccountant} onSave={saveIntegration} />
                <IntegrationCard providerType="email" row={rowFor('email')} disabled={isAccountant} onSave={saveIntegration} />
                <EmailServerPanel disabled={isAccountant} />
                <IntegrationCard providerType="push" row={rowFor('push')} disabled={isAccountant} onSave={saveIntegration} />
              </>
            )}

            {group === 'pos' && (
              <>
                <IntegrationCard providerType="lazywait" row={rowFor('lazywait')} disabled={isAccountant} onSave={saveIntegration} />
                <LazywaitPanel disabled={isAccountant} />
              </>
            )}
          </div>

          {/* Secure-storage footer note */}
          <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl flex items-start gap-2 text-slate-500 text-[10px] leading-relaxed">
            <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-extrabold text-slate-700 block mb-0.5">{isRTL ? 'تخزين آمن' : 'Secure storage'}</span>
              {isRTL
                ? 'يتم حفظ الأسرار على الخادم فقط ولا تصل للمتصفح. Lazywait ومدفوعات Tap مفعّلة من جهة الخادم (Tap يبقى معطّلاً حتى تُدخل المفاتيح وتفعّله)؛ الرسائل غير مفعّلة بعد.'
                : 'Secrets are stored server-side and never reach the browser. Lazywait sync and Tap payments are wired server-side (Tap stays disabled until you enter keys and enable it); SMS is not activated yet.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
