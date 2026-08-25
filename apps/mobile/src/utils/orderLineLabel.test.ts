/**
 * The tier on a customer receipt line.
 *
 * Before this, `order_items.variant_name_*` was persisted at checkout and then
 * dropped on the way out: CUSTOMER_ORDER_SELECT did not fetch it and the mapper
 * did not carry it, so a receipt showed a bare "Coral" for a Large.
 */
import { describe, it, expect } from 'vitest';
import { orderLineLabel } from './format';
import { CUSTOMER_ORDER_ITEM_COLUMNS, CUSTOMER_ORDER_SELECT } from '../lib/orderSelect';

const en = (e: string, _a: string) => e;
const ar = (_e: string, a: string) => a;

describe('orderLineLabel', () => {
  const line = { nameEn: 'Coral', nameAr: 'كورال' };

  it('appends the tier in the reader\'s language', () => {
    const tiered = { ...line, variantNameEn: 'Large', variantNameAr: 'كبير' };
    expect(orderLineLabel(tiered, en)).toBe('Coral — Large');
    expect(orderLineLabel(tiered, ar)).toBe('كورال — كبير');
  });

  it('leaves an untiered line exactly as it read before variants existed', () => {
    expect(orderLineLabel(line, en)).toBe('Coral');
    expect(orderLineLabel(line, ar)).toBe('كورال');
  });

  it('does not repeat the name when the tier duplicates it or is blank', () => {
    expect(orderLineLabel({ ...line, variantNameEn: 'Coral' }, en)).toBe('Coral');
    expect(orderLineLabel({ ...line, variantNameEn: '  ' }, en)).toBe('Coral');
  });
});

describe('the customer select actually fetches the tier', () => {
  // The grant in 20260824120000 covers these for `authenticated`. That matters:
  // PostgREST rejects the WHOLE select rather than omitting an unreadable
  // column, so an ungranted column here breaks the entire receipt.
  it('lists the variant name columns', () => {
    expect(CUSTOMER_ORDER_ITEM_COLUMNS).toContain('variant_name_en');
    expect(CUSTOMER_ORDER_ITEM_COLUMNS).toContain('variant_name_ar');
  });

  it('carries them in the literal the client actually sends', () => {
    expect(CUSTOMER_ORDER_SELECT).toContain('variant_name_en');
    expect(CUSTOMER_ORDER_SELECT).toContain('variant_name_ar');
  });

  it('still fetches no catalog join or internal id for a customer order', () => {
    // A word boundary, not a substring: `lazywait_order_number` IS fetched and
    // is the branch's number, which the customer is shown. The internal SM-…
    // `order_number` is the one that must never appear.
    expect(CUSTOMER_ORDER_SELECT).not.toMatch(/\border_number\b/);
    expect(CUSTOMER_ORDER_SELECT).toContain('lazywait_order_number');
    // The tier NAME is a snapshot on the line; the tier id and a catalog embed
    // are joins the receipt has no use for.
    expect(CUSTOMER_ORDER_SELECT).not.toContain('variant_id');
    expect(CUSTOMER_ORDER_SELECT).not.toContain('product_variants(');
  });
});
