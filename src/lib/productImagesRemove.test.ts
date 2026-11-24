/**
 * F-TAA4-005: `productImages.removeByUrl` deletes only an object of THIS
 * project's bucket, and only when no other row still points at it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { remove, counts } = vi.hoisted(() => ({
  remove: vi.fn(),
  counts: { products: 0, homepage_banners: 0, error: null as null | { message: string } },
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: 'products' | 'homepage_banners') => ({
      select: () => ({
        like: async () => ({ count: counts[table], error: counts.error }),
      }),
    }),
    storage: { from: () => ({ remove }) },
  },
}));

import { productImages } from './api';

const PROJECT = 'https://ref.supabase.co';

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT);
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  counts.products = 0;
  counts.homepage_banners = 0;
  counts.error = null;
});

const own = `${PROJECT}/storage/v1/object/public/product-images/products/a.jpg`;

describe('productImages.removeByUrl', () => {
  it('removes an unreferenced object of this project', async () => {
    await productImages.removeByUrl(own);
    expect(remove).toHaveBeenCalledWith(['products/a.jpg']);
  });

  it('keeps the file while another product still uses it', async () => {
    counts.products = 1;
    await productImages.removeByUrl(own);
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the file while a banner still uses it', async () => {
    counts.homepage_banners = 1;
    await productImages.removeByUrl(own);
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the file when the reference check itself fails', async () => {
    counts.error = { message: 'boom' };
    await productImages.removeByUrl(own);
    expect(remove).not.toHaveBeenCalled();
  });

  it('ignores a URL on another host that carries the bucket marker', async () => {
    await productImages.removeByUrl(
      'https://evil.example/storage/v1/object/public/product-images/products/a.jpg',
    );
    expect(remove).not.toHaveBeenCalled();
  });
});
