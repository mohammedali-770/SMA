/**
 * Tap payment details for an online order, inside the receipt.
 *
 * Provider, charge id, live/test badge, card brand and last four, and the
 * sanitized failure message. Reads only the safe `payment_records` columns
 * (RLS: staff read) — no raw payload, no secrets.
 *
 * The Verify action re-checks the charge through Tap's Retrieve Charge. It can
 * only ever CONFIRM: a genuine CAPTURED marks the order paid, anything else
 * leaves it exactly as it was. It is offered to an admin and not to an
 * accountant, and only while the order is not already paid. All of that is
 * carried over unchanged — this migration restyles it and nothing else.
 */
import React, { useEffect, useState } from 'react';

import { paymentGateway, type DbPaymentRecord } from '../../../../lib/api';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import type { Order } from '../../../../types';
import { DetailRow } from './DetailRow';

export function TapPaymentDetails({
  order,
  isAccountant,
  isRTL,
}: {
  order: Order;
  isAccountant: boolean;
  isRTL: boolean;
}) {
  const [rec, setRec] = useState<DbPaymentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRec(await paymentGateway.record(order.id)); } catch { setRec(null); } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [order.id]);

  if (order.paymentMethod !== 'online') return null;
  if (loading) {
    return (
      <div className="rounded-[var(--radius-ds-md)] bg-con-surface-2 p-3">
        <Text variant="caption" tone="tertiary" as="p">
          {isRTL ? 'جاري تحميل تفاصيل الدفع…' : 'Loading payment details…'}
        </Text>
      </div>
    );
  }
  if (!rec || rec.provider !== 'tap') return null;

  const isLive = rec.mode === 'live';
  const paid = rec.status === 'paid';
  const verify = async () => {
    setVerifying(true);
    setResult(null);
    try {
      const r = await paymentGateway.adminVerify(order.id);
      setResult(r.status);
      await load();
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'error');
    } finally {
      setVerifying(false);
    }
  };

  const card = [rec.card_scheme, rec.card_last_four ? `•••• ${rec.card_last_four}` : '']
    .filter(Boolean).join(' ');

  return (
    <div className="space-y-2 rounded-[var(--radius-ds-md)] bg-con-surface-2 p-3">
      <DetailRow label="Payment provider">
        <span className="inline-flex items-center gap-1.5">
          <Text variant="label" as="span">Tap</Text>
          {/* LIVE is danger, TEST is warning: reading a live charge as a test
              one is the mistake that matters, so it gets the louder tone. */}
          <StatusPill label={isLive ? 'LIVE' : 'TEST'} tone={isLive ? 'danger' : 'warning'} />
        </span>
      </DetailRow>

      {rec.provider_ref && (
        <DetailRow label="Charge ID">
          <Text variant="caption" tone="secondary" numeric as="span" className="truncate">
            {rec.provider_ref}
          </Text>
        </DetailRow>
      )}

      <DetailRow label="Provider status">
        <StatusPill
          label={rec.status}
          tone={paid ? 'success' : rec.status === 'failed' ? 'danger' : 'warning'}
        />
      </DetailRow>

      {card && (
        <DetailRow label="Card">
          <Text variant="label" tone="secondary" numeric as="span">{card}</Text>
        </DetailRow>
      )}

      {rec.failure_message_safe && (
        <DetailRow label="Note">
          <Text variant="label" tone="danger" as="span">{rec.failure_message_safe}</Text>
        </DetailRow>
      )}

      {!isAccountant && !paid && (
        <div className="flex items-center justify-between gap-2 border-t border-con-line pt-2">
          <Text variant="caption" tone="tertiary" as="span">
            {isRTL ? 'إعادة التحقق من الدفع عبر Tap' : 'Re-verify via Tap'}
          </Text>
          <button
            type="button"
            onClick={() => void verify()}
            disabled={verifying}
            className="ds-motion inline-flex min-h-9 items-center rounded-[var(--radius-ds-md)] bg-ember px-3 text-on-ember transition-opacity duration-150 hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Text variant="label" tone="onEmber" as="span">
              {verifying ? '…' : (isRTL ? 'تحقق' : 'Verify')}
            </Text>
          </button>
        </div>
      )}

      {result && (
        <Text variant="caption" tone="secondary" as="p">
          {isRTL ? 'النتيجة' : 'Result'}: {result}
        </Text>
      )}
    </div>
  );
}
