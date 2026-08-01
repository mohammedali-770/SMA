/**
 * Branch sales — derivation, ranking and scoping. FRAMEWORK-FREE.
 *
 * The panel used to compute a branch's total inline, inside the map that drew
 * its bar, and recompute the maximum across every branch on every iteration.
 * The arithmetic here is that same arithmetic, lifted out unchanged so the
 * ranking rules can be tested without rendering anything:
 *
 *   sales       = sum of `total` over the branch's orders   (ALL statuses,
 *                 exactly as the chart has always summed them — this is not
 *                 the delivered-only figure the revenue KPI shows, and the two
 *                 were never the same number)
 *   orderCount  = how many of those orders there are
 *
 * `averageTicket` is new to the DISPLAY but not a new rule: it divides the same
 * way the console's headline average ticket does (sum of totals over count of
 * orders, two decimals), applied to one branch instead of all of them.
 *
 * Nothing here filters by date. The panel has no period control, so a branch's
 * "sales" is every order the console currently holds for it — which is why the
 * empty-state copy says a branch has no sales rather than naming a period that
 * does not exist.
 */
import type { Branch, Order } from '../../../../types';

/**
 * Operational state, read from the flags the branch model already carries.
 *
 * These are exactly the two booleans `BranchCard` toggles — `isActive` is the
 * open/closed switch, `deliveryTemporarilyClosed` is the temporary delivery
 * pause. No new availability rule is introduced here; this only names the
 * combinations that already exist.
 */
export type BranchStatus = 'open' | 'temporarily_unavailable' | 'closed';

export interface BranchSalesRow {
  id: string;
  nameEn: string;
  nameAr: string;
  sales: number;
  orderCount: number;
  averageTicket: number;
  status: BranchStatus;
  /** The flag the "Operational Branches" KPI counts. Kept for that KPI's sake. */
  isActive: boolean;
}

export function branchStatusOf(branch: Pick<Branch, 'isActive' | 'deliveryTemporarilyClosed'>): BranchStatus {
  if (!branch.isActive) return 'closed';
  return branch.deliveryTemporarilyClosed ? 'temporarily_unavailable' : 'open';
}

/** Two decimals, matching the console's existing average-ticket rounding. */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * One row per branch, ranked highest sales first.
 *
 * Ties break on the English name so the order is STABLE: a chart whose bars
 * reshuffle between renders because two branches both sold nothing is the kind
 * of motion that reads as live data when it is really just sort instability.
 */
export function buildBranchSalesRows(branches: Branch[], orders: Order[]): BranchSalesRow[] {
  const totals = new Map<string, { sales: number; orderCount: number }>();
  for (const order of orders) {
    const bucket = totals.get(order.branchId) ?? { sales: 0, orderCount: 0 };
    bucket.sales += order.total;
    bucket.orderCount += 1;
    totals.set(order.branchId, bucket);
  }

  return branches
    .map((branch) => {
      const { sales, orderCount } = totals.get(branch.id) ?? { sales: 0, orderCount: 0 };
      return {
        id: branch.id,
        nameEn: branch.nameEn,
        nameAr: branch.nameAr,
        sales,
        orderCount,
        averageTicket: orderCount > 0 ? round2(sales / orderCount) : 0,
        status: branchStatusOf(branch),
        isActive: branch.isActive,
      };
    })
    .sort((a, b) => (b.sales - a.sales) || a.nameEn.localeCompare(b.nameEn));
}

/** How much of the ranked list to show. */
export type BranchScope = 'top5' | 'top8' | 'active';

export const DEFAULT_BRANCH_SCOPE: BranchScope = 'top8';

const SCOPE_LIMIT: Record<BranchScope, number | null> = {
  top5: 5,
  top8: 8,
  active: null,
};

/**
 * Case-insensitive match on BOTH names regardless of the active language, so
 * an operator running the console in English can still find a branch by typing
 * its Arabic name, and vice versa.
 */
export function filterBranchRows(rows: BranchSalesRow[], query: string): BranchSalesRow[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return rows;
  return rows.filter(
    (row) => row.nameEn.toLowerCase().includes(q) || row.nameAr.toLowerCase().includes(q),
  );
}

/**
 * The branches a scope admits, before any Top-N cap: the active filter and the
 * search, and nothing else.
 *
 * The search is applied HERE rather than after the cap, deliberately. Capping
 * first would mean searching for a branch ranked 12th while "Top 8" is
 * selected returns nothing — the operator typed a real branch name and the
 * console told them it does not exist.
 */
export function scopeBranchRows(
  rows: BranchSalesRow[],
  scope: BranchScope,
  query = '',
): BranchSalesRow[] {
  const pool = scope === 'active' ? rows.filter((row) => row.isActive) : rows;
  return filterBranchRows(pool, query);
}

/** Split off the branches that sold nothing. */
export function splitZeroSales(rows: BranchSalesRow[]): {
  withSales: BranchSalesRow[];
  zeroSales: BranchSalesRow[];
} {
  return {
    withSales: rows.filter((row) => row.sales > 0),
    zeroSales: rows.filter((row) => row.sales === 0),
  };
}

export interface BranchSalesView {
  /** The branches that get a bar: traded, ranked, capped by the scope. */
  bars: BranchSalesRow[];
  /** Every branch in scope that sold nothing. Summarised, never drawn. */
  zeroSales: BranchSalesRow[];
}

/**
 * What the chart shows for a scope.
 *
 * The Top-N cap applies to the BARS, not to the scope as a whole. Capping the
 * pool first and splitting afterwards looks equivalent and is not: with three
 * trading branches and twenty idle ones, "Top 8" would take three bars plus
 * five arbitrary zero-sales rows and then report "5 branches have no sales"
 * — understating it by fifteen. The count of idle branches is a fact about the
 * estate, so it is never truncated by how many bars the operator asked to see.
 *
 * They stay in the caller's `rows` and in every KPI regardless. This decides
 * what gets DRAWN, and drawing a stub for each idle branch is what turned the
 * old chart into a picket fence in which the branches that actually traded
 * were the minority of the ink.
 */
export function selectBranchView(
  rows: BranchSalesRow[],
  scope: BranchScope,
  query = '',
): BranchSalesView {
  const { withSales, zeroSales } = splitZeroSales(scopeBranchRows(rows, scope, query));
  const limit = SCOPE_LIMIT[scope];
  return {
    bars: limit === null ? withSales : withSales.slice(0, limit),
    zeroSales,
  };
}

/** The scale a bar is drawn against. Never zero, so no division by zero. */
export function maxSales(rows: BranchSalesRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sales), 0) || 1;
}

/**
 * Bar length as a percentage of the largest bar.
 *
 * Floored at 2% so a branch with a real but tiny total is still visible as a
 * mark. Zero-sales branches never reach here — they are summarised instead —
 * so the floor cannot manufacture a bar for a branch that sold nothing.
 */
export function barPercent(sales: number, max: number): number {
  if (sales <= 0) return 0;
  return Math.max(2, Math.min(100, (sales / max) * 100));
}

export interface StatusBreakdown {
  open: BranchSalesRow[];
  temporarily_unavailable: BranchSalesRow[];
  closed: BranchSalesRow[];
}

/** Branches bucketed by operational state, each bucket ranked as it came in. */
export function groupByStatus(rows: BranchSalesRow[]): StatusBreakdown {
  return {
    open: rows.filter((row) => row.status === 'open'),
    temporarily_unavailable: rows.filter((row) => row.status === 'temporarily_unavailable'),
    closed: rows.filter((row) => row.status === 'closed'),
  };
}
