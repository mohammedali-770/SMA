/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `opsApi.variantClosingEnabled` — the one function in opsApi that SWALLOWS its
 * error, tested because that is the whole reason it exists.
 *
 * The branch console deploys the moment a change merges. Applying
 * `20260926120000` is a separate owner action that may come later, or not at
 * all. A select naming a column that does not exist is answered by PostgREST
 * with `42703`, and every other reader here turns that into a thrown error —
 * which, inside the console's single `refresh()`, would take the whole screen
 * down for every cashier over a feature none of them can use yet.
 *
 * That is exactly the shape of the `orders.is_comped` outage, where a column
 * added without a grant broke "My Orders" for three weeks: PostgREST refuses
 * the WHOLE query when one column is unreadable. So this read is its own query
 * and fails to FALSE, which is precisely the pre-migration behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { opsApi } from './opsApi';
import { supabase } from './supabase';

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));

/** A chainable stand-in for `from(...).select(...).eq(...).maybeSingle()`. */
function answer(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

beforeEach(() => vi.clearAllMocks());

/** A chainable stand-in for `from(...).select(...).eq(...)` — resolves at `.eq`. */
function rowsAnswer(result: { data: unknown; error: unknown }) {
  const chain = { select: () => chain, eq: () => Promise.resolve(result) };
  (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
}

describe('branchVariantAvailability', () => {
  it('maps the exception rows when the read succeeds', async () => {
    rowsAnswer({
      data: [{ variant_id: 'v1', is_available: false, snoozed_until: null, reason_code: 'out_of_stock' }],
      error: null,
    });
    await expect(opsApi.branchVariantAvailability('b1')).resolves.toEqual([
      { variantId: 'v1', isAvailable: false, snoozedUntil: null, reasonCode: 'out_of_stock' },
    ]);
  });

  it('returns [] — NOT a rejection — when the table does not exist yet', async () => {
    // THE DEFECT REVIEW CAUGHT ON #395. The console's refresh() is one
    // Promise.all, so a rejection here blanks the whole screen with a blocking
    // "could not load" notice — taking availability, delivery and the reference
    // sheet away from every cashier, over a table holding nothing they can use.
    rowsAnswer({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    await expect(opsApi.branchVariantAvailability('b1')).resolves.toEqual([]);
  });

  it('returns [] when the read is refused', async () => {
    rowsAnswer({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(opsApi.branchVariantAvailability('b1')).resolves.toEqual([]);
  });

  it('returns [] rather than null on an empty success', async () => {
    rowsAnswer({ data: null, error: null });
    await expect(opsApi.branchVariantAvailability('b1')).resolves.toEqual([]);
  });
});

describe('variantClosingEnabled', () => {
  it('is TRUE only when the live row says so', async () => {
    answer({ data: { variant_closing_enabled: true }, error: null });
    await expect(opsApi.variantClosingEnabled()).resolves.toBe(true);
  });

  it('is false when the row says false', async () => {
    answer({ data: { variant_closing_enabled: false }, error: null });
    await expect(opsApi.variantClosingEnabled()).resolves.toBe(false);
  });

  it('is false — NOT a thrown error — when the column does not exist yet', async () => {
    // The pre-migration case. Throwing here would blank the branch console.
    answer({ data: null, error: { code: '42703', message: 'column ... does not exist' } });
    await expect(opsApi.variantClosingEnabled()).resolves.toBe(false);
  });

  it('is false when the read is refused outright', async () => {
    answer({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(opsApi.variantClosingEnabled()).resolves.toBe(false);
  });

  it('is false when the settings row is missing entirely', async () => {
    answer({ data: null, error: null });
    await expect(opsApi.variantClosingEnabled()).resolves.toBe(false);
  });

  it('is false when the column is present but null', async () => {
    // `undefined`/`null` must read as OFF, the same direction as the column
    // default, rather than as "unset" and therefore permissive.
    answer({ data: { variant_closing_enabled: null }, error: null });
    await expect(opsApi.variantClosingEnabled()).resolves.toBe(false);
  });

  it('reads app_settings on its OWN query, so it cannot break another one', async () => {
    // Folding this column into a select that also fetches something needed
    // would make a missing column fail that query too.
    answer({ data: { variant_closing_enabled: true }, error: null });
    await opsApi.variantClosingEnabled();
    expect(supabase.from).toHaveBeenCalledWith('app_settings');
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
