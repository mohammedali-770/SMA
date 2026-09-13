/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Inbox } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import type { DeliveryRequestRow } from '../../lib/opsApi';
import type { Branch } from '../../types';
import { deliveryReasonKey } from './branchConsole';
import { isAwaiting, minutesUntilExpiry } from './branchReference';
import type { OpsLangValue } from './useOpsLang';

/**
 * Branch requests waiting for an answer, at the top of the call-centre board.
 *
 * WHY THIS IS A SEPARATE SECTION rather than a marker on the branch tiles.
 * Everything else on this board has already happened and is merely reported —
 * the branch closed an item, somebody paused delivery. A waiting request is the
 * only thing that asks the operator to DECIDE, and it expires unanswered. Mixed
 * into the tiles it would be one more amber row among many; at the top it is a
 * queue with two buttons. That is the same reasoning `callCentre.ts` gives for
 * keeping closed and blocked products apart: folding distinct demands into one
 * list makes the operator treat them alike.
 *
 * The card renders nothing at all when the queue is empty — an empty queue is
 * the normal state, and a permanent "no requests" panel would be noise on a
 * board whose whole design is to show only what is wrong.
 */
export const RequestsWaitingCard: React.FC<{
  requests: DeliveryRequestRow[];
  branches: Branch[];
  now: number;
  busy: boolean;
  error: string | null;
  i18n: OpsLangValue;
  onAnswer: (requestId: string, accept: boolean) => void;
}> = ({ requests, branches, now, busy, error, i18n, onAnswer }) => {
  const { t, isRTL } = i18n;

  // Expiry is decided here, not from `status`: the server retires a stale
  // request only when somebody touches it, so a row can still read 'pending'
  // past its own expiry. Offering Accept on one of those would be offering a
  // button that cannot work.
  const live = requests.filter((r) => isAwaiting(r, now));
  if (live.length === 0 && !error) return null;

  const branchName = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? (isRTL ? b.nameAr : b.nameEn) : id;
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Inbox className="size-4 text-ember" aria-hidden="true" />
        <Text variant="heading" as="h2">
          {t('requestsWaiting')}
        </Text>
        {live.length > 0 ? <StatusPill label={String(live.length)} tone="danger" /> : null}
      </div>

      {error ? <Notice title={t('requestAnswerFailed')} action={error} tone="blocking" /> : null}

      {live.map((req) => {
        const reason = deliveryReasonKey(req.reasonCode);
        return (
          <div
            key={req.id}
            className="space-y-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Text variant="label" as="p">
                {t('requestFrom')} {branchName(req.branchId)}
              </Text>
              <Text variant="caption" tone="tertiary" as="span" numeric>
                {t('requestExpiresIn')} {minutesUntilExpiry(req, now)}
                {t('requestMinutesShort')}
              </Text>
            </div>

            <Text variant="caption" tone="tertiary" as="p" numeric>
              {t('requestAskedFor')}: {req.requestedMinutes}
              {t('requestMinutesShort')}
              {reason ? ` · ${t('reasonLabelShort')}: ${t(reason)}` : ''}
            </Text>

            {/* The branch's own words. Without these the operator is deciding
                on a duration and a code alone. */}
            {req.note ? (
              <Text variant="body" as="p">
                {req.note}
              </Text>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button label={t('requestAccept')} onClick={() => onAnswer(req.id, true)} disabled={busy} />
              <Button
                label={t('requestDecline')}
                onClick={() => onAnswer(req.id, false)}
                disabled={busy}
                variant="secondary"
              />
            </div>
          </div>
        );
      })}
    </Card>
  );
};
