import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { bannerHref } from './bannerRoute';

/**
 * F-X10-002: the banner tap built `/product/${actionValue}` from a stored
 * string. Only a product UUID may become a route.
 */
const ID = '0b4c1d2e-3f40-4a51-8b62-7c83d94ea5f6';

describe('bannerHref', () => {
  it('opens the product route for a product banner holding a UUID', () => {
    expect(bannerHref({ actionType: 'product', actionValue: ID })).toBe(`/product/${ID}`);
    expect(bannerHref({ actionType: 'product', actionValue: ID.toUpperCase() })).toBe(
      `/product/${ID.toUpperCase()}`,
    );
  });

  it.each([
    ['a parent segment', `../cart`],
    ['a nested path', `${ID}/../../checkout`],
    ['a path after the id', `${ID}/extra`],
    ['a query string', `${ID}?next=/cart`],
    ['a fragment', `${ID}#x`],
    ['an absolute path', '/cart'],
    ['a scheme', 'https://example.test/x'],
    ['whitespace around a valid id', ` ${ID} `],
    ['a trailing newline', `${ID}\n`],
    ['an id that is not a UUID', 'pizza'],
    ['an empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(bannerHref({ actionType: 'product', actionValue: value })).toBeNull();
  });

  it('refuses a missing value and every non-product action', () => {
    expect(bannerHref({ actionType: 'product', actionValue: null })).toBeNull();
    expect(bannerHref({ actionType: 'category', actionValue: ID })).toBeNull();
    expect(bannerHref({ actionType: 'none', actionValue: ID })).toBeNull();
  });
});

describe('BannerCarousel uses it', () => {
  const src = readFileSync(new URL('./BannerCarousel.tsx', import.meta.url), 'utf8');

  it('builds the route only through bannerHref, never from the raw stored value', () => {
    expect(src).toContain("import { bannerHref } from './bannerRoute';");
    expect(src).toContain('const href = bannerHref(b);');
    expect(src).not.toContain('`/product/${b.actionValue}`');
    expect(src).not.toContain('router.push(`/product/${');
  });

  it('only makes a banner tappable when its route is valid', () => {
    expect(src).toContain('const tappable = bannerHref(banner) !== null;');
  });
});
