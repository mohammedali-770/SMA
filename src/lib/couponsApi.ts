/**
 * Promo codes — the console's side of `public.coupons`.
 *
 * WHY THIS MODULE EXISTS AT ALL. Until 2026-09-10 `coupons` had no admin
 * surface of any kind. Two codes sat in Production, both active, both with no
 * expiry, no usage ceiling, no minimum spend and no discount cap, reachable
 * from an unconditional "Promo code" field on every checkout — and switching
 * them off took a direct database write. That is `docs/GO_LIVE_READINESS.md`
 * G8 and `docs/OWNER_ACTIONS.md` §36. The screen this module feeds exists so
 * that never has to be a database write again, and so the shape of a code is
 * visible before it is live rather than after.
 *
 * WHY ORDINARY TABLE WRITES RATHER THAN AN RPC. `coupons_admin_all` is an
 * `ALL` policy for `authenticated` with `is_admin()` on both `USING` and
 * `WITH CHECK`, so role AND AAL2 already gate every read and write at the
 * policy level. A SECURITY DEFINER wrapper would move that gate without
 * tightening it — the same reasoning `loyaltyCampaignsApi` records.
 *
 * WHAT THE DATABASE ENFORCES, AND WHAT IT DOES NOT. Read this before trusting
 * any guard below, because the split is not intuitive:
 *
 *   ENFORCED  `code = upper(code)` and length 3..32; `code` UNIQUE;
 *             `value >= 0`; `min_order_amount >= 0`; `usage_limit` null or
 *             `>= 0`; `max_discount_amount` null or `>= 0`.
 *   NOT       Any upper bound on `value`. A `percentage` coupon of 500 is a
 *             legal row. `validate_coupon` clamps the discount to the subtotal,
 *             so it would not produce a negative total — it would simply make
 *             every order free. Contrast `loyalty_multipliers`, whose
 *             `between 1 and 10` CHECK makes a slipped decimal a rejected
 *             insert. Here the ceiling is `validateDraft` and nothing else, so
 *             it is a CONVENIENCE THAT IS ALSO THE ONLY GUARD. If that ever
 *             needs to be real, it belongs in a migration, not here.
 *
 * REDEMPTION IS SERVER-SIDE AND UNCHANGED. `validate_coupon(code, subtotal)`
 * decides everything; `place_order` calls it with its own subtotal and
 * increments `usage_count`. Nothing in this module or its panel participates in
 * pricing — they describe and edit a row, which is why no money-path function
 * changes alongside them.
 */
import { supabase } from './supabase';

export type CouponType = 'percentage' | 'fixed';

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  /** Percent when `type` is 'percentage', else an absolute amount. */
  value: number;
  is_active: boolean;
  min_order_amount: number;
  max_discount_amount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  usage_count: number;
  created_at: string;
}

export interface CouponDraft {
  code: string;
  type: CouponType;
  value: string;
  minOrderAmount: string;
  maxDiscountAmount: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
}

/**
 * The code as the database will store it, and as `validate_coupon` will look it
 * up.
 *
 * Both halves matter. The CHECK constraint refuses any row where
 * `code <> upper(code)`, so a lowercase draft is a failed insert with a
 * constraint name for an error message. And `validate_coupon` normalises the
 * CUSTOMER's input with `upper(trim(...))` before matching, so even if a
 * lowercase row somehow existed it could never be redeemed by anybody. Doing it
 * here means the operator gets a working code instead of either failure.
 */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * `datetime-local` yields a wall-clock string with no offset
 * ("2026-09-10T09:00"). Sent as-is to a `timestamptz`, Postgres reads it in the
 * DATABASE session timezone rather than the operator's, so a code scheduled
 * from Riyadh would start and end three hours out — in both directions.
 * `new Date(v)` parses it in the browser's zone, which is the one the operator
 * was looking at. Same helper and same reason as `LoyaltyCampaignsPanel.toIso`
 * and `BannerManagementPanel.toIso`.
 */
export function toIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

/** Optional numeric field: blank means "no bound", not zero. */
function optionalNumber(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type DraftProblem =
  | 'code-too-short'
  | 'code-too-long'
  | 'code-charset'
  | 'value-not-a-number'
  | 'percentage-out-of-range'
  | 'fixed-not-positive'
  | 'minimum-negative'
  | 'cap-negative'
  | 'usage-limit-negative'
  | 'window-backwards';

/**
 * Everything wrong with a draft, in one pass.
 *
 * Returns ALL problems rather than the first, because a form that reveals one
 * mistake per submission teaches the operator to distrust it. Order is stable
 * so the panel can render them deterministically.
 *
 * The percentage ceiling is the one rule here with no database counterpart —
 * see the module header. Everything else mirrors a CHECK constraint, and is
 * duplicated so the operator reads a sentence instead of `coupons_value_check`.
 */
export function validateDraft(draft: CouponDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const code = normaliseCode(draft.code);

  if (code.length < 3) problems.push('code-too-short');
  if (code.length > 32) problems.push('code-too-long');
  // The constraint is only upper-case and length, so this is a house rule
  // rather than a mirror: a code with a space or a slash is legal in the
  // column and miserable to read out over a phone.
  if (code.length > 0 && !/^[A-Z0-9_-]+$/.test(code)) problems.push('code-charset');

  const value = Number(draft.value.trim());
  if (draft.value.trim() === '' || !Number.isFinite(value)) {
    problems.push('value-not-a-number');
  } else if (draft.type === 'percentage') {
    if (value <= 0 || value > 100) problems.push('percentage-out-of-range');
  } else if (value <= 0) {
    problems.push('fixed-not-positive');
  }

  const min = optionalNumber(draft.minOrderAmount);
  if (min !== null && min < 0) problems.push('minimum-negative');

  const cap = optionalNumber(draft.maxDiscountAmount);
  if (cap !== null && cap < 0) problems.push('cap-negative');

  const limit = optionalNumber(draft.usageLimit);
  if (limit !== null && limit < 0) problems.push('usage-limit-negative');

  if (draft.startsAt && draft.endsAt && new Date(draft.startsAt) >= new Date(draft.endsAt)) {
    problems.push('window-backwards');
  }

  return problems;
}

export type CouponState = 'off' | 'scheduled' | 'live' | 'ended' | 'exhausted';

/**
 * What a code is doing right now, decided in one place.
 *
 * The order mirrors `validate_coupon`'s own rejection order, so the pill can
 * never disagree with what a customer is told: inactive, then not-yet-started,
 * then expired, then usage-limit-reached. A row that is switched off AND
 * expired reads "Off", because that is the first reason the server would give.
 */
export function couponState(
  c: Pick<Coupon, 'is_active' | 'starts_at' | 'ends_at' | 'usage_limit' | 'usage_count'>,
  now: Date,
): CouponState {
  if (!c.is_active) return 'off';
  if (c.starts_at && new Date(c.starts_at) > now) return 'scheduled';
  if (c.ends_at && new Date(c.ends_at) < now) return 'ended';
  if (c.usage_limit !== null && c.usage_count >= c.usage_limit) return 'exhausted';
  return 'live';
}

export type CouponRisk = 'no-expiry' | 'no-usage-limit' | 'uncapped-percentage';

/**
 * The ways a code is unbounded — G8, encoded so the screen cannot forget it.
 *
 * This is the whole reason the panel is worth more than a CRUD form. The two
 * codes found live on 2026-09-10 carried every one of these at once, and each
 * was individually invisible: nothing in the row said "this never expires".
 *
 * `uncapped-percentage` is listed separately from `no-usage-limit` because it
 * is the one that scales with basket size rather than with redemption count. A
 * fixed 10-off with no ceiling costs 10 per order; a 15% with no
 * `max_discount_amount` costs whatever the largest order of the day happens to
 * be. Reported only for percentage codes, since a fixed code is capped by its
 * own value.
 */
export function couponRisks(
  c: Pick<Coupon, 'type' | 'ends_at' | 'usage_limit' | 'max_discount_amount'>,
): CouponRisk[] {
  const risks: CouponRisk[] = [];
  if (!c.ends_at) risks.push('no-expiry');
  if (c.usage_limit === null) risks.push('no-usage-limit');
  if (c.type === 'percentage' && c.max_discount_amount === null) risks.push('uncapped-percentage');
  return risks;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const COLUMNS =
  'id, code, type, value, is_active, min_order_amount, max_discount_amount, starts_at, ends_at, usage_limit, usage_count, created_at';

export const couponsApi = {
  /** Newest first — an operator is nearly always looking for what they just made. */
  async list(): Promise<Coupon[]> {
    return unwrap<Coupon[]>(
      await supabase.from('coupons').select(COLUMNS).order('created_at', { ascending: false }),
    );
  },

  async create(draft: CouponDraft): Promise<void> {
    const row = {
      code: normaliseCode(draft.code),
      type: draft.type,
      value: Number(draft.value),
      // A blank minimum is 0, not null: the column is NOT NULL and 0 is what
      // "no minimum" means there. Blank ceilings ARE null — that column uses
      // null for "no bound", and 0 would mean "always discount nothing".
      min_order_amount: optionalNumber(draft.minOrderAmount) ?? 0,
      max_discount_amount: optionalNumber(draft.maxDiscountAmount),
      usage_limit: optionalNumber(draft.usageLimit),
      starts_at: toIso(draft.startsAt),
      ends_at: toIso(draft.endsAt),
      is_active: true,
    };
    const { error } = await supabase.from('coupons').insert(row);
    if (error) throw new Error(error.message);
  },

  /**
   * Switching a code off is the normal way to stop it, and the panel makes it
   * the primary action for the same reason `LoyaltyCampaignsPanel` does: a
   * stopped code that stays visible next to the orders it discounted is worth
   * more than a tidy list.
   */
  async setActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('coupons').update({ is_active: isActive }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Deleting is refused once a code has been redeemed, and the reason is in the
   * schema rather than in taste: `orders.coupon_code` stores the code as TEXT
   * with no foreign key (`coupons` has zero inbound FKs). So deleting a used
   * code does not break an order — it silently destroys the only record of what
   * that code was, leaving a discounted order whose discount cannot be
   * explained. Deactivation keeps both.
   *
   * Thrown here rather than shown as a disabled button alone, so the rule holds
   * even if a future caller forgets the button.
   */
  async remove(coupon: Pick<Coupon, 'id' | 'usage_count'>): Promise<void> {
    if (coupon.usage_count > 0) {
      throw new Error('A code that has been redeemed cannot be deleted — switch it off instead.');
    }
    const { error } = await supabase.from('coupons').delete().eq('id', coupon.id);
    if (error) throw new Error(error.message);
  },
};
