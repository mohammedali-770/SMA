import { describe, expect, it } from 'vitest';

import {
  ALLOWED_PRODUCT_IMAGE_MIME,
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_BUCKET,
  isAllowedProductImageSize,
  isAllowedProductImageType,
  productImagePathFromUrl,
  productImageStoragePath,
} from './productImages';

describe('product image type gate', () => {
  it('accepts the three MIME types the bucket allows', () => {
    for (const type of ALLOWED_PRODUCT_IMAGE_MIME) {
      expect(isAllowedProductImageType({ type, name: 'x' })).toBe(true);
    }
  });

  it('rejects types the bucket would reject server-side', () => {
    // Each of these is refused by allowed_mime_types on the bucket. Catching
    // them in the UI turns a failed upload into an instant message.
    for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/html']) {
      expect(isAllowedProductImageType({ type, name: 'x.jpg' })).toBe(false);
    }
  });

  it('MIME wins over the extension when both are present', () => {
    // A .jpg name on a PDF payload must not pass.
    expect(isAllowedProductImageType({ type: 'application/pdf', name: 'burger.jpg' })).toBe(false);
  });

  it('falls back to the extension only when MIME is absent', () => {
    expect(isAllowedProductImageType({ type: '', name: 'burger.WEBP' })).toBe(true);
    expect(isAllowedProductImageType({ type: null, name: 'burger.gif' })).toBe(false);
    expect(isAllowedProductImageType({ name: 'no-extension' })).toBe(false);
  });
});

describe('product image size gate', () => {
  it('accepts a normal file and the exact cap', () => {
    expect(isAllowedProductImageSize(1)).toBe(true);
    expect(isAllowedProductImageSize(MAX_PRODUCT_IMAGE_BYTES)).toBe(true);
  });

  it('rejects empty, oversized and non-finite sizes', () => {
    expect(isAllowedProductImageSize(0)).toBe(false);
    expect(isAllowedProductImageSize(-1)).toBe(false);
    expect(isAllowedProductImageSize(MAX_PRODUCT_IMAGE_BYTES + 1)).toBe(false);
    expect(isAllowedProductImageSize(Number.NaN)).toBe(false);
    expect(isAllowedProductImageSize(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('matches the 5 MB bucket cap exactly', () => {
    expect(MAX_PRODUCT_IMAGE_BYTES).toBe(5242880);
  });
});

describe('storage path', () => {
  it('is namespaced and carries the caller-supplied unique part', () => {
    expect(productImageStoragePath('burger.png', 'u1')).toBe('products/u1.png');
  });

  it('normalizes case and strips junk from the extension', () => {
    expect(productImageStoragePath('a.JPG', 'u')).toBe('products/u.jpg');
    expect(productImageStoragePath('a.jpeg', 'u')).toBe('products/u.jpeg');
  });

  it('defaults to jpg for a missing or unsupported extension', () => {
    expect(productImageStoragePath('noext', 'u')).toBe('products/u.jpg');
    expect(productImageStoragePath('a.gif', 'u')).toBe('products/u.jpg');
  });

  it('cannot be steered out of the products/ prefix by a hostile filename', () => {
    // The extension is the ONLY part of the name that survives, and it is
    // stripped to [a-z0-9] — so traversal and separators cannot reach the path.
    for (const name of ['../../secret.png', 'a/../../b.png', 'x.png/../y']) {
      expect(productImageStoragePath(name, 'u')).toMatch(/^products\/u\.(jpg|png)$/);
    }
  });
});

describe('path recovery from a public URL', () => {
  const base = `https://ref.supabase.co/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;

  it('recovers the path from a URL this bucket produced', () => {
    expect(productImagePathFromUrl(`${base}products/u1.jpg`)).toBe('products/u1.jpg');
  });

  it('drops a query string or fragment', () => {
    expect(productImagePathFromUrl(`${base}products/u1.jpg?t=2`)).toBe('products/u1.jpg');
    expect(productImagePathFromUrl(`${base}products/u1.jpg#x`)).toBe('products/u1.jpg');
  });

  it('returns null for a URL we do not own, so cleanup never deletes it', () => {
    // This is the important one: image_url may still hold a hand-pasted
    // external URL, and replacing that image must not try to delete somebody
    // else's object — nor an object in the BANNER bucket.
    expect(productImagePathFromUrl('https://images.unsplash.com/photo-1568901346375')).toBeNull();
    expect(productImagePathFromUrl(
      'https://ref.supabase.co/storage/v1/object/public/banner-images/banners/u.jpg',
    )).toBeNull();
    expect(productImagePathFromUrl(null)).toBeNull();
    expect(productImagePathFromUrl(undefined)).toBeNull();
    expect(productImagePathFromUrl('')).toBeNull();
  });

  it('returns null when the prefix is present but the path is empty', () => {
    expect(productImagePathFromUrl(`${base}products/`)).toBeNull();
    expect(productImagePathFromUrl(base)).toBeNull();
  });
});
