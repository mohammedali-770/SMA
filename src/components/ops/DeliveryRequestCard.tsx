/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Clock, Truck } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import type { DeliveryRequestRow } from '../../lib/opsApi';
import { awaitingRequest, canRequest, lastAnswered, minutesUntilExpiry } from './branchReference';
import type { OpsLangValue } from './useOpsLang';

/**
 * The branch's side of a delivery closure: ask, wait, and be told the answer.
 *
 * The copy works hard on one point, because getting it wrong would be a real
 * operational failure rather than a cosmetic one: SENDING A REQUEST DOES NOT
 * STOP DELIVERY. A cashier who reads "request sent" as "delivery is off" will
 * stop worrying about orders that are still arriving. So the waiting state
 * states the live fact ("delivery is still running") rather than congratulating
 * the user on the send.
 */
export const DeliveryRequestCard: React.FC<{
  requests: DeliveryRequestRow[];
  deliveryClosed: boolean;
  now: number;
  busy: boolean;
  error: string | null;
  i18n: OpsLangValue;
  onRequest: () => void;
  onWithdraw: (requestId: string) => void;
}> = ({ requests, deliveryClosed, now, busy, error, i18n, onRequest, onWithdraw }) => {
  const { t } = i18n;
  const waiting = awaitingRequest(requests, now);
  const answered = lastAnswered(requests, now);
  const allowed = canRequest({ requests, deliveryClosed, now });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Truck className="size-4 text-ember" aria-hidden="true" />
        <Text variant="heading" as="h2">{t('deliveryRequestSection')}</Text>
        {waiting ? <StatusPill label={t('requestWaiting')} tone="warning" /> : null}
      </div>

      {error ? <Notice title={t('requestSendFailed')} action={error} tone="blocking" /> : null}

      {waiting ? (
        <div className="space-y-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3">
          {/* The live fact first. The request is secondary to what is true now. */}
          <Text variant="label" as="p">{t('requestWaitingHint')}</Text>
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-ink shrink-0" aria-hidden="true" />
            <Text variant="caption" tone="tertiary" as="p" numeric>
              {t('requestExpiresIn')} {minutesUntilExpiry(waiting, now)}{t('requestMinutesShort')}
            </Text>
          </div>
          {waiting.note ? (
            <Text variant="caption" tone="tertiary" as="p">{waiting.note}</Text>
          ) : null}
          <Button
            label={t('withdrawRequest')}
            onClick={() => onWithdraw(waiting.id)}
            disabled={busy}
            variant="secondary"
          />
        </div>
      ) : (
        <>
          {answered ? (
            <Notice
              title={answered.status === 'accepted' ? t('requestAccepted') : t('requestDeclined')}
              action={answered.resolutionNote ?? undefined}
              tone={answered.status === 'accepted' ? 'success' : 'warning'}
            />
          ) : (
            <Notice title={t('requestNoneTitle')} action={t('requestNoneBody')} tone="info" />
          )}

          {deliveryClosed ? (
            <Text variant="caption" tone="tertiary" as="p">{t('requestBlockedClosed')}</Text>
          ) : null}

          <Button
            label={t('requestCloseDelivery')}
            onClick={onRequest}
            disabled={busy || !allowed}
          />
          <Text variant="caption" tone="tertiary" as="p">{t('requestHint')}</Text>
        </>
      )}
    </Card>
  );
};
