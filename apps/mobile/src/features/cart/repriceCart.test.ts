import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePersistedCart, CART_SCHEMA_VERSION } from './cartSchema';
import type { CartItem, Modifier, ModifierGroup, Product, ProductVariant } from '../../types/models';
import { cartSubtotal, computeUnitPrice, makeCartItemId } from '../../utils/format';
import { validateCartForBranch } from '../order/cartValidation';
import { cartOrderItems, cartOrderSignature } from './cartOrderBody';
import { repriceCart } from './repriceCart';

const mod = (id: string, price: number, groupId = 'G1'): Modifier => ({
  id,
  groupId,
  nameEn: id,
  nameAr: id,
  price,
});
const tier = (id: string, price: number, productId = 'P1'): ProductVariant => ({
  id,
  productId,
  nameEn: id,
  nameAr: id,
  price,
  calories: null,
});
const product = (over: Partial<Product> = {}): Product => ({
  id: 'P1',
  categoryId: 'C1',
  nameEn: 'Wings',
  nameAr: 'أجنحة',
  descriptionEn: '',
  descriptionAr: '',
  price: 32,
  imageUrl: '',
  calories: 0,
  isActive: true,
  sortOrder: 0,
  modifierGroupIds: ['G1'],
  variants: [],
  ...over,
});
const group = (mods: Modifier[]): ModifierGroup => ({
  id: 'G1',
  nameEn: 'Sauce',
  nameAr: 'صوص',
  minSelection: 0,
  maxSelection: 3,
  isRequired: false,
  modifiers: mods,
});

/** A line built exactly as CartProvider.addItem builds one. */
function line(
  p: Product,
  selected: { [g: string]: Modifier[] },
  quantity: number,
  variant?: ProductVariant,
): CartItem {
  return {
    cartItemId: makeCartItemId(p.id, selected, undefined, variant?.id),
    product: p,
    variant,
    selectedModifiers: selected,
    quantity,
    unitPrice: computeUnitPrice(p, selected, variant),
  };
}

describe('repriceCart — the price the cart shows is the price the menu now asks', () => {
  it('a persisted cart restores at the old price and reprices to the new one', () => {
    // The measured defect: a line saved at 32 x 2 restored and previewed 64
    // while place_order charged from the current price of 35.
    const saved = line(product({ price: 32 }), {}, 2);
    const raw = JSON.stringify({ v: CART_SCHEMA_VERSION, items: [saved] });
    const restored = parsePersistedCart(raw);
    expect(cartSubtotal(restored)).toBe(64);

    const r = repriceCart(restored, [product({ price: 35 })], { G1: group([]) });
    expect(r.changed).toBe(true);
    expect(r.items[0].unitPrice).toBe(35);
    expect(cartSubtotal(r.items)).toBe(70);
    expect(r.items[0].unavailable).toBeUndefined();
  });

  it('reprices the chosen tier from its fresh row, not the product price', () => {
    const small = tier('S', 20);
    const large = tier('L', 29);
    const old = line(product({ price: 20, variants: [small, large] }), {}, 1, large);
    const r = repriceCart([old], [product({ price: 22, variants: [tier('S', 22), tier('L', 31)] })], {
      G1: group([]),
    });
    expect(r.items[0].unitPrice).toBe(31);
    expect(r.items[0].variant?.price).toBe(31);
  });

  it('reprices options from their fresh rows', () => {
    const old = line(product(), { G1: [mod('M1', 2), mod('M2', 3)] }, 1);
    expect(old.unitPrice).toBe(37);
    const r = repriceCart([old], [product()], { G1: group([mod('M1', 4), mod('M2', 3)]) });
    expect(r.items[0].unitPrice).toBe(39);
    expect(r.items[0].selectedModifiers.G1.map((m) => m.price)).toEqual([4, 3]);
  });

  it('prices exactly as a freshly added line would be', () => {
    const fresh = product({ price: 41 });
    const sel = { G1: [mod('M1', 2.5)] };
    const old = line(product({ price: 30 }), { G1: [mod('M1', 1)] }, 3);
    const r = repriceCart([old], [fresh], { G1: group([mod('M1', 2.5)]) });
    expect(r.items[0].unitPrice).toBe(computeUnitPrice(fresh, sel, null));
  });

  it('changes nothing, and keeps the same array, when prices did not move', () => {
    const p = product();
    const items = [line(p, { G1: [mod('M1', 2)] }, 1)];
    const r = repriceCart(items, [product()], { G1: group([mod('M1', 2)]) });
    expect(r.changed).toBe(false);
    expect(r.items).toBe(items);
  });

  it('settles: a second pass over its own output changes nothing', () => {
    const items = [line(product({ price: 30 }), {}, 1)];
    const products = [product({ price: 33 })];
    const once = repriceCart(items, products, { G1: group([]) });
    const twice = repriceCart(once.items, products, { G1: group([]) });
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
    expect(twice.items).toBe(once.items);
  });

  it('never flags anything when no menu is loaded', () => {
    // A failed or unfinished load is not evidence that the menu was withdrawn.
    const items = [line(product(), {}, 1)];
    const r = repriceCart(items, [], {});
    expect(r.changed).toBe(false);
    expect(r.items[0].unavailable).toBeUndefined();
  });
});

describe('repriceCart — what the menu no longer offers is flagged, not dropped', () => {
  it('flags a line whose product is gone', () => {
    const r = repriceCart([line(product(), {}, 1)], [product({ id: 'OTHER' })], {});
    expect(r.items).toHaveLength(1);
    expect(r.items[0].unavailable).toBe('product');
  });

  it('flags a line whose product is inactive (a staff session can see it)', () => {
    const r = repriceCart([line(product(), {}, 1)], [product({ isActive: false })], {});
    expect(r.items[0].unavailable).toBe('product');
  });

  it('flags a line whose tier is gone', () => {
    const old = line(product({ variants: [tier('S', 20), tier('L', 29)] }), {}, 1, tier('L', 29));
    const r = repriceCart([old], [product({ variants: [tier('S', 20)] })], { G1: group([]) });
    expect(r.items[0].unavailable).toBe('tier');
  });

  it('flags an untiered line once the product has tiers', () => {
    const r = repriceCart([line(product(), {}, 1)], [product({ variants: [tier('S', 20)] })], {
      G1: group([]),
    });
    expect(r.items[0].unavailable).toBe('tier');
  });

  it('flags a line whose option is gone from its group', () => {
    const old = line(product(), { G1: [mod('M1', 2)] }, 1);
    const r = repriceCart([old], [product()], { G1: group([mod('M2', 2)]) });
    expect(r.items[0].unavailable).toBe('option');
  });

  it('flags a line whose option group is no longer linked to the product', () => {
    const old = line(product(), { G1: [mod('M1', 2)] }, 1);
    const r = repriceCart([old], [product({ modifierGroupIds: [] })], { G1: group([mod('M1', 2)]) });
    expect(r.items[0].unavailable).toBe('option');
  });

  it('clears the flag when the item returns', () => {
    const items = [line(product(), {}, 1)];
    const gone = repriceCart(items, [product({ id: 'OTHER' })], {});
    const back = repriceCart(gone.items, [product()], { G1: group([]) });
    expect(back.items[0].unavailable).toBeUndefined();
  });

  it('a flagged line is unorderable at every branch, so checkout names it', () => {
    const r = repriceCart([line(product(), {}, 1)], [product({ id: 'OTHER' })], {});
    const v = validateCartForBranch(
      r.items,
      'B1',
      () => true,
      () => true,
      () => true,
    );
    expect(v.allValid).toBe(false);
    expect(v.invalid.map((it) => it.product.id)).toEqual(['P1']);
  });
});

describe('the idempotency key follows the order, not the prices', () => {
  it('a reprice leaves the order body, and so the key, unchanged', () => {
    const items = [line(product({ price: 30 }), { G1: [mod('M1', 1)] }, 2)];
    const r = repriceCart(items, [product({ price: 45 })], { G1: group([mod('M1', 5)]) });
    expect(r.changed).toBe(true);
    expect(cartOrderSignature(r.items)).toBe(cartOrderSignature(items));
  });

  it('a flag leaves it unchanged too', () => {
    const items = [line(product(), {}, 1)];
    const r = repriceCart(items, [product({ id: 'OTHER' })], {});
    expect(cartOrderSignature(r.items)).toBe(cartOrderSignature(items));
  });

  it('an edit the customer makes still changes it', () => {
    const a = [line(product(), {}, 1)];
    expect(cartOrderSignature([{ ...a[0], quantity: 2 }])).not.toBe(cartOrderSignature(a));
    expect(cartOrderSignature([{ ...a[0], note: 'no onion' }])).not.toBe(cartOrderSignature(a));
    expect(cartOrderSignature([])).not.toBe(cartOrderSignature(a));
  });

  it('builds the body place_order has always received', () => {
    const items = [
      {
        ...line(
          product({ variants: [tier('L', 29)] }),
          { G1: [mod('M1', 1), mod('M2', 2)] },
          2,
          tier('L', 29),
        ),
        note: 'no onion',
      },
      line(product({ id: 'P2', modifierGroupIds: [] }), {}, 1),
    ];
    expect(cartOrderItems(items)).toEqual([
      { product_id: 'P1', quantity: 2, variant_id: 'L', modifier_ids: ['M1', 'M2'], note: 'no onion' },
      { product_id: 'P2', quantity: 1, modifier_ids: [] },
    ]);
  });
});

describe('wiring', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = (rel: string) => strip(readFileSync(resolve(__dirname, '../..', rel), 'utf8'));

  it('CartProvider reprices after hydration and whenever products or options change', () => {
    const cart = code('store/CartProvider.tsx');
    expect(cart).toContain('const { products, modifierGroupsById } = useCatalog();');
    expect(cart).toMatch(
      /const r = repriceCart\(prev, products, modifierGroupsById\);\s*return r\.changed \? r\.items : prev;/,
    );
    expect(cart).toContain('}, [hydrationDone, products, modifierGroupsById]);');
    expect(cart).toContain('setHydrationDone(true)');
  });

  it('CartProvider rotates the key on the order body, and only there', () => {
    const cart = code('store/CartProvider.tsx');
    expect(cart).toContain('const orderSignature = useMemo(() => cartOrderSignature(items), [items]);');
    expect(cart).toMatch(/setIdempotencyKey\(uuidv4\(\)\);\s*\}, \[orderSignature\]\);/);
    expect(cart.match(/setIdempotencyKey\(uuidv4\(\)\)/g)).toHaveLength(1);
    expect(cart).toContain('const toOrderItems = useCallback(() => cartOrderItems(items), [items]);');
  });

  it('CatalogProvider refreshes prices with availability, on the same triggers', () => {
    const provider = code('store/CatalogProvider.tsx');
    const refresh = provider.slice(provider.indexOf('const refreshAvailability = useCallback'));
    expect(refresh).toMatch(/catalog\.products\(\), catalog\.productVariants\(\), catalog\.modifiers\(\)/);
    expect(refresh).toContain('setProducts(menu.products);');
    expect(refresh).toContain('setModifierGroupsById(menu.modifierGroupsById);');
    // The foreground trigger still calls it; HomeMenuScreen's focus does too.
    expect(provider).toContain("if (state === 'active') void refreshAvailability();");
    expect(code('features/menu/HomeMenuScreen.tsx')).toMatch(
      /useFocusEffect\(\s*useCallback\(\(\) => \{\s*void refreshAvailability\(\);/,
    );
  });

  it('the full load and the refresh map rows through the same function', () => {
    const provider = code('store/CatalogProvider.tsx');
    expect(provider.match(/mapPricedMenu\(/g)).toHaveLength(2);
    expect(provider).not.toMatch(/\bmapProduct\(/);
  });

  it('the cart says why a flagged line cannot be ordered', () => {
    const screen = code('features/cart/CartScreen.tsx');
    expect(screen).toContain("unavailableLabel={it.unavailable ? t('cartLineUnavailable') : null}");
    expect(screen).toMatch(/\{unavailableLabel \? <Text/);
  });
});
