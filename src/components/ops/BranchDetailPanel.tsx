/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import { AdminModal } from '../admin/view/shared/AdminModal';
import { Button } from '../../design-system/ui/Button';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import type { DeliveryArea, WorkingHoursDay } from '../../lib/branchConfigApi';
import { WEEKDAYS, formatWindow } from '../admin/view/branches/workingHours';
import type { BranchClosureSummary } from './callCentre';
import { returnLabel } from './callCentre';
import type { OpsLangValue } from './useOpsLang';

/**
 * Everything a call-centre operator needs about one branch while a customer is
 * on the phone: how to reach it, when it trades, what it cannot sell, and the
 * two controls they are authorized to use.
 *
 * Built on AdminModal rather than a bespoke slide-over so it inherits the focus
 * trap, Escape handling and background `inert` that ModalShell already gets
 * right — an operator tabbing into the page behind a panel is a real bug and
 * not one worth re-solving here.
 */
export const BranchDetailPanel: React.FC<{
  summary: BranchClosureSummary;
  hours: WorkingHoursDay[];
  areas: DeliveryArea[];
  now: number;
  busy: boolean;
  error: string | null;
  i18n: OpsLangValue;
  onClose: () => void;
  onResumeDelivery: () => void;
  onPauseDelivery: () => void;
  onToggleArea: (area: DeliveryArea) => void;
}> = ({
  summary, hours, areas, now, busy, error, i18n,
  onClose, onResumeDelivery, onPauseDelivery, onToggleArea,
}) => {
  const { t, isRTL } = i18n;
  const branch = summary.branch;
  const name = isRTL ? branch.nameAr : branch.nameEn;

  return (
    <AdminModal title={name} isRTL={isRTL} onClose={onClose} size="lg" dismissable={!busy}>
      <div className="space-y-4">
        {error ? <Notice title={t('loadFailed')} action={error} tone="blocking" /> : null}

        {/* contact */}
        <div className="space-y-1">
          <Text variant="label" as="h3">{t('contactLabel')}</Text>
          <Text variant="caption" tone="secondary" as="p" numeric>
            {[branch.phone, branch.email].filter(Boolean).join(' · ') || '—'}
          </Text>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? branch.addressAr : branch.addressEn}
          </Text>
        </div>

        {/* delivery */}
        <div className="space-y-2 border-t border-con-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Text variant="label" as="h3">{t('deliveryPausedLabel')}</Text>
            <StatusPill
              label={summary.deliveryPaused ? t('deliveryPausedLabel') : t('deliveryRunningLabel')}
              tone={summary.deliveryPaused ? 'danger' : 'success'}
            />
          </div>
          {summary.deliveryPaused ? (
            <Button label={t('resumeDelivery')} onClick={onResumeDelivery} disabled={busy} variant="secondary" />
          ) : (
            <Button label={t('pauseDelivery')} onClick={onPauseDelivery} disabled={busy} variant="secondary" />
          )}
        </div>

        {/* closed items */}
        <div className="space-y-2 border-t border-con-line pt-3">
          <Text variant="label" as="h3">
            {t('closedItemsLabel')} ({summary.closedProducts.length})
          </Text>
          {summary.closedProducts.length === 0 ? (
            <Text variant="caption" tone="tertiary" as="p">—</Text>
          ) : (
            <div className="space-y-1">
              {summary.closedProducts.map(({ product, snoozedUntil }) => {
                const remaining = returnLabel(snoozedUntil, now);
                return (
                  <div key={product.id} className="flex items-center justify-between gap-2">
                    <Text variant="caption" as="span">{isRTL ? product.nameAr : product.nameEn}</Text>
                    <Text variant="caption" tone="tertiary" as="span" numeric>
                      {!snoozedUntil ? t('untimed') : remaining ? `${t('backIn')} ${remaining}` : t('reopeningNow')}
                    </Text>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* advisory areas */}
        <div className="space-y-2 border-t border-con-line pt-3">
          <Text variant="label" as="h3">{t('areasLabel')}</Text>
          <Text variant="caption" tone="tertiary" as="p">{t('advisoryAreasNote')}</Text>
          {areas.length === 0 ? (
            <Text variant="caption" tone="tertiary" as="p">—</Text>
          ) : (
            <div className="space-y-1">
              {areas.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <Text variant="caption" as="span">{isRTL ? a.nameAr : (a.nameEn || a.nameAr)}</Text>
                  <Button
                    label={a.isDisabled ? t('enableArea') : t('disableArea')}
                    onClick={() => onToggleArea(a)}
                    disabled={busy}
                    variant="secondary"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* trading hours */}
        <div className="space-y-1 border-t border-con-line pt-3">
          <Text variant="label" as="h3">{t('workingHoursLabel')}</Text>
          {WEEKDAYS.map(({ index, en, ar }) => {
            const day = hours.find((h) => h.dayOfWeek === index)
              ?? { dayOfWeek: index, isClosed: true, opensAt: null, closesAt: null };
            return (
              <div key={index} className="flex items-center justify-between gap-2">
                <Text variant="caption" tone="secondary" as="span">{isRTL ? ar : en}</Text>
                <Text variant="caption" tone="tertiary" as="span" numeric>
                  {formatWindow(day, isRTL)}
                </Text>
              </div>
            );
          })}
        </div>
      </div>
    </AdminModal>
  );
};
