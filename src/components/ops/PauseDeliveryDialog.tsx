/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

import { AdminModal } from '../admin/view/shared/AdminModal';
import { Button } from '../../design-system/ui/Button';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import type { DeliveryReasonCode } from '../../lib/opsApi';
import { DELIVERY_DURATION_OPTIONS, DELIVERY_REASON_OPTIONS } from './branchConsole';
import { OpsChoiceChips } from './OpsChoiceChips';
import { OpsLang, opsT } from './opsStrings';

/**
 * Pause one branch's delivery for a bounded period.
 *
 * Takes a bare language rather than the ops i18n object, so the admin console
 * (which has its own `adminLang`) and the call-centre console can render the
 * same dialog. Duplicating it per surface is how the two would drift.
 *
 * Like the item dialog there is no untimed option here: the untimed pause is the
 * separate admin toggle on the branch card, which is a different decision with a
 * different meaning ("off until further notice" rather than "off for an hour").
 */
export const PauseDeliveryDialog: React.FC<{
  branchName: string;
  lang: OpsLang;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (minutes: number, reason: DeliveryReasonCode, note: string) => void;
}> = ({ branchName, lang, busy, error, onCancel, onConfirm }) => {
  const t = (k: Parameters<typeof opsT>[1]) => opsT(lang, k);
  const isRTL = lang === 'ar';
  const [minutes, setMinutes] = useState(DELIVERY_DURATION_OPTIONS[0].minutes);
  const [reason, setReason] = useState<DeliveryReasonCode>(DELIVERY_REASON_OPTIONS[0].code);
  const [note, setNote] = useState('');

  return (
    <AdminModal
      title={t('pauseDeliveryTitle')}
      subtitle={branchName}
      isRTL={isRTL}
      onClose={onCancel}
      size="md"
      dismissable={!busy}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button label={t('cancel')} onClick={onCancel} variant="secondary" disabled={busy} />
          <Button
            label={busy ? t('working') : t('confirmPause')}
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
          options={DELIVERY_DURATION_OPTIONS.map((d) => ({ value: d.minutes, label: t(d.key) }))}
          value={minutes}
          disabled={busy}
          onChange={(v) => setMinutes(v)}
        />

        <OpsChoiceChips
          legend={t('reasonLabel')}
          options={DELIVERY_REASON_OPTIONS.map((r) => ({ value: r.code, label: t(r.key) }))}
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

        <Text variant="caption" tone="tertiary" as="p">{t('deliveryAutoResumeHint')}</Text>
      </div>
    </AdminModal>
  );
};
