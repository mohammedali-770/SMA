import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_LINE_QUANTITY, clampQuantity, incrementQuantity, mergeQuantities } from './quantityLimit';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('MAX_LINE_QUANTITY', () => {
  it('is the number the database enforces', () => {
    // The guard place_customer_order adds. If either side changes alone, an
    // honest customer could build a line the server refuses, or be stopped
    // short of one it would accept.
    const sql = read('supabase/migrations/20261005120000_server_input_bounds.sql');
    const match = sql.match(/where coalesce\(\(e\.value ->> 'quantity'\)::int, 0\) > (\d+)\) then\n/);
    expect(match, 'the line guard was not found in the migration').not.toBeNull();
    expect(Number(match![1])).toBe(MAX_LINE_QUANTITY);
    // ...its own verification block asserts the same number, and so does the
    // message the app maps.
    expect(sql).toContain(
      `'where coalesce((e.value ->> ''quantity'')::int, 0) > ${MAX_LINE_QUANTITY}) then',`,
    );
    expect(sql).toContain(
      `message    = 'order_items_quantity_max: at most ${MAX_LINE_QUANTITY} of one item per order line.';`,
    );
  });
});

describe('quantity helpers', () => {
  it('stops incrementing at the cap', () => {
    expect(incrementQuantity(1)).toBe(2);
    expect(incrementQuantity(MAX_LINE_QUANTITY - 1)).toBe(MAX_LINE_QUANTITY);
    expect(incrementQuantity(MAX_LINE_QUANTITY)).toBe(MAX_LINE_QUANTITY);
  });

  it('caps two lines that merge into one', () => {
    expect(mergeQuantities(3, 4)).toBe(7);
    expect(mergeQuantities(30, 30)).toBe(MAX_LINE_QUANTITY);
  });

  it('brings any quantity into range', () => {
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(-5)).toBe(1);
    expect(clampQuantity(1_000_000)).toBe(MAX_LINE_QUANTITY);
    expect(clampQuantity(Number.NaN)).toBe(1);
    expect(clampQuantity(7)).toBe(7);
  });
});

describe('wiring', () => {
  // The cart and the steppers are React Native modules, which this suite
  // cannot import, so the wiring is asserted on the source.
  it('the cart caps every path that grows a line', () => {
    const cart = read('apps/mobile/src/store/CartProvider.tsx');
    expect(cart).toContain('quantity: incrementQuantity(it.quantity)');
    expect(cart.match(/mergeQuantities\(it\.quantity, quantity\)/g)?.length).toBe(2);
    expect(cart.match(/quantity: clampQuantity\(quantity\)/g)?.length).toBe(2);
    expect(cart).not.toMatch(/quantity: it\.quantity \+ /);
  });

  it('the stepper disables + at the cap by default', () => {
    const stepper = read('apps/mobile/src/components/QtyStepper.tsx');
    expect(stepper).toContain('max = MAX_LINE_QUANTITY');
    expect(stepper).toContain('const incDisabled = busy || value >= max;');
    expect(stepper).toContain('disabled={incDisabled}');
  });

  it('the product page increments through the cap', () => {
    const detail = read('apps/mobile/src/features/product/ProductDetailScreen.tsx');
    expect(detail).toContain('setQty(incrementQuantity)');
    expect(detail).not.toContain('setQty((q) => q + 1)');
  });
});
