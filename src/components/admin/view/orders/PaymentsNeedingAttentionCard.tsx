/**
 * "Refunds and payments needing attention" — read-only, admin-only.
 *
 * Gaps PG-01 and PG-02 (docs/readiness/20261113-card-payments-gaps.md): a
 * refund that failed or kept failing, a customer charged twice, and money taken
 * with no confirmed order were all on no screen. This card lists them from the
 * `is_admin()`-gated `list_payments_needing_attention` RPC (20261013120000),
 * each section with what to do, which is refunding by hand in Moyasar's
 * dashboard (docs/PAYMENTS.md section 10).
 *
 * There is NO refund, retry or mark-done button here, deliberately. A refund is
 * a live money action, and how a hand refund is recorded is still the owner's
 * decision (gap PG-14). The only action is "View", which opens the same
 * read-only receipt as the POS-verification card beside it.
 *
 * It hides itself when nothing needs attention, before the migration is
 * applied (PGRST202) and for anyone who is not an admin at AAL2 (42501). Any
 * other failed read is SHOWN, because an empty card must never mean "nothing
 * to refund" when it really means "could not look". Refreshes on mount and
 * every 60s; `alive` stops a late answer writing into an unmounted card.
 */
import React, { useEffect, useState } from 'react';
import { Eye, HandCoins } from 'lucide-react';

import {
  paymentGateway,
  type AttentionPayment,
  type AttentionRefund,
  type AttentionUnconfirmed,
  type PaymentsNeedingAttention,
} from '../../../../lib/api';
import { Card } from '../../../../design-system/ui/Card';
import { Text } from '../../../../design-system/ui/Text';
import { formatRiyadhDateTime } from '../../../../utils/calculations';
import { Price } from '../../../Price';
import { ADMIN_LOCALES, type AdminLocale } from '../../adminLocales';
import {
  PAYMENTS_ATTENTION_LIMIT,
  PAYMENTS_ATTENTION_REFRESH_MS,
  attentionFailure,
  attentionReasonKey,
  attentionSections,
  attentionTotal,
  hiddenCount,
  type AttentionSectionId,
} from './paymentsAttentionView';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: PaymentsNeedingAttention }
  | { kind: 'hidden' }
  | { kind: 'error' };

const ROW =
  'flex items-start justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 py-2';

const SECTION_TEXT: Record<AttentionSectionId, { title: keyof AdminLocale; todo: keyof AdminLocale }> = {
  unconfirmed_payments: { title: 'payattn_unconfirmed_title', todo: 'payattn_unconfirmed_do' },
  payments_to_refund: { title: 'payattn_payments_title', todo: 'payattn_payments_do' },
  failed_refunds: { title: 'payattn_failed_title', todo: 'payattn_failed_do' },
  retrying_refunds: { title: 'payattn_retrying_title', todo: 'payattn_retrying_do' },
};

export function PaymentsNeedingAttentionCard({
  adminLang,
  onView,
}: {
  adminLang: 'en' | 'ar';
  onView: (orderId: string) => void;
}) {
  const t = ADMIN_LOCALES[adminLang];
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await paymentGateway.attention(PAYMENTS_ATTENTION_LIMIT);
        if (alive) setState({ kind: 'ready', data });
      } catch (e) {
        if (alive) setState({ kind: attentionFailure(e) });
      }
    };
    void load();
    const id = setInterval(() => void load(), PAYMENTS_ATTENTION_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (state.kind === 'hidden' || state.kind === 'loading') return null;
  if (state.kind === 'ready' && attentionTotal(state.data) === 0) return null;

  // Riyadh time with Latin digits in both languages, like the receipts.
  const when = (iso: string | null | undefined): string => (iso ? formatRiyadhDateTime(iso) : '—');
  const reason = (code: string | null | undefined): string | null => {
    const key = attentionReasonKey(code);
    if (!key) return null;
    return key === 'payattn_reason_other' ? `${t[key]} (${code})` : t[key];
  };
  // A sandbox payment is found in Moyasar's test view, not among live payments.
  const testMode = (mode: string | null | undefined): string | null =>
    mode === 'test' ? t.payattn_test_mode : null;
  const viewButton = (orderId: string | null) =>
    orderId ? (
      <button
        type="button"
        onClick={() => onView(orderId)}
        className="ds-motion inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-2.5 transition-colors duration-150 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Eye className="size-3 text-ember" aria-hidden="true" />
        <Text variant="caption" tone="ember" as="span">
          {t.view_details}
        </Text>
      </button>
    ) : null;
  const paymentId = (ref: string | null) =>
    ref ? (
      <Text variant="caption" tone="tertiary" as="p" className="break-all">
        {t.payattn_payment_id}: <span className="font-mono select-all">{ref}</span>
      </Text>
    ) : null;

  const refundRow = (r: AttentionRefund) => (
    <div key={r.id} className={ROW}>
      <div className="min-w-0 space-y-0.5">
        <Text variant="label" numeric as="p" className="truncate">
          {r.order_number}
        </Text>
        <Text variant="caption" tone="secondary" as="p">
          {[
            reason(r.failure_code),
            `${t.payattn_attempts}: ${r.attempt_count}`,
            `${t.payattn_since} ${when(r.created_at)}`,
            `${t.payattn_last_try} ${when(r.updated_at)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {paymentId(r.payment_ref)}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Text variant="label" as="span">
          <Price amount={r.amount} lang={adminLang} />
        </Text>
        {viewButton(r.order_id)}
      </div>
    </div>
  );

  const paymentRow = (p: AttentionPayment) => (
    <div key={p.id} className={ROW}>
      <div className="min-w-0 space-y-0.5">
        <Text variant="label" numeric as="p" className="truncate">
          {p.order_number ?? t.payattn_no_order}
        </Text>
        <Text variant="caption" tone="secondary" as="p">
          {[
            p.kind === 'duplicate_payment' ? t.payattn_kind_duplicate : t.payattn_kind_mismatch,
            testMode(p.mode),
            `${t.payattn_since} ${when(p.created_at)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {paymentId(p.payment_ref)}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Text variant="label" as="span">
          <Price amount={p.amount} lang={adminLang} />
        </Text>
        {viewButton(p.order_id)}
      </div>
    </div>
  );

  const unconfirmedRow = (u: AttentionUnconfirmed) => (
    <div key={u.payment_ref} className={ROW}>
      <div className="min-w-0 space-y-0.5">
        <Text variant="label" numeric as="p" className="truncate">
          {u.order_number ?? t.payattn_no_order}
        </Text>
        <Text variant="caption" tone="secondary" as="p">
          {[
            reason(u.error),
            testMode(u.mode),
            `${t.payattn_logged_times}: ${u.log_count}`,
            `${t.payattn_since} ${when(u.first_logged_at)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {paymentId(u.payment_ref)}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {u.amount != null ? (
          <Text variant="label" as="span">
            <Price amount={u.amount} lang={adminLang} />
          </Text>
        ) : null}
        {viewButton(u.order_id)}
      </div>
    </div>
  );

  const total = state.kind === 'ready' ? attentionTotal(state.data) : 0;

  return (
    <Card tone="danger" className="space-y-3" role="region" aria-label={t.payattn_title}>
      <div>
        <div className="flex items-center gap-2">
          <HandCoins className="size-4 shrink-0 text-danger-ds" aria-hidden="true" />
          <Text variant="heading" tone="danger" as="h3">
            {t.payattn_title}
          </Text>
          {total > 0 && (
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-danger-ds px-2 py-0.5">
              <Text variant="caption" tone="onEmber" numeric as="span">
                {total}
              </Text>
            </span>
          )}
        </div>
        <Text variant="caption" tone="secondary" as="p" className="mt-1">
          {t.payattn_sub}
        </Text>
      </div>

      {state.kind === 'error' ? (
        <Text variant="body" tone="danger" as="p" role="alert">
          {t.payattn_error}
        </Text>
      ) : (
        attentionSections(state.data).map((id) => {
          const section = state.data[id];
          const more = hiddenCount(section);
          return (
            <section key={id} className="space-y-1.5" aria-label={t[SECTION_TEXT[id].title]}>
              <Text variant="label" as="h4">
                {t[SECTION_TEXT[id].title]} ({section.total})
              </Text>
              <Text variant="caption" tone="secondary" as="p">
                {t[SECTION_TEXT[id].todo]}
              </Text>
              {id === 'unconfirmed_payments'
                ? state.data.unconfirmed_payments.items.map(unconfirmedRow)
                : id === 'payments_to_refund'
                  ? state.data.payments_to_refund.items.map(paymentRow)
                  : state.data[id].items.map(refundRow)}
              {more > 0 ? (
                <Text variant="caption" tone="tertiary" as="p">
                  +{more} {t.payattn_more}
                </Text>
              ) : null}
            </section>
          );
        })
      )}
    </Card>
  );
}
