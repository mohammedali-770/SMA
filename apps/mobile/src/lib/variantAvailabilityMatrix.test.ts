import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildVariantAvailabilityMatrix } from './mappers';
import { availabilityLookup } from '../features/order/cartValidation';

/**
 * The client's rule for "is this SIZE closed", and its parity with the server's.
 *
 * Three levels of availability now exist — product, size, option — and only the
 * size level carries a RESTORE TIME the client must interpret. The row is left
 * saying `is_available = false` until the sweeper's next tick, so between the
 * timer running out and that tick the stored row and the truth disagree.
 * `place_order` resolves that with
 *
 *   snoozed_until is null or snoozed_until > now()
 *
 * and the customer app has to resolve it identically. Stricter than the server
 * means refusing a customer an item the server would sell them; looser means
 * the raw refusal at the payment step that the whole pre-check exists to avoid.
 */
const row = (
  variantId: string,
  branchId: string,
  isAvailable: boolean,
  snoozedUntil: string | null = null,
) => ({
  variant_id: variantId,
  branch_id: branchId,
  is_available: isAvailable,
  snoozed_until: snoozedUntil,
});

const NOW = Date.parse('2026-09-17T12:00:00Z');
const PAST = '2026-09-17T11:59:00Z';
const FUTURE = '2026-09-17T12:30:00Z';

describe('buildVariantAvailabilityMatrix', () => {
  it('an absent row means the size is on sale', () => {
    // The table stores EXCEPTIONS. Defaulting the other way would close the
    // whole menu the first time a tier was added.
    const lookup = availabilityLookup(buildVariantAvailabilityMatrix([], NOW));
    expect(lookup('v1', 'b1')).toBe(true);
  });

  it('an INDEFINITE closure (no restore time) closes the size', () => {
    const lookup = availabilityLookup(buildVariantAvailabilityMatrix([row('v1', 'b1', false)], NOW));
    expect(lookup('v1', 'b1')).toBe(false);
  });

  it('a closure whose timer is still running closes the size', () => {
    const lookup = availabilityLookup(buildVariantAvailabilityMatrix([row('v1', 'b1', false, FUTURE)], NOW));
    expect(lookup('v1', 'b1')).toBe(false);
  });

  it('a LAPSED timer is not a closure — the sweeper has simply not ticked yet', () => {
    // The whole reason this builder exists rather than reusing buildMatrix.
    const lookup = availabilityLookup(buildVariantAvailabilityMatrix([row('v1', 'b1', false, PAST)], NOW));
    expect(lookup('v1', 'b1')).toBe(true);
  });

  it('a timer expiring exactly NOW is open, matching the server strict >', () => {
    // place_order keeps the closure only while `snoozed_until > now()`, so the
    // boundary instant is OPEN. An inclusive comparison here would disagree
    // with the server for one second.
    const lookup = availabilityLookup(
      buildVariantAvailabilityMatrix([row('v1', 'b1', false, '2026-09-17T12:00:00Z')], NOW),
    );
    expect(lookup('v1', 'b1')).toBe(true);
  });

  it('a row that says AVAILABLE closes nothing, whatever its timer says', () => {
    const lookup = availabilityLookup(buildVariantAvailabilityMatrix([row('v1', 'b1', true, FUTURE)], NOW));
    expect(lookup('v1', 'b1')).toBe(true);
  });

  it('a closure is scoped to its own branch and its own size', () => {
    const lookup = availabilityLookup(
      buildVariantAvailabilityMatrix([row('v1', 'b1', false), row('v2', 'b2', false)], NOW),
    );
    expect(lookup('v1', 'b1')).toBe(false);
    expect(lookup('v1', 'b2')).toBe(true);
    expect(lookup('v2', 'b1')).toBe(true);
    expect(lookup('v2', 'b2')).toBe(false);
  });

  it('is NOT seeded — it holds closed sizes only', () => {
    // Deliberate, and asserted so it is not "tidied up" into a seeded matrix
    // later: the provider would then need a variant id list purely to rebuild
    // it on an availability-only refresh, which is one more list to keep in
    // step with the catalog for no change in any answer.
    expect(buildVariantAvailabilityMatrix([row('v1', 'b1', true)], NOW)).toEqual({});
  });

  it('an unparseable restore time is treated as a live closure', () => {
    // NaN <= now is false, so the row stays closed. That is the safe direction:
    // the server would still refuse the line, so the customer is told here.
    const lookup = availabilityLookup(
      buildVariantAvailabilityMatrix([row('v1', 'b1', false, 'not-a-date')], NOW),
    );
    expect(lookup('v1', 'b1')).toBe(false);
  });
});

describe('parity with the server predicate', () => {
  it('place_order still applies the rule this builder mirrors', () => {
    // A source-level pin, not a behavioural one: if the server ever stops
    // treating a lapsed timer as open, the client's lazy expiry becomes the
    // looser of the two and a customer meets the raw refusal at checkout.
    // Fail here instead, pointing at buildVariantAvailabilityMatrix.
    const sql = readFileSync(
      new URL(
        '../../../../supabase/migrations/20260924120000_place_order_variant_availability.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const predicate = 'bva.snoozed_until is null or bva.snoozed_until > now()';
    // Twice in the two money-path function bodies, twice more in the migration's
    // own verification block that asserts them.
    expect(sql.split(predicate).length - 1).toBeGreaterThanOrEqual(2);
  });
});
