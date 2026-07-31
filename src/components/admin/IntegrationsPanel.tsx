import React, { useState } from 'react';
import { Check, CreditCard, MessageSquare, ShieldCheck, Store } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { IntegrationCard } from './IntegrationCard';
import { LazywaitPanel } from './LazywaitPanel';
import { WhatsAppOtpPanel } from './WhatsAppOtpPanel';
import { EmailServerPanel } from './EmailServerPanel';
import { TapPaymentPanel } from './TapPaymentPanel';
import { PushToolsPanel } from './PushToolsPanel';

/**
 * Admin-only "Integrations" console — split out of Settings because the secure
 * integration slots grew into too many sub-sectors for one scroll. Providers are
 * grouped into sub-tabs (Payments / Messaging & Notifications / POS & Delivery),
 * each pairing the generic secure-config card with its live status/test panel.
 * Secrets are persisted server-side (secret_config) and never read back here.
 *
 * An accountant is BLOCKED here rather than shown a read-only view: the rows
 * carry provider identifiers and endpoint configuration, and there is nothing on
 * this screen a non-admin has a reason to read.
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
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-start justify-between gap-3 border-b border-con-line pb-3">
        <div className="min-w-0">
          <Text variant="title" as="h3">{isRTL ? 'الربط والتكاملات' : 'Integrations'}</Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">
            {isRTL
              ? 'بوابات الدفع والرسائل والإشعارات والربط مع الكاشير والتوصيل — تُحفظ الأسرار في الخادم ولا تصل للمتصفح أبداً'
              : 'Payment, messaging, notifications & POS — secrets are stored server-side, never sent to the browser'}
          </Text>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1">
          <ShieldCheck className="size-3 text-sky" aria-hidden="true" />
          <StatusPill label={isRTL ? 'للمشرف فقط' : 'Admin only'} tone="info" />
        </span>
      </div>

      {isAccountant ? (
        <Notice
          title={isRTL ? 'إعدادات التكامل متاحة للمشرف فقط.' : 'Integration settings are available to admins only.'}
          tone="warning"
        />
      ) : integrationsError ? (
        <Notice title={integrationsError} tone="blocking">
          <Button
            label={isRTL ? 'إعادة المحاولة' : 'Retry'}
            onClick={() => { void loadIntegrations(); }}
            variant="secondary"
          />
        </Notice>
      ) : integrationsLoading ? (
        <Text variant="body" tone="tertiary" as="p" className="py-8 text-center">
          {isRTL ? 'جاري التحميل…' : 'Loading…'}
        </Text>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto border-b border-con-line pb-1">
            {groups.map(g => {
              const Icon = g.icon;
              const active = group === g.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroup(g.key)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'ds-motion inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-ds-md)] border px-3.5',
                    'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
                    active ? 'border-ember bg-ember' : 'border-transparent bg-con-surface-2 hover:bg-con-surface',
                  ].join(' ')}
                >
                  <Icon className={`size-3.5 ${active ? 'text-on-ember' : 'text-con-text-2'}`} aria-hidden="true" />
                  <Text variant="label" tone={active ? 'onEmber' : 'secondary'} as="span">{g.label}</Text>
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
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
                <PushToolsPanel disabled={isAccountant} />
              </>
            )}

            {group === 'pos' && (
              <>
                <IntegrationCard providerType="lazywait" row={rowFor('lazywait')} disabled={isAccountant} onSave={saveIntegration} />
                <LazywaitPanel disabled={isAccountant} />
              </>
            )}
          </div>

          <Card className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden="true" />
            <div>
              <Text variant="label" as="p">{isRTL ? 'تخزين آمن' : 'Secure storage'}</Text>
              <Text variant="caption" tone="secondary" as="p" className="mt-0.5">
                {isRTL
                  ? 'يتم حفظ الأسرار على الخادم فقط ولا تصل للمتصفح. Lazywait ومدفوعات Tap مفعّلة من جهة الخادم (Tap يبقى معطّلاً حتى تُدخل المفاتيح وتفعّله)؛ الرسائل غير مفعّلة بعد.'
                  : 'Secrets are stored server-side and never reach the browser. Lazywait sync and Tap payments are wired server-side (Tap stays disabled until you enter keys and enable it); SMS is not activated yet.'}
              </Text>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
