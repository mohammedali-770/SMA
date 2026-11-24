/**
 * Account deletions held for review — the way out of `manual_review`.
 *
 * WHY THIS EXISTS. A deletion request that lands in `manual_review` (a staff
 * account that asked to be deleted, an order still open past the SLA, a
 * persistent failure) locks the account: no new unpaid order, checkout session,
 * address or push device — and the erasure request, a PDPL obligation, stays
 * open. `resolve_account_deletion_request` was the only exit and no client
 * called it (audit F-X11-001), while the Health card showed a bare count.
 *
 * ADMIN ONLY, and the server is the real gate: the RPC checks `is_admin()` (role
 * AND AAL2) itself. The shell mounts this for admins only so nobody is offered a
 * button the server will refuse; a refusal (an admin at AAL1) is shown verbatim.
 *
 * TWO ACTIONS, both through the existing RPC and both confirmed:
 *   - Retry  re-queues it through the normal processor, which re-checks every
 *            blocker. Not offered when the server would refuse it. For a staff
 *            hold it only re-holds the request, and the confirmation says so.
 *   - Close  marks it failed. That RELEASES the account lock; it erases nothing
 *            and the customer must re-verify to ask again. This is the exit for
 *            a staff hold.
 * The optional note is stored only in the admin-only audit table.
 */
import React, { useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, XCircle } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import {
  accountDeletionReview,
  STAFF_HOLD_REASON,
  type DeletionResolveAction,
  type DeletionReviewRequest,
} from '../../lib/accountDeletionReviewApi';
import { exactTime, relativeAge } from './view/adminTime';

const INPUT = [
  'min-h-10 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[14px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

/** A friendly line for the codes the processor writes; the raw code is always shown too. */
export function reasonExplanation(reason: string | null, isAr: boolean): string {
  if (reason === STAFF_HOLD_REASON) {
    return isAr
      ? 'حساب موظف طلب الحذف. لا يُحذف حساب الموظف عبر هذا المسار.'
      : 'A staff account asked to be deleted. Staff accounts are never erased by this queue.';
  }
  if (reason && /^blocked_.+_over_sla$/.test(reason)) {
    return isAr
      ? 'ما زال هناك طلب أو دفعة مفتوحة بعد انتهاء المهلة.'
      : 'An order or payment was still open after the waiting period.';
  }
  return isAr ? 'فشلت المعالجة بشكل متكرر.' : 'Processing failed repeatedly.';
}

export const AccountDeletionReviewPanel: React.FC<{ lang: 'en' | 'ar' }> = ({ lang }) => {
  const isAr = lang === 'ar';
  const [rows, setRows] = useState<DeletionReviewRequest[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await accountDeletionReview.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = async (row: DeletionReviewRequest, action: DeletionResolveAction) => {
    const short = row.id.slice(0, 8);
    setSaved(null);
    setError(null);
    const staffHold = row.reason === STAFF_HOLD_REASON;
    const message =
      action === 'fail'
        ? isAr
          ? `إغلاق الطلب ${short} كفاشل؟ سيُرفع قفل الحساب. لا يُحذف أي شيء، وعلى صاحب الحساب إعادة التحقق من هويته ليطلب الحذف مجدداً.`
          : `Close request ${short} as failed? This releases the account lock. Nothing is erased, and the account holder must re-verify to ask again.`
        : isAr
          ? `إعادة الطلب ${short} إلى قائمة المعالجة؟ ستعيد المعالجة فحص كل ما يمنع الحذف.${staffHold ? ' حساب الموظف سيُحجز مرة أخرى.' : ''}`
          : `Re-queue request ${short}? The processor will re-check every blocker.${staffHold ? ' A staff account will simply be held again.' : ''}`;
    if (!window.confirm(message)) return;

    setBusyId(row.id);
    try {
      await accountDeletionReview.resolve(row.id, action, notes[row.id] ?? '');
      setNotes((p) => ({ ...p, [row.id]: '' }));
      setSaved(
        action === 'fail'
          ? isAr
            ? 'تم إغلاق الطلب وتسجيله في سجل التدقيق.'
            : 'Request closed, and written to the audit trail.'
          : isAr
            ? 'أُعيد الطلب إلى المعالجة وسُجّل في سجل التدقيق.'
            : 'Request re-queued, and written to the audit trail.',
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-con-line pb-3">
        <div>
          <Text variant="title" as="h3">
            {isAr ? 'طلبات حذف الحسابات المعلّقة' : 'Held account deletions'}
          </Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isAr
              ? 'طلب في المراجعة اليدوية يقفل الحساب: لا طلبات غير مدفوعة ولا عناوين جديدة، حتى يُحسم هنا.'
              : 'A request in manual review locks its account: no new unpaid orders or addresses until it is resolved here.'}
          </Text>
        </div>
        <Button
          label={isAr ? 'تحديث' : 'Refresh'}
          onClick={() => void refresh()}
          disabled={loading || busyId !== null}
          variant="secondary"
          leading={<RefreshCw className="size-4" />}
        />
      </div>

      {error ? (
        <Notice
          title={isAr ? 'تعذر تنفيذ العملية' : 'Action could not be completed'}
          action={error}
          tone="blocking"
        />
      ) : null}
      {saved ? <Notice title={isAr ? 'تم الحفظ' : 'Saved'} action={saved} tone="success" /> : null}

      <Card className="space-y-2">
        {loading ? (
          <Text variant="body" tone="tertiary" as="p">
            {isAr ? 'جارٍ التحميل…' : 'Loading…'}
          </Text>
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <Text variant="body" tone="tertiary" as="p">
            {isAr ? 'لا توجد طلبات حذف معلّقة.' : 'No account deletions are held for review.'}
          </Text>
        ) : null}
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3 md:grid-cols-[minmax(200px,1.5fr)_minmax(160px,1fr)_auto] md:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Text variant="label" as="span" numeric>
                  {r.id.slice(0, 8)}
                </Text>
                <StatusPill
                  label={r.reason ?? (isAr ? 'بلا سبب' : 'no reason')}
                  tone={r.reason === STAFF_HOLD_REASON ? 'warning' : 'neutral'}
                />
              </div>
              <Text variant="caption" tone="tertiary" as="p" className="mt-1">
                {reasonExplanation(r.reason, isAr)}
              </Text>
              <Text variant="caption" tone="tertiary" as="p" numeric>
                {isAr ? 'منذ ' : 'Held for '}
                {relativeAge(r.requested_at, lang)} · {exactTime(r.requested_at, lang)}
              </Text>
            </div>
            <input
              aria-label={`${r.id.slice(0, 8)} note`}
              value={notes[r.id] ?? ''}
              onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
              placeholder={isAr ? 'ملاحظة (اختيارية، للمدراء فقط)' : 'Note (optional, admins only)'}
              maxLength={500}
              className={INPUT}
              disabled={busyId !== null}
            />
            <div className="flex flex-wrap gap-2">
              {r.canRetry ? (
                <Button
                  label={isAr ? 'إعادة المحاولة' : 'Retry'}
                  onClick={() => void resolve(r, 'retry')}
                  disabled={busyId !== null}
                  variant="secondary"
                  leading={<RotateCcw className="size-4" />}
                />
              ) : null}
              <Button
                label={
                  busyId === r.id
                    ? isAr
                      ? 'جارٍ الحفظ…'
                      : 'Saving…'
                    : isAr
                      ? 'إغلاق كفاشل'
                      : 'Close as failed'
                }
                onClick={() => void resolve(r, 'fail')}
                disabled={busyId !== null}
                variant="secondary"
                leading={<XCircle className="size-4" />}
              />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
};
