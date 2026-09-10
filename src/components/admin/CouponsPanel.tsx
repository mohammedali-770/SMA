/**
 * Promo codes — the screen `public.coupons` never had.
 *
 * WHY IT EXISTS, because the reason shapes every control on it. On 2026-09-10
 * two codes were found live in Production: both active, both with no expiry, no
 * usage ceiling, no minimum spend and no discount cap, reachable from an
 * unconditional "Promo code" field on every checkout, and both guessable
 * brand-and-number strings seeded on the day the project was created. Nothing
 * had ever redeemed them, and nothing would have told anybody if something had.
 * Switching them off was a direct database write because this screen did not
 * exist. `docs/GO_LIVE_READINESS.md` G8; `docs/OWNER_ACTIONS.md` §36.
 *
 * SO THIS IS NOT A CRUD FORM. A list of codes with an edit button would have
 * displayed those two rows perfectly and told the operator nothing. The three
 * decisions that follow from that:
 *
 *   1. UNBOUNDEDNESS IS RENDERED, not implied by an empty cell. Each way a code
 *      is open-ended gets its own badge on the row and its own line in the
 *      draft summary, because "no expiry" and "no usage limit" and "no cap on a
 *      percentage" fail in different directions and an empty column says none
 *      of it.
 *   2. THE DRAFT IS PRICED BEFORE IT IS SAVED. The summary under the form says
 *      what the code can cost in the worst case, in words, while it is still a
 *      draft. That is the moment the decision is actually being made.
 *   3. STOPPING IS THE PRIMARY ACTION and deleting is refused once a code has
 *      been redeemed — `orders.coupon_code` is TEXT with no foreign key, so
 *      deleting a used code destroys the only record of what it was and leaves
 *      a discounted order nobody can explain.
 *
 * WHAT THIS SCREEN DOES NOT DO. It does not price anything. Redemption is
 * `validate_coupon(code, subtotal)` server-side, called by `place_order` with
 * its own subtotal; this panel edits a row and nothing else. The one rule here
 * with no database counterpart is the 0-100 ceiling on a percentage — the
 * column is only checked `>= 0`, so `validateDraft` is not a convenience there,
 * it is the only guard. See `couponsApi`'s header.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Tag, Trash2 } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import {
  couponRisks,
  couponState,
  couponsApi,
  normaliseCode,
  validateDraft,
  type Coupon,
  type CouponDraft,
  type CouponRisk,
  type CouponState,
  type DraftProblem,
} from '../../lib/couponsApi';
import { Price } from '../Price';

const INPUT = [
  'ds-motion min-h-10 w-full rounded-[var(--radius-ds-md)] border border-con-line',
  'bg-con-surface px-3 text-[14px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
].join(' ');
const SELECT = INPUT;
const LABEL = 'block text-[9px] font-black text-con-text-3 uppercase mb-1';
const TD = 'px-3 py-2 align-middle';

const EMPTY_DRAFT: CouponDraft = {
  code: '',
  type: 'percentage',
  value: '',
  minOrderAmount: '',
  maxDiscountAmount: '',
  startsAt: '',
  endsAt: '',
  usageLimit: '',
};

/** One sentence per problem, in the operator's language. */
const PROBLEM_TEXT: Record<DraftProblem, { en: string; ar: string }> = {
  'code-too-short': { en: 'The code must be at least 3 characters.', ar: 'يجب ألا يقل الرمز عن ٣ أحرف.' },
  'code-too-long': { en: 'The code must be at most 32 characters.', ar: 'يجب ألا يزيد الرمز عن ٣٢ حرفاً.' },
  'code-charset': {
    en: 'Use letters, numbers, hyphen or underscore only — a code with spaces is painful to read out.',
    ar: 'استخدم الحروف والأرقام والشرطة فقط — الرمز الذي يحتوي مسافات يصعب إملاؤه.',
  },
  'value-not-a-number': { en: 'Enter a discount value.', ar: 'أدخل قيمة الخصم.' },
  'percentage-out-of-range': {
    en: 'A percentage must be between 1 and 100. The database does NOT enforce this — 500% would be a legal row that makes every order free.',
    ar: 'النسبة يجب أن تكون بين ١ و١٠٠. قاعدة البيانات لا تمنع غير ذلك — ٥٠٠٪ صف صالح يجعل كل الطلبات مجانية.',
  },
  'fixed-not-positive': {
    en: 'A fixed discount must be greater than zero.',
    ar: 'الخصم الثابت يجب أن يكون أكبر من صفر.',
  },
  'minimum-negative': {
    en: 'The minimum spend cannot be negative.',
    ar: 'الحد الأدنى للطلب لا يمكن أن يكون سالباً.',
  },
  'cap-negative': { en: 'The discount cap cannot be negative.', ar: 'سقف الخصم لا يمكن أن يكون سالباً.' },
  'usage-limit-negative': {
    en: 'The usage limit cannot be negative.',
    ar: 'حد الاستخدام لا يمكن أن يكون سالباً.',
  },
  'window-backwards': {
    en: 'The end date must come after the start date.',
    ar: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية.',
  },
};

const RISK_TEXT: Record<CouponRisk, { en: string; ar: string }> = {
  'no-expiry': { en: 'Never expires', ar: 'بلا تاريخ انتهاء' },
  'no-usage-limit': { en: 'Unlimited uses', ar: 'استخدام غير محدود' },
  'uncapped-percentage': { en: 'Uncapped %', ar: 'نسبة بلا سقف' },
};

const STATE_TEXT: Record<CouponState, { en: string; ar: string }> = {
  live: { en: 'Live', ar: 'فعّال' },
  scheduled: { en: 'Scheduled', ar: 'مجدول' },
  ended: { en: 'Expired', ar: 'منتهٍ' },
  exhausted: { en: 'Used up', ar: 'استُنفد' },
  off: { en: 'Off', ar: 'موقوف' },
};

/** `success` only for a code that can actually be redeemed right now. */
function stateTone(s: CouponState): 'success' | 'neutral' | 'warning' {
  if (s === 'live') return 'success';
  if (s === 'off') return 'neutral';
  return 'warning';
}

export function CouponsPanel({ lang, readOnly }: { lang: 'en' | 'ar'; readOnly: boolean }) {
  const isRTL = lang === 'ar';
  const pick = (t: { en: string; ar: string }) => (isRTL ? t.ar : t.en);

  const [rows, setRows] = useState<Coupon[]>([]);
  const [draft, setDraft] = useState<CouponDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await couponsApi.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const problems = useMemo(() => validateDraft(draft), [draft]);
  const set = <K extends keyof CouponDraft>(k: K, v: CouponDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  /**
   * What the draft would be, if it were saved right now — so the risk badges
   * below the form are the same ones that will appear on the row. Built from
   * the same `couponRisks` the table uses rather than a parallel judgement,
   * because two implementations of "is this unbounded" is how the answer starts
   * to differ between the form and the list.
   */
  const draftStarted = draft.code.trim() !== '';
  const draftRisks = useMemo(
    () =>
      !draftStarted
        ? []
        : couponRisks({
            type: draft.type,
            ends_at: draft.endsAt || null,
            usage_limit: draft.usageLimit.trim() === '' ? null : Number(draft.usageLimit),
            max_discount_amount:
              draft.maxDiscountAmount.trim() === '' ? null : Number(draft.maxDiscountAmount),
          }),
    [draftStarted, draft.type, draft.endsAt, draft.usageLimit, draft.maxDiscountAmount],
  );

  const create = async () => {
    if (problems.length > 0) return;
    setBusy(true);
    try {
      await couponsApi.create(draft);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const now = new Date();
  const liveCount = rows.filter((c) => couponState(c, now) === 'live').length;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-black text-con-text text-xs uppercase">
          <Tag className="size-3.5 text-ember" aria-hidden="true" />
          {isRTL ? 'رموز الخصم' : 'Promo Codes'}
        </span>
        <Button
          variant="ghost"
          onClick={() => void refresh()}
          disabled={busy}
          label={isRTL ? 'تحديث' : 'Refresh'}
          leading={<RefreshCw className="size-3.5" aria-hidden="true" />}
        />
      </div>

      <p className="text-[9.5px] leading-relaxed text-con-text-3 font-bold">
        {isRTL
          ? 'الرمز الفعّال قابل للاستخدام من كل عميل يعرفه، في التطبيق والويب معاً. الإيقاف هو الإجراء المعتاد؛ الحذف يزيل سجل ما كان عليه الرمز.'
          : 'A live code can be redeemed by anyone who knows it, on both the app and the web. Switching off is the normal action — deleting removes the record of what the code was.'}
      </p>

      {error ? (
        <Notice tone="blocking" title={isRTL ? 'تعذّر الحفظ' : 'Could not save'}>
          {error}
        </Notice>
      ) : null}

      {/* The standing count, because "how many codes can be redeemed right now"
          is the question this screen exists to answer at a glance. Rendered
          even at zero: an explicit "none live" is the reassurance that was
          missing when two were. */}
      {loaded ? (
        <Notice tone={liveCount > 0 ? 'warning' : 'info'} title={isRTL ? 'الوضع الحالي' : 'Right now'}>
          {liveCount === 0
            ? isRTL
              ? 'لا يوجد رمز خصم فعّال. لا يمكن لأي عميل تطبيق خصم.'
              : 'No promo code is live. No customer can apply a discount.'
            : isRTL
              ? `${liveCount} رمز فعّال وقابل للاستخدام الآن.`
              : `${liveCount} code${liveCount === 1 ? '' : 's'} can be redeemed right now.`}
        </Notice>
      ) : null}

      {!readOnly ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className={LABEL} htmlFor="cp-code">
                {isRTL ? 'الرمز' : 'Code'}
              </label>
              <input
                id="cp-code"
                className={INPUT}
                value={draft.code}
                /* Upper-cased as the operator types rather than on save: the
                   column CHECK refuses `code <> upper(code)`, and
                   `validate_coupon` upper-cases the customer's input before
                   matching — so a lowercase code would be both a failed insert
                   and, if it somehow existed, unredeemable by anybody. */
                onChange={(e) => set('code', normaliseCode(e.target.value))}
                placeholder="WELCOME10"
                disabled={busy}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-type">
                {isRTL ? 'النوع' : 'Type'}
              </label>
              <select
                id="cp-type"
                className={SELECT}
                value={draft.type}
                onChange={(e) => set('type', e.target.value as Coupon['type'])}
                disabled={busy}
              >
                <option value="percentage">{isRTL ? 'نسبة مئوية' : 'Percentage'}</option>
                <option value="fixed">{isRTL ? 'مبلغ ثابت' : 'Fixed amount'}</option>
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-value">
                {draft.type === 'percentage'
                  ? isRTL
                    ? 'النسبة (١-١٠٠)'
                    : 'Percent (1-100)'
                  : isRTL
                    ? 'المبلغ'
                    : 'Amount'}
              </label>
              <input
                id="cp-value"
                className={`${INPUT} font-ds-num`}
                type="number"
                step="0.01"
                min={0}
                value={draft.value}
                onChange={(e) => set('value', e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-limit">
                {isRTL ? 'حد الاستخدام' : 'Usage limit'}
              </label>
              <input
                id="cp-limit"
                className={`${INPUT} font-ds-num`}
                type="number"
                step="1"
                min={0}
                value={draft.usageLimit}
                onChange={(e) => set('usageLimit', e.target.value)}
                placeholder={isRTL ? 'بلا حد' : 'unlimited'}
                disabled={busy}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-min">
                {isRTL ? 'أقل مبلغ للطلب' : 'Minimum spend'}
              </label>
              <input
                id="cp-min"
                className={`${INPUT} font-ds-num`}
                type="number"
                step="0.01"
                min={0}
                value={draft.minOrderAmount}
                onChange={(e) => set('minOrderAmount', e.target.value)}
                placeholder={isRTL ? 'لا يوجد' : 'none'}
                disabled={busy}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-cap">
                {isRTL ? 'سقف الخصم' : 'Discount cap'}
              </label>
              <input
                id="cp-cap"
                className={`${INPUT} font-ds-num`}
                type="number"
                step="0.01"
                min={0}
                value={draft.maxDiscountAmount}
                onChange={(e) => set('maxDiscountAmount', e.target.value)}
                placeholder={isRTL ? 'بلا سقف' : 'uncapped'}
                disabled={busy || draft.type === 'fixed'}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-start">
                {isRTL ? 'يبدأ (اختياري)' : 'Starts (optional)'}
              </label>
              <input
                id="cp-start"
                className={INPUT}
                type="datetime-local"
                value={draft.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-end">
                {isRTL ? 'ينتهي' : 'Expires'}
              </label>
              <input
                id="cp-end"
                className={INPUT}
                type="datetime-local"
                value={draft.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          {problems.length > 0 && draftStarted ? (
            <Notice tone="blocking" title={isRTL ? 'راجع الحقول' : 'Check the fields'}>
              <ul className="list-disc ps-4 space-y-0.5">
                {problems.map((p) => (
                  <li key={p}>{pick(PROBLEM_TEXT[p])}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {/* THE DRAFT, PRICED. The moment the decision is actually made is
              before Create, not after — so the ways this code would be
              open-ended are stated here, in the same words the row will use. */}
          {draftRisks.length > 0 ? (
            <Notice tone="warning" title={isRTL ? 'هذا الرمز غير محدود' : 'This code is unbounded'}>
              <ul className="list-disc ps-4 space-y-0.5">
                {draftRisks.map((r) => (
                  <li key={r}>{pick(RISK_TEXT[r])}</li>
                ))}
              </ul>
              <p className="mt-1">
                {isRTL
                  ? 'يمكن إنشاؤه هكذا، لكن هذا هو الشكل الذي أدّى إلى وجود رمزين مفتوحين في الإنتاج دون أن يلاحظهما أحد.'
                  : 'You can still create it — but this is the exact shape that left two open-ended codes live in Production unnoticed.'}
              </p>
            </Notice>
          ) : null}

          <Button
            onClick={() => void create()}
            disabled={busy || problems.length > 0}
            label={isRTL ? 'إنشاء رمز' : 'Create code'}
          />
        </div>
      ) : null}

      {loaded && rows.length === 0 ? (
        <Text variant="caption" tone="tertiary" as="p">
          {isRTL ? 'لا توجد رموز خصم.' : 'No promo codes exist.'}
        </Text>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <tbody>
              {rows.map((c) => {
                const state = couponState(c, now);
                const risks = couponRisks(c);
                const used = c.usage_count > 0;
                return (
                  <tr key={c.id} className="border-t border-con-line">
                    <td className={TD}>
                      <Text variant="body" as="span" className="font-ds-num">
                        {c.code}
                      </Text>
                    </td>
                    <td className={TD}>
                      {c.type === 'percentage' ? (
                        <Text variant="body" numeric as="span">
                          {c.value}%
                        </Text>
                      ) : (
                        <Text variant="body" as="span">
                          <Price amount={c.value} lang={lang} />
                        </Text>
                      )}
                    </td>
                    <td className={TD}>
                      <Text variant="caption" tone="secondary" as="span">
                        {(c.starts_at ?? '—').slice(0, 10)} → {(c.ends_at ?? '—').slice(0, 10)}
                      </Text>
                    </td>
                    <td className={TD}>
                      <Text variant="caption" tone="secondary" numeric as="span">
                        {c.usage_count}
                        {c.usage_limit === null ? ' / ∞' : ` / ${c.usage_limit}`}
                      </Text>
                    </td>
                    {/* Unboundedness, rendered rather than left as empty cells.
                        An empty "expires" column reads as missing data; a badge
                        reads as a decision somebody made. */}
                    <td className={TD}>
                      {risks.length > 0 ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <AlertTriangle className="size-3 text-amber-ink" aria-hidden="true" />
                          {risks.map((r) => (
                            <StatusPill key={r} label={pick(RISK_TEXT[r])} tone="warning" />
                          ))}
                        </span>
                      ) : (
                        <Text variant="caption" tone="tertiary" as="span">
                          {isRTL ? 'محدود' : 'Bounded'}
                        </Text>
                      )}
                    </td>
                    <td className={TD}>
                      <StatusPill label={pick(STATE_TEXT[state])} tone={stateTone(state)} />
                    </td>
                    <td className={TD}>
                      {!readOnly ? (
                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            disabled={busy}
                            label={c.is_active ? (isRTL ? 'إيقاف' : 'Stop') : isRTL ? 'تفعيل' : 'Start'}
                            onClick={() => void act(() => couponsApi.setActive(c.id, !c.is_active))}
                          />
                          {/* Absent, not merely disabled, once a code has been
                              redeemed: orders record `coupon_code` as text with
                              no foreign key, so deleting a used code leaves a
                              discounted order whose discount cannot be
                              explained. `couponsApi.remove` refuses it too, so
                              the rule survives a future caller. */}
                          {!used ? (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              label={isRTL ? 'حذف' : 'Delete'}
                              leading={<Trash2 className="size-3.5 text-danger-ds" aria-hidden="true" />}
                              onClick={() => {
                                if (
                                  confirm(
                                    isRTL
                                      ? `حذف الرمز ${c.code}؟ لم يُستخدم بعد.`
                                      : `Delete ${c.code}? It has never been redeemed.`,
                                  )
                                ) {
                                  void act(() => couponsApi.remove(c));
                                }
                              }}
                            />
                          ) : (
                            <Text variant="caption" tone="tertiary" as="span">
                              {isRTL ? 'مستخدَم' : 'Redeemed'}
                            </Text>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
