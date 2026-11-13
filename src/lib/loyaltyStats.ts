/**
 * The Settings → Loyalty tiles, computed from `admin_loyalty_stats()`.
 *
 * WHY THE TILES MOVED SERVER-SIDE. They used to be summed in the browser over
 * the profile list every staff sign-in downloaded. PostgREST caps a response at
 * 1 000 rows, so past that the tiles were silently wrong: measured at 5 000
 * customers, 196 136 points shown against 1 000 079 held.
 *
 * NULL MEANS UNKNOWN, and the screen shows "—" for it. The console deploys on
 * merge, and the migration that adds the function is a separate owner action,
 * so for a while the call can fail with PGRST202. A tile that falls back to 0
 * there would state a wrong figure; a tile that says nothing states none.
 */
import { isMissingFunctionError, type AdminLoyaltyStats } from './api';

export interface LoyaltyTiles {
  /** Customers (`role = 'customer'`). */
  members: number | null;
  /** Points those customers hold. */
  points: number | null;
  /** What those points are worth at the current discount per point. */
  value: number | null;
  /** `value` per customer; 0 when there are no customers. */
  averageValue: number | null;
}

/** The same fallback the screen has always used when no rate is configured. */
const DEFAULT_DISCOUNT_PER_POINT = 0.1;

function finite(n: unknown): number | null {
  const v = typeof n === 'string' ? Number(n) : n;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function loyaltyTiles(
  stats: AdminLoyaltyStats | null,
  discountPerPoint: number | undefined,
): LoyaltyTiles {
  const members = finite(stats?.member_count);
  const points = finite(stats?.points_total);
  if (members === null || points === null) {
    return { members: null, points: null, value: null, averageValue: null };
  }
  const rate = discountPerPoint || DEFAULT_DISCOUNT_PER_POINT;
  const value = points * rate;
  return { members, points, value, averageValue: members > 0 ? value / members : 0 };
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * A count or a points total for the console: grouped, Western digits, the same
 * in every browser. Not `toLocaleString()`, whose digits follow the browser's
 * locale (adminTime.test.ts guards against it in console code).
 */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

export type LoyaltyStatsError = { kind: 'missing-migration' } | { kind: 'other'; message: string };

/** A missing function is an unapplied migration, which reads differently from a broken one. */
export function classifyLoyaltyStatsError(e: unknown): LoyaltyStatsError {
  return isMissingFunctionError(e)
    ? { kind: 'missing-migration' }
    : { kind: 'other', message: e instanceof Error ? e.message : String(e) };
}
