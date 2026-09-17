/**
 * `catalog.variantAvailability()` — the one catalog read that SWALLOWS its
 * error, tested because that is the whole reason it is written differently.
 *
 * `catalog.all()` is a single `Promise.all` and `ok()` throws, so ANY rejection
 * inside it fails the WHOLE menu load: `CatalogProvider` catches it, sets
 * `error`, and the customer gets an error screen instead of a menu.
 *
 * `branch_variant_availability` arrived in `20260923120000`. Applying a
 * migration is a separate owner action that can land AFTER a build ships, and
 * against a project without the table PostgREST answers 404 — which would take
 * the menu away from every customer on that build over a feature none of them
 * can see. That is the `orders.is_comped` outage wearing this feature's clothes:
 * one unreadable thing failing a query that needed everything else in it.
 *
 * An empty list is not a fallback here, it is the correct answer: the table
 * stores EXCEPTIONS only, so "no rows" means "no size is closed" — the same
 * direction as the lookup's own `?? true`, and what a missing table implies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }));

import { catalog } from './api';

/** A chainable stand-in for `from(...).select(...)`. */
function answer(result: { data: unknown; error: unknown }) {
  from.mockReturnValue({ select: () => Promise.resolve(result) });
}

beforeEach(() => vi.clearAllMocks());

describe('catalog.variantAvailability', () => {
  it('returns the exception rows when the read succeeds', async () => {
    const rows = [{ branch_id: 'b1', variant_id: 'v1', is_available: false, snoozed_until: null }];
    answer({ data: rows, error: null });
    await expect(catalog.variantAvailability()).resolves.toEqual(rows);
  });

  it('returns [] — NOT a rejection — when the table does not exist yet', async () => {
    // The pre-migration case. Throwing here takes the whole menu down.
    answer({ data: null, error: { message: 'relation "branch_variant_availability" does not exist' } });
    await expect(catalog.variantAvailability()).resolves.toEqual([]);
  });

  it('returns [] when the read is refused', async () => {
    answer({ data: null, error: { message: 'permission denied' } });
    await expect(catalog.variantAvailability()).resolves.toEqual([]);
  });

  it('returns [] rather than null when the read succeeds with no rows', async () => {
    // `buildVariantAvailabilityMatrix` iterates its argument; a null would throw
    // inside CatalogProvider, which is the failure this is avoiding.
    answer({ data: null, error: null });
    await expect(catalog.variantAvailability()).resolves.toEqual([]);
  });

  it('reads its OWN table, so it cannot fail somebody else’s query', async () => {
    answer({ data: [], error: null });
    await catalog.variantAvailability();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('branch_variant_availability');
  });
});
