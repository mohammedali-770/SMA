/**
 * Points-earning campaigns — "double points this weekend", "+50% on burgers".
 *
 * WHAT A CAMPAIGN IS, AND IS NOT. It multiplies what an order EARNS. It never
 * changes what an order COSTS, and it cannot reduce earning: the column CHECK
 * refuses anything outside 1..10, so a slipped decimal is a rejected insert
 * rather than a very expensive weekend. Money off is a different feature
 * (`campaigns`), with different constraints and its own open questions.
 *
 * WHY THIS SCREEN IS CALMER THAN CompMembersPanel. A comp has no cap, so that
 * panel makes every change traceable. A multiplier is bounded by construction
 * and touches no price, so the risk here is over-rewarding within a ceiling —
 * real, but not unbounded. The controls are correspondingly ordinary.
 *
 * DEACTIVATE rather than delete is the primary action, and it is first for that
 * reason: a stopped campaign that stays visible next to the orders it affected
 * is worth more than a tidy list.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Percent, RefreshCw, Trash2 } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { loyaltyCampaigns, type LoyaltyCampaign } from '../../lib/loyaltyCampaignsApi';

const INPUT = [
  'ds-motion min-h-10 w-full rounded-[var(--radius-ds-md)] border border-con-line',
  'bg-con-surface px-3 text-[14px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
].join(' ');
const LABEL = 'block text-[9px] font-black text-con-text-3 uppercase mb-1';
const TD = 'px-3 py-2 align-middle';

/** Live now, scheduled, finished, or switched off — decided in one place. */
export function campaignState(
  c: Pick<LoyaltyCampaign, 'is_active' | 'starts_at' | 'ends_at'>,
  now: Date,
): 'off' | 'scheduled' | 'live' | 'ended' {
  if (!c.is_active) return 'off';
  if (c.starts_at && new Date(c.starts_at) > now) return 'scheduled';
  if (c.ends_at && new Date(c.ends_at) < now) return 'ended';
  return 'live';
}

export function LoyaltyCampaignsPanel({ isRTL, readOnly }: { isRTL: boolean; readOnly: boolean }) {
  const [rows, setRows] = useState<LoyaltyCampaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [multiplier, setMultiplier] = useState('2');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const refresh = useCallback(async () => {
    try {
      setRows(await loyaltyCampaigns.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    const m = Number(multiplier);
    // Checked here so the operator gets a sentence rather than a Postgres
    // constraint name; the database refuses it regardless, which is what makes
    // this a convenience and not the guard.
    if (!Number.isFinite(m) || m < 1 || m > 10) {
      setError(isRTL ? 'المضاعف يجب أن يكون بين ١ و١٠.' : 'The multiplier must be between 1 and 10.');
      return;
    }
    if (!nameEn.trim() || !nameAr.trim()) {
      setError(isRTL ? 'الاسم مطلوب باللغتين.' : 'A name is required in both languages.');
      return;
    }
    setBusy(true);
    try {
      await loyaltyCampaigns.create({
        name_en: nameEn, name_ar: nameAr, multiplier: m,
        starts_at: startsAt || null, ends_at: endsAt || null,
      });
      setNameEn(''); setNameAr(''); setMultiplier('2'); setStartsAt(''); setEndsAt('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const now = new Date();

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-black text-con-text text-xs uppercase">
          <Percent className="size-3.5 text-ember" aria-hidden="true" />
          {isRTL ? 'حملات النقاط' : 'Points Campaigns'}
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
          ? 'تضاعف الحملة النقاط المكتسبة فقط — لا تغيّر السعر ولا تقلّل النقاط أبداً. الأصناف المستثناة من النقاط تبقى مستثناة.'
          : 'A campaign multiplies POINTS EARNED only. It never changes the price, and it can never reduce points. Items excluded from earning stay excluded.'}
      </p>

      {error ? (
        <Notice tone="blocking" title={isRTL ? 'تعذّر الحفظ' : 'Could not save'}>{error}</Notice>
      ) : null}

      {!readOnly ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className={LABEL} htmlFor="lc-en">{isRTL ? 'الاسم (EN)' : 'Name (EN)'}</label>
            <input id="lc-en" className={INPUT} value={nameEn} onChange={(e) => setNameEn(e.target.value)}
              placeholder="Double points weekend" disabled={busy} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lc-ar">{isRTL ? 'الاسم (AR)' : 'Name (AR)'}</label>
            <input id="lc-ar" className={INPUT} value={nameAr} onChange={(e) => setNameAr(e.target.value)}
              placeholder="نقاط مضاعفة" disabled={busy} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lc-m">{isRTL ? 'المضاعف (١-١٠)' : 'Multiplier (1-10)'}</label>
            <input id="lc-m" className={`${INPUT} font-ds-num`} type="number" step="0.25" min={1} max={10}
              value={multiplier} onChange={(e) => setMultiplier(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lc-s">{isRTL ? 'يبدأ (اختياري)' : 'Starts (optional)'}</label>
            <input id="lc-s" className={INPUT} type="datetime-local"
              value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lc-e">{isRTL ? 'ينتهي (اختياري)' : 'Ends (optional)'}</label>
            <input id="lc-e" className={INPUT} type="datetime-local"
              value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={busy} />
          </div>
          <div className="md:col-span-5">
            <Button
              onClick={() => void create()}
              disabled={busy}
              label={isRTL ? 'إنشاء حملة' : 'Create campaign'}
            />
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Text variant="caption" tone="tertiary" as="p">
          {isRTL ? 'لا توجد حملات. النقاط تُحتسب بالمعدل العادي.' : 'No campaigns. Points accrue at the normal rate.'}
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <tbody>
              {rows.map((c) => {
                const state = campaignState(c, now);
                return (
                  <tr key={c.id} className="border-t border-con-line">
                    <td className={TD}>
                      <Text variant="body" as="span">{isRTL ? c.name_ar : c.name_en}</Text>
                    </td>
                    <td className={TD}>
                      <Text variant="body" numeric as="span">×{c.multiplier}</Text>
                    </td>
                    <td className={TD}>
                      <Text variant="caption" tone="secondary" as="span">
                        {(c.starts_at ?? '—').slice(0, 10)} → {(c.ends_at ?? '—').slice(0, 10)}
                      </Text>
                    </td>
                    <td className={TD}>
                      <StatusPill
                        label={state === 'live' ? (isRTL ? 'فعّالة' : 'Live')
                          : state === 'scheduled' ? (isRTL ? 'مجدولة' : 'Scheduled')
                          : state === 'ended' ? (isRTL ? 'منتهية' : 'Ended')
                          : (isRTL ? 'موقوفة' : 'Off')}
                        tone={state === 'live' ? 'success' : state === 'off' ? 'neutral' : 'warning'}
                      />
                    </td>
                    <td className={TD}>
                      {!readOnly ? (
                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            disabled={busy}
                            label={c.is_active ? (isRTL ? 'إيقاف' : 'Stop') : (isRTL ? 'تفعيل' : 'Start')}
                            onClick={() => void act(() => loyaltyCampaigns.setActive(c.id, !c.is_active))}
                          />
                          {/* A visible word rather than a bare icon: this row is
                              destructive and an icon alone leaves a screen-reader
                              user guessing which control they landed on. */}
                          <Button
                            variant="ghost"
                            disabled={busy}
                            label={isRTL ? 'حذف' : 'Delete'}
                            leading={<Trash2 className="size-3.5 text-danger-ds" aria-hidden="true" />}
                            onClick={() => {
                              if (confirm(isRTL ? 'حذف الحملة؟' : 'Delete this campaign?')) {
                                void act(() => loyaltyCampaigns.remove(c.id));
                              }
                            }}
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
