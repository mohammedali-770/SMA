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
import { OpsChoiceChips } from './OpsChoiceChips';

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
  /** Overridden when the target is one OPTION rather than a whole product. */
  titleKey?: 'closeTitle' | 'closeOptionTitle';
  hintKey?: 'autoReopenHint' | 'optionAutoReopenHint';
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (minutes: number, reason: OpsReasonCode, note: string) => void;
}> = ({
  productName, i18n, busy, error, onCancel, onConfirm,
  titleKey = 'closeTitle', hintKey = 'autoReopenHint',
}) => {
  const { t, isRTL } = i18n;
  const [minutes, setMinutes] = useState(DURATION_OPTIONS[0].minutes);
  const [reason, setReason] = useState<OpsReasonCode>(REASON_OPTIONS[0].code);
  const [note, setNote] = useState('');

  return (
    <AdminModal
      title={t(titleKey)}
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

        <OpsChoiceChips
          legend={t('durationLabel')}
          options={DURATION_OPTIONS.map((d) => ({ value: d.minutes, label: t(d.key) }))}
          value={minutes}
          disabled={busy}
          onChange={(v) => setMinutes(v)}
        />

        <OpsChoiceChips
          legend={t('reasonLabel')}
          options={REASON_OPTIONS.map((r) => ({ value: r.code, label: t(r.key) }))}
          value={reason}
          disabled={busy}
          onChange={(v) => setReason(v)}
        />

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

        <Text variant="caption" tone="tertiary" as="p">{t(hintKey)}</Text>
      </div>
    </AdminModal>
  );
};
