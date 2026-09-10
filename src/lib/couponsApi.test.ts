/**
 * The rules behind the promo-code screen.
 *
 * These are pinned rather than trusted because each one is a lesson from a
 * defect that was live in Production, not a hypothetical:
 *
 *   - a code stored in the wrong case is unredeemable BY ANYBODY, silently;
 *   - a percentage above 100 is a legal database row that makes orders free,
 *     because the column CHECK is only `value >= 0`;
 *   - "unbounded" has three independent shapes, and the two codes found live on
 *     2026-09-10 carried all three at once while each column merely looked
 *     empty;
 *   - deleting a redeemed code destroys the only record of what it was, since
 *     `orders.coupon_code` is text with no foreign key.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  couponRisks,
  couponState,
  couponsApi,
  normaliseCode,
  toIso,
  validateDraft,
  type Coupon,
  type CouponDraft,
} from './couponsApi';

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));

const NOW = new Date('2026-09-10T12:00:00Z');

const draft = (over: Partial<CouponDraft> = {}): CouponDraft => ({
  code: 'WELCOME10',
  type: 'percentage',
  value: '10',
  minOrderAmount: '',
  maxDiscountAmount: '',
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  ...over,
});

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c1',
  code: 'WELCOME10',
  type: 'percentage',
  value: 10,
  is_active: true,
  min_order_amount: 0,
  max_discount_amount: null,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  usage_count: 0,
  created_at: '2026-09-10T00:00:00Z',
  ...over,
});

describe('normaliseCode — the difference between a working code and a dead one', () => {
  it('upper-cases and trims', () => {
    expect(normaliseCode('  welcome10 ')).toBe('WELCOME10');
  });

  it('leaves an already-normal code alone', () => {
    expect(normaliseCode('WELCOME10')).toBe('WELCOME10');
  });

  it('is what makes a lowercase draft redeemable at all', () => {
    // validate_coupon looks up `where cp.code = upper(trim(customer input))`,
    // and the column CHECK refuses `code <> upper(code)`. So without this the
    // row is either rejected on insert or, if it existed, matched by nothing.
    //
    // A neutral fixture on purpose: the two codes this whole feature came from
    // are deactivated but still real, and they were deliberately kept out of
    // the repository when the deactivation was recorded. A test is not a
    // reason to put one back.
    expect(normaliseCode('summer25')).toBe(normaliseCode('SUMMER25'));
  });
});

describe('validateDraft', () => {
  it('accepts an ordinary bounded code', () => {
    expect(
      validateDraft(draft({ endsAt: '2026-12-31T00:00', usageLimit: '100', maxDiscountAmount: '50' })),
    ).toEqual([]);
  });

  it('REFUSES a percentage above 100 — the guard the database does not have', () => {
    // coupons_value_check is only `value >= 0`. A row of 500 is legal, and
    // validate_coupon clamps the discount to the subtotal, so it would not go
    // negative — every order would simply be free.
    expect(validateDraft(draft({ value: '500' }))).toContain('percentage-out-of-range');
    expect(validateDraft(draft({ value: '101' }))).toContain('percentage-out-of-range');
  });

  it('allows exactly 100 per cent, which is a real thing to want', () => {
    expect(validateDraft(draft({ value: '100' }))).not.toContain('percentage-out-of-range');
  });

  it('does not apply the percentage ceiling to a fixed amount', () => {
    expect(validateDraft(draft({ type: 'fixed', value: '500' }))).toEqual([]);
  });

  it('refuses zero and negative values in both shapes', () => {
    expect(validateDraft(draft({ value: '0' }))).toContain('percentage-out-of-range');
    expect(validateDraft(draft({ type: 'fixed', value: '0' }))).toContain('fixed-not-positive');
    expect(validateDraft(draft({ type: 'fixed', value: '-5' }))).toContain('fixed-not-positive');
  });

  it('enforces the length bounds the column CHECK enforces', () => {
    expect(validateDraft(draft({ code: 'AB' }))).toContain('code-too-short');
    expect(validateDraft(draft({ code: 'A'.repeat(33) }))).toContain('code-too-long');
    expect(validateDraft(draft({ code: 'A'.repeat(32) }))).not.toContain('code-too-long');
  });

  it('refuses a code nobody could read down a phone', () => {
    expect(validateDraft(draft({ code: 'SUMMER SALE' }))).toContain('code-charset');
    expect(validateDraft(draft({ code: 'SUMMER/SALE' }))).toContain('code-charset');
    expect(validateDraft(draft({ code: 'SUMMER-SALE_2' }))).not.toContain('code-charset');
  });

  it('refuses a backwards window', () => {
    expect(validateDraft(draft({ startsAt: '2026-12-31T00:00', endsAt: '2026-01-01T00:00' }))).toContain(
      'window-backwards',
    );
  });

  it('reports every problem at once rather than one per submission', () => {
    const problems = validateDraft(draft({ code: 'A B', value: '900' }));
    expect(problems).toContain('code-charset');
    expect(problems).toContain('percentage-out-of-range');
  });

  it('treats a blank value as missing rather than as zero', () => {
    expect(validateDraft(draft({ value: '' }))).toContain('value-not-a-number');
  });
});

describe('couponState — mirrors validate_coupon rejection order', () => {
  it('live when nothing stops it', () => {
    expect(couponState(coupon(), NOW)).toBe('live');
  });

  it('off beats every other reason, because the server checks it first', () => {
    const c = coupon({ is_active: false, ends_at: '2020-01-01T00:00:00Z', usage_limit: 1, usage_count: 5 });
    expect(couponState(c, NOW)).toBe('off');
  });

  it('scheduled before its start', () => {
    expect(couponState(coupon({ starts_at: '2026-12-01T00:00:00Z' }), NOW)).toBe('scheduled');
  });

  it('ended after its end', () => {
    expect(couponState(coupon({ ends_at: '2026-01-01T00:00:00Z' }), NOW)).toBe('ended');
  });

  it('exhausted at the limit, not merely past it', () => {
    expect(couponState(coupon({ usage_limit: 3, usage_count: 3 }), NOW)).toBe('exhausted');
    expect(couponState(coupon({ usage_limit: 3, usage_count: 2 }), NOW)).toBe('live');
  });

  it('an unlimited code is never exhausted however often it is used', () => {
    expect(couponState(coupon({ usage_limit: null, usage_count: 9999 }), NOW)).toBe('live');
  });
});

describe('couponRisks — G8, encoded', () => {
  it('reports all three for the exact shape found live on 2026-09-10', () => {
    // Both production codes were percentage/fixed with no expiry, no usage
    // limit and no cap. This is the assertion that would have fired.
    expect(couponRisks(coupon())).toEqual(['no-expiry', 'no-usage-limit', 'uncapped-percentage']);
  });

  it('reports nothing for a fully bounded code', () => {
    expect(
      couponRisks(coupon({ ends_at: '2026-12-31T00:00:00Z', usage_limit: 100, max_discount_amount: 50 })),
    ).toEqual([]);
  });

  it('does not call a FIXED code uncapped — its own value is the ceiling', () => {
    const c = coupon({
      type: 'fixed',
      max_discount_amount: null,
      ends_at: '2026-12-31T00:00:00Z',
      usage_limit: 5,
    });
    expect(couponRisks(c)).toEqual([]);
  });

  it('still flags an uncapped percentage even when it is dated and limited', () => {
    const c = coupon({ ends_at: '2026-12-31T00:00:00Z', usage_limit: 5, max_discount_amount: null });
    expect(couponRisks(c)).toEqual(['uncapped-percentage']);
  });
});

describe('toIso', () => {
  it('returns null for an unset bound rather than a malformed timestamp', () => {
    expect(toIso('')).toBeNull();
  });

  it('interprets the wall-clock string in the operator browser zone', () => {
    // The point of the helper: a bare 'YYYY-MM-DDTHH:mm' sent to timestamptz
    // would be read in the DATABASE zone instead.
    expect(toIso('2026-09-10T09:00')).toBe(new Date('2026-09-10T09:00').toISOString());
  });
});

describe('remove mirrors the database trigger, not the usage counter', () => {
  const none: ReadonlySet<string> = new Set();

  it('refuses a code an ORDER refers to even when usage_count is zero', async () => {
    // The case the first version got wrong. `guard_used_coupon_identity` keys
    // on `orders.coupon_code`; `admin_set_order_status` decrements
    // `usage_count` when an order is cancelled, and the cancelled order keeps
    // its code. So 0 uses does not mean deletable, and offering Delete there
    // produced a "never redeemed" confirmation followed by a 23503.
    await expect(
      couponsApi.remove({ id: 'c1', code: 'WELCOME10', usage_count: 0 }, new Set(['WELCOME10'])),
    ).rejects.toThrow(/cannot be deleted/i);
  });

  it('matches the trigger case-insensitively, as the trigger does', async () => {
    // The trigger compares `upper(btrim(...))` on both sides.
    await expect(
      couponsApi.remove({ id: 'c1', code: '  welcome10 ', usage_count: 0 }, new Set(['WELCOME10'])),
    ).rejects.toThrow();
  });

  it('still refuses on a positive usage count', async () => {
    await expect(couponsApi.remove({ id: 'c1', code: 'WELCOME10', usage_count: 1 }, none)).rejects.toThrow();
  });

  it('the guard lives in the api, not only in the button', async () => {
    // The panel withholds Delete for these. This asserts the rule survives a
    // caller that does not — which is the whole reason it is here as well.
    await expect(couponsApi.remove({ id: 'c1', code: 'X', usage_count: 42 }, none)).rejects.toThrow();
  });
});

describe('a FIXED coupon never carries a discount cap', () => {
  it('is asserted through create, because validate_coupon applies the cap to both types', async () => {
    // A stale cap left by a type switch would silently turn a fixed 50 into a
    // 10. The panel clears the field; this is the half a caller cannot bypass.
    const insert = vi.fn().mockResolvedValue({ error: null });
    const { supabase } = await import('./supabase');
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    await couponsApi.create(draft({ type: 'fixed', value: '50', maxDiscountAmount: '10' }));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ type: 'fixed', max_discount_amount: null });
  });

  it('keeps the cap for a percentage coupon', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const { supabase } = await import('./supabase');
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    await couponsApi.create(draft({ type: 'percentage', value: '15', maxDiscountAmount: '30' }));
    expect(insert.mock.calls[0][0]).toMatchObject({ type: 'percentage', max_discount_amount: 30 });
  });
});

describe('updateBounds changes what a code is bounded by, never what it is', () => {
  it('writes only the four bound columns', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const { supabase } = await import('./supabase');
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ update });

    await couponsApi.updateBounds('c1', {
      minOrderAmount: '25',
      maxDiscountAmount: '40',
      usageLimit: '100',
      endsAt: '2026-12-31T00:00',
    });

    const patch = update.mock.calls[0][0];
    expect(Object.keys(patch).sort()).toEqual([
      'ends_at',
      'max_discount_amount',
      'min_order_amount',
      'usage_limit',
    ]);
    // The omissions are the point: the trigger raises 23503 on a code change
    // for a referenced coupon, and re-pricing a live code is a different
    // decision from bounding it.
    expect(patch).not.toHaveProperty('code');
    expect(patch).not.toHaveProperty('type');
    expect(patch).not.toHaveProperty('value');
    expect(eq).toHaveBeenCalledWith('id', 'c1');
  });

  it('clears a bound when the field is blanked, rather than leaving it', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const { supabase } = await import('./supabase');
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ update });

    await couponsApi.updateBounds('c1', {
      minOrderAmount: '',
      maxDiscountAmount: '',
      usageLimit: '',
      endsAt: '',
    });
    expect(update.mock.calls[0][0]).toEqual({
      // NOT NULL with 0 meaning "no minimum"; the other three use null.
      min_order_amount: 0,
      max_discount_amount: null,
      usage_limit: null,
      ends_at: null,
    });
  });
});
