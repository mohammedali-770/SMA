/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

import { AdminModal } from '../admin/view/shared/AdminModal';
import { Button } from '../../design-system/ui/Button';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import type { OpsReasonCode } from '../../lib/opsApi';
import { DURATION_OPTIONS, REASON_OPTIONS } from './branchConsole';
import type { OpsLangValue } from './useOpsLang';

/** Chip button sized for a thumb on POS hardware, not a mouse. */
const chip = (selected: boolean) =>
  [
    'ds-motion inline-flex min-h-11 items-center justify-center rounded-[var(--radius-ds-md)]',
    'border px-4 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
    selected ? 'border-ember bg-ember' : 'border-con-line bg-con-surface hover:bg-con-surface-2',
  ].join(' ');

/**
 * The close flow: pick how long, pick why, optionally say more.
 *
 * Both choices are pre-selected — 30 minutes and "out of stock" are what a
 * cashier means the overwhelming majority of the time — so the common case is
 * open, confirm, done. Nothing here offers an untimed closure: the whole point
 * is that this reopens itself.
 */
export const CloseItemDialog: React.FC<{
  productName: string;
  i18n: OpsLangValue;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (minutes: number, reason: OpsReasonCode, note: string) => void;
}> = ({ productName, i18n, busy, error, onCancel, onConfirm }) => {
  const { t, isRTL } = i18n;
  const [minutes, setMinutes] = useState(DURATION_OPTIONS[0].minutes);
  const [reason, setReason] = useState<OpsReasonCode>(REASON_OPTIONS[0].code);
  const [note, setNote] = useState('');

  return (
    <AdminModal
      title={t('closeTitle')}
      subtitle={productName}
      isRTL={isRTL}
      onClose={onCancel}
      size="md"
      dismissable={!busy}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button label={t('cancel')} onClick={onCancel} variant="secondary" disabled={busy} />
          <Button
            label={busy ? t('working') : t('confirmClose')}
            onClick={() => onConfirm(minutes, reason, note)}
            disabled={busy}
          />
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <Notice title={t('loadFailed')} action={error} tone="blocking" /> : null}

        <div className="space-y-2">
          <Text variant="label" as="p">{t('durationLabel')}</Text>
          <div className="flex flex-wrap gap-2">
            {DURATION_OPTIONS.map((d) => {
              const on = d.minutes === minutes;
              return (
                <button
                  key={d.minutes}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => { if (!busy) setMinutes(d.minutes); }}
                  className={chip(on)}
                >
                  <Text variant="label" tone={on ? 'onEmber' : 'secondary'} as="span">
                    {t(d.key)}
                  </Text>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Text variant="label" as="p">{t('reasonLabel')}</Text>
          <div className="flex flex-wrap gap-2">
            {REASON_OPTIONS.map((r) => {
              const on = r.code === reason;
              return (
                <button
                  key={r.code}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => { if (!busy) setReason(r.code); }}
                  className={chip(on)}
                >
                  <Text variant="label" tone={on ? 'onEmber' : 'secondary'} as="span">
                    {t(r.key)}
                  </Text>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Text variant="label" as="p">{t('noteLabel')}</Text>
          <textarea
            aria-label={t('noteLabel')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            rows={2}
            maxLength={500}
            disabled={busy}
            className="w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3 text-[15px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>

        <Text variant="caption" tone="tertiary" as="p">{t('autoReopenHint')}</Text>
      </div>
    </AdminModal>
  );
};
