/**
 * "Orders Requiring Verification" — read-only ambiguous-POS feed.
 *
 * Lists orders whose POS outcome is genuinely unknown (state
 * 'confirmation_required') oldest-first, with a count badge and safe fields
 * only. There is NO resend, resolve, refund or cancel here, and that is the
 * point: nobody can tell from this side whether the POS took the order, so any
 * action offered here would be a guess with a customer's food on the other end.
 * "View" opens the same read-only receipt.
 *
 * Data comes from the `is_admin()`-gated `list_pos_confirmation_required` RPC.
 * The card self-hides once the queue is empty — a busy live board should not
 * carry a permanent empty box — and refreshes on mount and every 60s. The
 * `alive` flag is what stops a late response writing into an unmounted card.
 */
import React, { useEffect, useState } from 'react';
import { Eye, ShieldAlert } from 'lucide-react';

import { orders as ordersApi, type PosConfirmationRequired } from '../../../../lib/api';
import { Card } from '../../../../design-system/ui/Card';
import { Text } from '../../../../design-system/ui/Text';
import { Price } from '../../../Price';
import { ADMIN_LOCALES } from '../../adminLocales';
import { POS_VERIFY_LIMIT, POS_VERIFY_REFRESH_MS, verifyReasonKey } from './ordersView';

export function OrdersRequiringVerificationCard({
  adminLang,
  onView,
}: {
  adminLang: 'en' | 'ar';
  onView: (id: string) => void;
}) {
  const t = ADMIN_LOCALES[adminLang];
  const [data, setData] = useState<PosConfirmationRequired | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const d = await ordersApi.posConfirmationRequired(POS_VERIFY_LIMIT); if (alive) setData(d); }
      catch { if (alive) setData(null); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    const id = setInterval(() => void load(), POS_VERIFY_REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const whenText = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleString(adminLang === 'ar' ? 'ar' : 'en', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const total = data?.total ?? 0;
  // Hidden entirely once nothing needs verification.
  if (!loading && total === 0) return null;

  return (
    <Card tone="warning" className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 shrink-0 text-amber-ink" aria-hidden="true" />
          <Text variant="heading" tone="warning" as="h3">{t.verify_title}</Text>
          {/* Filled amber-ink, not warn-tint: the card ground is already
              warn-tint, so a tinted badge would disappear into it. */}
          {total > 0 && (
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-ink px-2 py-0.5">
              <Text variant="caption" tone="onEmber" numeric as="span">{total}</Text>
            </span>
          )}
        </div>
        <Text variant="caption" tone="secondary" as="p" className="mt-1">{t.verify_sub}</Text>
      </div>

      {loading ? (
        <Text variant="body" tone="tertiary" as="p">…</Text>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-1.5">
          {data.items.map((it) => (
            <div
              key={it.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 py-2"
            >
              <div className="min-w-0">
                <Text variant="label" numeric as="p" className="truncate">{it.order_number}</Text>
                <Text variant="caption" tone="secondary" as="p" className="truncate">
                  {t[verifyReasonKey(it.reason)]} · {t.verify_since} {whenText(it.first_pos_sync_failure_at ?? it.created_at)}
                </Text>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Text variant="label" as="span"><Price amount={it.total} lang={adminLang} /></Text>
                <button
                  type="button"
                  onClick={() => onView(it.id)}
                  className="ds-motion inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-2.5 transition-colors duration-150 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <Eye className="size-3 text-ember" aria-hidden="true" />
                  <Text variant="caption" tone="ember" as="span">{t.view_details}</Text>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Text variant="body" tone="secondary" as="p">{t.verify_empty}</Text>
      )}
    </Card>
  );
}
