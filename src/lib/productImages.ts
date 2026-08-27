/**
 * Product-image shared logic (pure — no Supabase, no React), so the admin
 * dashboard and the unit tests apply exactly the same rules the bucket enforces
 * server-side: which files are accepted, and where an object is written.
 *
 * Deliberately parallel to `banners.ts`. The two buckets behave identically and
 * are kept separate on purpose (see the migration header): a cleanup that
 * empties banners must not be able to delete the menu's photography.
 */
export const PRODUCT_IMAGE_BUCKET = 'product-images';
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors the bucket cap.
export const ALLOWED_PRODUCT_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_PRODUCT_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'] as const;

/** Accept only jpg/jpeg/png/webp — by MIME type when present, else by extension. */
export function isAllowedProductImageType(input: { type?: string | null; name?: string | null }): boolean {
  const type = (input.type ?? '').toLowerCase();
  if (type) return (ALLOWED_PRODUCT_IMAGE_MIME as readonly string[]).includes(type);
  const ext = (input.name ?? '').split('.').pop()?.toLowerCase() ?? '';
  return (ALLOWED_PRODUCT_IMAGE_EXT as readonly string[]).includes(ext);
}

/** Reject empty and oversized files (<= 5 MB). */
export function isAllowedProductImageSize(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_PRODUCT_IMAGE_BYTES;
}

/**
 * Unique, collision-safe object path (never overwrites an existing image).
 * `unique` is injected by the caller (timestamp + uuid) so this stays pure and
 * testable; the extension is sanitized and defaults to jpg.
 *
 * The product id is NOT part of the path. Replacing a product's photo writes a
 * new object and repoints `image_url`, so an id-keyed path would have to be
 * overwritten in place — which breaks CDN caching and destroys the previous
 * image before the new row is saved.
 */
export function productImageStoragePath(originalName: string, unique: string): string {
  const raw = (originalName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = (ALLOWED_PRODUCT_IMAGE_EXT as readonly string[]).includes(raw) ? raw : 'jpg';
  return `products/${unique}.${ext}`;
}

/**
 * The storage path for a public URL previously produced by this bucket, or null
 * when the URL did not come from here.
 *
 * Used to clean up the old object when an image is replaced. It returns null for
 * a hand-pasted external URL (Unsplash, a supplier's CDN), which is the point:
 * `image_url` is still allowed to hold any URL, and we must never attempt to
 * delete something we do not own.
 */
export function productImagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split(/[?#]/)[0];
  return path.startsWith('products/') && path.length > 'products/'.length ? path : null;
}
