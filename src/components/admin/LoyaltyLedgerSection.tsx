/**
 * Settings → Loyalty: the programme totals and the customer ledger.
 *
 * Self-loading, and mounted only while the Loyalty sub-tab is open. Both halves
 * used to read `profiles` from AppContext, which downloaded EVERY profile on
 * every staff sign-in, `select('*')`, to sum four tiles in the browser. Past
 * PostgREST's 1 000-row cap those sums were silently wrong.
 *
 *   - the tiles read `admin_loyalty_stats()`, one constant-size figure each;
 *   - the ledger reads customers 50 at a time, ordered by name and then id, so
 *     "Show more" neither repeats nor skips a row between pages.
 *
 * The two load independently. A project where the stats migration is not
 * applied yet shows "—" in the tiles and a notice saying why, and the ledger
 * still works; neither half can blank the other or the Settings page.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Price } from '../Price';
import { ADMIN_LOCALES } from './adminLocales';
import {
  LOYALTY_LEDGER_PAGE_SIZE,
  loyalty as loyaltyApi,
  profiles as profilesApi,
  type AdminLoyaltyStats,
} from '../../lib/api';
import {
  classifyLoyaltyStatsError,
  formatCount,
  loyaltyTiles,
  type LoyaltyStatsError,
} from '../../lib/loyaltyStats';
import { mapProfile } from '../../lib/mappers';
import type { UserProfile } from '../../types';

export interface LoyaltyLedgerSectionProps {
  adminLang: 'en' | 'ar';
  /** The configured value of one point; the screen's long-standing 0.1 when unset. */
  discountPerPoint: number | undefined;
  /** Accountants read; only admins adjust. */
  isAccountant: boolean;
  /** Adjustments switched off for this build or this role. */
  pointsLocked: boolean;
  loyaltyMutationsEnabled: boolean;
}

const DASH = '—';

export const LoyaltyLedgerSection: React.FC<LoyaltyLedgerSectionProps> = ({
  adminLang,
  discountPerPoint,
  isAccountant,
  pointsLocked,
  loyaltyMutationsEnabled,
}) => {
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const rate = discountPerPoint || 0.1;

  const [stats, setStats] = useState<AdminLoyaltyStats | null>(null);
  const [statsError, setStatsError] = useState<LoyaltyStatsError | null>(null);

  const [rows, setRows] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  /** Where the next page starts: rows read so far, before de-duplication. */
  const [nextFrom, setNextFrom] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pointAdjustments, setPointAdjustments] = useState<{ [profileId: string]: string }>({});
  const alive = useRef(true);

  const loadStats = useCallback(async () => {
    try {
      const s = await loyaltyApi.stats();
      if (alive.current) {
        setStats(s);
        setStatsError(null);
      }
    } catch (e) {
      if (alive.current) {
        setStats(null);
        setStatsError(classifyLoyaltyStatsError(e));
      }
    }
  }, []);

  const loadPage = useCallback(async (from: number) => {
    setLedgerLoading(true);
    setLedgerError(null);
    try {
      const page = await profilesApi.loyaltyLedgerPage(from, LOYALTY_LEDGER_PAGE_SIZE);
      if (!alive.current) return;
      const mapped = page.rows.map(mapProfile);
      // Appended by id, so a row that moved pages between two reads (a rename)
      // appears once rather than twice.
      setRows((prev) => {
        const base = from === 0 ? [] : prev;
        const seen = new Set(base.map((r) => r.id));
        return [...base, ...mapped.filter((r) => !seen.has(r.id))];
      });
      setTotal(page.total);
      setNextFrom(from + page.rows.length);
    } catch (e) {
      if (alive.current) setLedgerError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLedgerLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void loadStats();
    void loadPage(0);
    return () => {
      alive.current = false;
    };
  }, [loadStats, loadPage]);

  /** Move one customer to `target` points through the admin-only RPC, then re-read the totals. */
  const setPoints = (customer: UserProfile, target: number) => {
    const current = customer.loyaltyPoints || 0;
    const delta = Math.round(target - current);
    if (delta === 0 || busyId) return;
    setBusyId(customer.id);
    setAdjustError(null);
    void (async () => {
      try {
        const updated = mapProfile(await loyaltyApi.adjustPoints(customer.id, delta));
        if (!alive.current) return;
        setRows((prev) => prev.map((r) => (r.id === customer.id ? updated : r)));
        void loadStats();
      } catch (e) {
        if (alive.current)
          setAdjustError(`${t.loyalty_adjust_failed}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (alive.current) setBusyId(null);
      }
    })();
  };

  const tiles = loyaltyTiles(stats, discountPerPoint);
  const hasMore = total !== null && nextFrom < total;

  return (
    <div className="p-4 bg-con-surface-2 border border-con-line rounded-2xl space-y-3">
      <span className="font-extrabold text-ember text-[10px] block border-b border-con-line pb-1">
        {isRTL
          ? 'مؤشرات أداء العملاء ونقاط الولاء (Loyalty Statistics)'
          : 'Corporate Customer Loyalty Metrics (Real-time Live Audit)'}
      </span>

      {statsError && (
        <p
          role="status"
          data-testid="loyalty-stats-unavailable"
          className="text-[9.5px] text-con-text-2 font-bold bg-con-surface border border-con-line rounded-lg p-2"
        >
          {statsError.kind === 'missing-migration'
            ? t.loyalty_stats_missing_migration
            : t.loyalty_stats_unavailable}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-con-surface p-3 rounded-xl border border-con-line">
          <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">
            {isRTL ? 'إجمالي الأعضاء المسجلين' : 'Active Loyalty Members'}
          </span>
          <p className="text-sm font-black text-con-text mt-1" data-testid="loyalty-tile-members">
            {tiles.members === null ? DASH : formatCount(tiles.members)} {isRTL ? 'عميل' : 'Users'}
          </p>
          <span className="text-[8px] text-mint font-bold block mt-0.5">● Live Database</span>
        </div>

        <div className="bg-con-surface p-3 rounded-xl border border-con-line">
          <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">
            {isRTL ? 'إجمالي النقاط المجمعة' : 'Accumulated Point Balances'}
          </span>
          <p className="text-sm font-black text-con-text mt-1" data-testid="loyalty-tile-points">
            {tiles.points === null ? DASH : formatCount(tiles.points)} {isRTL ? 'نقطة' : 'Points'}
          </p>
          <span className="text-[8px] text-con-text-3 block mt-0.5">
            {isRTL ? 'رصيد مستحق للعملاء' : 'Active liability points'}
          </span>
        </div>

        <div className="bg-con-surface p-3 rounded-xl border border-con-line">
          <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">
            {isRTL ? 'إجمالي قيمة خصومات النقاط' : 'Deducted Points Discount Value'}
          </span>
          <p className="text-sm font-black text-ember mt-1" data-testid="loyalty-tile-value">
            {tiles.value === null ? DASH : <Price amount={tiles.value} lang={adminLang} />}
          </p>
          <span className="text-[8px] text-con-text-3 block mt-0.5">
            {isRTL ? 'مستقطعة من قيمة الفواتير المكتملة' : 'Calculated at active conversions'}
          </span>
        </div>

        <div className="bg-con-surface p-3 rounded-xl border border-con-line">
          <span className="text-[8.5px] font-bold text-con-text-3 uppercase block">
            {isRTL ? 'متوسط قيمة الاسترداد لكل عميل' : 'Average Cashback per User'}
          </span>
          <p className="text-sm font-black text-mint mt-1" data-testid="loyalty-tile-average">
            {tiles.averageValue === null ? DASH : <Price amount={tiles.averageValue} lang={adminLang} />}
          </p>
          <span className="text-[8px] text-con-text-3 block mt-0.5">
            {isRTL ? 'قيمة مضافة للمشتريات' : 'Avg customer wallet balance'}
          </span>
        </div>
      </div>

      {/* CUSTOMER LOYALTY LEDGER & POINT ADJUSTMENTS */}
      <div className="space-y-3 pt-3.5 border-t border-con-line">
        <span className="font-extrabold text-con-text text-[10px] block uppercase tracking-wider">
          {isRTL
            ? 'سجل أرصدة نقاط ولاء العملاء (Customer Loyalty Ledger)'
            : 'Customer Loyalty Ledger & Point Adjustments'}
        </span>
        {!loyaltyMutationsEnabled && (
          <p className="text-[9px] text-con-text-2 font-bold bg-con-surface-2 border border-con-line rounded-lg p-2">
            {isRTL
              ? 'أرصدة النقاط للعرض فقط في هذه النسخة — لا يوجد إجراء خلفي لتعديل النقاط بعد.'
              : 'Point balances are read-only in this build — there is no backend routine to adjust loyalty points yet.'}
          </p>
        )}
        {adjustError && (
          <p
            role="alert"
            className="text-[9.5px] text-danger-ds font-bold bg-danger-tint border border-danger-line rounded-lg p-2"
          >
            {adjustError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2.5" data-testid="loyalty-ledger">
          {rows.map((customer) => {
            const currentPoints = customer.loyaltyPoints || 0;
            const currentValue = currentPoints * rate;
            const tier =
              currentPoints >= 300
                ? isRTL
                  ? '👑 ذهبي'
                  : '👑 Gold'
                : currentPoints >= 100
                  ? isRTL
                    ? '✨ فضي'
                    : '✨ Silver'
                  : isRTL
                    ? '🥉 برونزي'
                    : '🥉 Bronze';
            const adjustmentValue = pointAdjustments[customer.id] || '';
            const busy = busyId === customer.id;

            const handleAddPoints = () => {
              const val = parseInt(adjustmentValue) || 0;
              if (val > 0) {
                setPoints(customer, currentPoints + val);
                setPointAdjustments((prev) => ({ ...prev, [customer.id]: '' }));
              }
            };
            const handleDeductPoints = () => {
              const val = parseInt(adjustmentValue) || 0;
              if (val > 0) {
                setPoints(customer, currentPoints - val);
                setPointAdjustments((prev) => ({ ...prev, [customer.id]: '' }));
              }
            };

            return (
              <div
                key={customer.id}
                className="bg-con-surface border border-con-line p-3.5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-con-line transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-info-tint flex items-center justify-center font-black text-xs text-ember border border-info-line">
                    {customer.fullName
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-black text-con-text">{customer.fullName}</h4>
                      <span className="text-[8px] font-black bg-info-tint text-ember px-1.5 py-0.5 rounded-md uppercase">
                        {tier}
                      </span>
                    </div>
                    <p className="text-[10px] text-con-text-3 font-medium">
                      {customer.phoneNumber} • {customer.email}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-con-surface-2 px-3 py-2 rounded-xl border border-info-line self-start md:self-auto min-w-[130px]">
                  <div>
                    <span className="text-[8px] font-bold text-con-text-3 uppercase block">
                      {isRTL ? 'النقاط المتوفرة' : 'Point Balance'}
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-black text-ember">{currentPoints}</span>
                      <span className="text-[8px] text-con-text-3 font-bold">{isRTL ? 'نقب' : 'pts'}</span>
                    </div>
                    <span className="text-[8px] text-con-text-3 font-medium block mt-0.5">
                      (= <Price amount={currentValue} lang={adminLang} />)
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Pts"
                      value={adjustmentValue}
                      onChange={(e) =>
                        setPointAdjustments((prev) => ({ ...prev, [customer.id]: e.target.value }))
                      }
                      className="ds-motion min-h-9 w-16 rounded-[var(--radius-ds-sm)] border border-con-line bg-con-surface px-1.5 text-center font-ds-num text-[13px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
                      disabled={isAccountant}
                    />
                    <button
                      onClick={handleAddPoints}
                      disabled={pointsLocked || busy || !adjustmentValue}
                      className="bg-mint-tint hover:bg-mint-tint text-on-ember text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                    >
                      +{isRTL ? 'إضافة' : 'Add'}
                    </button>
                    <button
                      onClick={handleDeductPoints}
                      disabled={pointsLocked || busy || !adjustmentValue || currentPoints <= 0}
                      className="bg-danger-tint hover:bg-danger-tint text-on-ember text-[9px] font-black px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                    >
                      -{isRTL ? 'خصم' : 'Deduct'}
                    </button>
                  </div>
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => setPoints(customer, currentPoints + 50)}
                      disabled={pointsLocked || busy}
                      className="text-[8px] bg-con-surface-2 hover:bg-con-surface-2 text-con-text-2 px-1.5 py-0.5 rounded font-extrabold"
                    >
                      +50
                    </button>
                    <button
                      onClick={() => setPoints(customer, Math.max(0, currentPoints - 50))}
                      disabled={pointsLocked || busy || currentPoints < 50}
                      className="text-[8px] bg-con-surface-2 hover:bg-con-surface-2 text-con-text-2 px-1.5 py-0.5 rounded font-extrabold disabled:opacity-40"
                    >
                      -50
                    </button>
                    <button
                      onClick={() => setPoints(customer, currentPoints + 100)}
                      disabled={pointsLocked || busy}
                      className="text-[8px] bg-con-surface-2 hover:bg-con-surface-2 text-con-text-2 px-1.5 py-0.5 rounded font-extrabold"
                    >
                      +100
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {ledgerError && (
          <p
            role="alert"
            className="text-[9.5px] text-danger-ds font-bold bg-danger-tint border border-danger-line rounded-lg p-2"
          >
            {t.loyalty_ledger_failed} {ledgerError}
          </p>
        )}
        {ledgerLoading && (
          <p className="text-[9.5px] text-con-text-3 font-bold">{t.loyalty_ledger_loading}</p>
        )}
        {!ledgerLoading && !ledgerError && rows.length === 0 && (
          <p className="text-[9.5px] text-con-text-3 font-bold" data-testid="loyalty-ledger-empty">
            {t.loyalty_ledger_empty}
          </p>
        )}

        {rows.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-con-text-3 font-bold" data-testid="loyalty-ledger-count">
              {t.loyalty_ledger_shown} {formatCount(rows.length)}
              {total !== null ? ` ${t.loyalty_ledger_of} ${formatCount(total)}` : ''}
            </span>
            {hasMore && (
              <button
                type="button"
                onClick={() => void loadPage(nextFrom)}
                disabled={ledgerLoading}
                className="text-[9px] bg-con-surface hover:bg-con-surface-2 border border-con-line text-con-text-2 px-2.5 py-1.5 rounded-lg font-extrabold disabled:opacity-40"
              >
                {t.loyalty_ledger_more}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
