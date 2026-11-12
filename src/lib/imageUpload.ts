/**
 * What the console does to a menu or banner photo before uploading it — the
 * pure decisions only (no DOM, no Supabase), so `imageUpload.test.ts`,
 * `productImages.test.ts` and `banners.test.ts` can pin them. The browser half
 * that applies them is `imageUploadBrowser.ts`.
 *
 * Why. Photos were stored exactly as picked: a 28 MP phone JPEG of about 1 MB
 * for a 104x129 px menu card. Home transferred 3.1 MB of photos for four
 * thumbnails, and each decoded to ~107 MB in the browser. Re-encoding the same
 * photos at 1200 px WebP measured 60-117 KB each (-89% to -94%).
 *
 * 1200 px is the longest edge the app can use: the product hero is 390 pt wide
 * on the largest phone, at 3x. Anything larger is bytes nobody sees.
 */

/** Longest edge, in pixels, of a stored photo. */
export const UPLOAD_IMAGE_MAX_EDGE = 1200;
/** A photo within the pixel bound AND at or under this size is uploaded untouched. */
export const UPLOAD_IMAGE_KEEP_MAX_BYTES = 300 * 1024;
export const WEBP_QUALITY = 0.8;
export const JPEG_QUALITY = 0.85;

/**
 * `cacheControl` for every uploaded image, in seconds: one year.
 *
 * Safe ONLY because an upload never reuses a path: `productImageStoragePath` and
 * `bannerStoragePath` name each object by timestamp + UUID, and the upload is
 * `upsert: false`, so a replaced photo is a new URL rather than new bytes under
 * an old one. If that rule ever changes, this must come down with it.
 */
export const UPLOADED_IMAGE_CACHE_CONTROL = '31536000';

export type UploadMime = 'image/webp' | 'image/jpeg' | 'image/png';

export interface Size {
  width: number;
  height: number;
}

/** `size` scaled down to fit `maxEdge` on its longest side, aspect kept. Never scales up. */
export function fitWithin({ width, height }: Size, maxEdge = UPLOAD_IMAGE_MAX_EDGE): Size {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type UploadPlan = { action: 'keep' } | { action: 'encode'; target: Size };

/**
 * Keep the original when it is already within bounds — small enough in pixels
 * AND in bytes. A 1000 px PNG photograph can still be 2 MB, which is the cost
 * this exists to remove, so pixels alone do not decide.
 */
export function planImageUpload(
  input: Size & { bytes: number },
  maxEdge = UPLOAD_IMAGE_MAX_EDGE,
  keepMaxBytes = UPLOAD_IMAGE_KEEP_MAX_BYTES,
): UploadPlan {
  const fits = Math.max(input.width, input.height) <= maxEdge;
  if (fits && input.bytes <= keepMaxBytes) return { action: 'keep' };
  return { action: 'encode', target: fitWithin(input, maxEdge) };
}

/**
 * Encodings to try, best first. WebP carries alpha, so it serves both cases;
 * when the browser cannot encode WebP, a transparent source falls back to PNG
 * (alpha kept) and an opaque one to JPEG.
 */
export function encodingsToTry(hasAlpha: boolean): { mime: UploadMime; quality?: number }[] {
  return [
    { mime: 'image/webp', quality: WEBP_QUALITY },
    hasAlpha ? { mime: 'image/png' } : { mime: 'image/jpeg', quality: JPEG_QUALITY },
  ];
}

/**
 * Whether an encoder honoured the requested type. `canvas.toBlob` does not fail
 * on an unsupported type — it silently returns a PNG — so the blob's own type is
 * the only evidence.
 */
export function encoderHonoured(requested: UploadMime, blobType: string | null | undefined): boolean {
  return (blobType ?? '').toLowerCase() === requested;
}

/** Both buckets cap an object at 5 MB; an encoding above it would be refused. */
export const UPLOAD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload the encoded result, or the original? The encoded one wins when the
 * original was too large in pixels, and otherwise only when it is smaller:
 * re-encoding an already-tight file can make it bigger. An encoding the bucket
 * would refuse never wins; the original has already passed the size gate.
 */
export function chooseUpload(input: {
  originalBytes: number;
  originalFits: boolean;
  encodedBytes: number;
}): 'encoded' | 'original' {
  if (input.encodedBytes > UPLOAD_IMAGE_MAX_BYTES) return 'original';
  if (!input.originalFits) return 'encoded';
  return input.encodedBytes < input.originalBytes ? 'encoded' : 'original';
}

export function extensionForMime(mime: UploadMime): 'webp' | 'jpg' | 'png' {
  return mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
}

/** `name` with its extension replaced to match `mime`, so the storage path's extension tells the truth. */
export function renameForMime(name: string, mime: UploadMime): string {
  const base = name.replace(/\.[^./\\]*$/, '') || 'image';
  return `${base}.${extensionForMime(mime)}`;
}

/** Whether any pixel of RGBA data is not fully opaque. */
export function hasTransparency(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
}

/**
 * Only PNG and WebP can carry alpha among the accepted types; a JPEG never needs
 * the scan. By MIME type when present, else by extension — the same order the
 * type gates use.
 */
export function mayHaveAlpha(input: { type?: string | null; name?: string | null }): boolean {
  const type = (input.type ?? '').toLowerCase();
  if (type) return type === 'image/png' || type === 'image/webp';
  return /\.(png|webp)$/i.test(input.name ?? '');
}

/**
 * Intermediate sizes for a large downscale, halving while the remaining factor
 * exceeds 2, then the target. One bilinear step from 5305 px to 1200 px skips
 * most source pixels and aliases; halving steps average all of them.
 */
export function downscaleSteps(from: Size, to: Size): Size[] {
  const steps: Size[] = [];
  let { width, height } = from;
  while (
    width / 2 >= to.width &&
    height / 2 >= to.height &&
    (width > to.width * 2 || height > to.height * 2)
  ) {
    width = Math.max(to.width, Math.round(width / 2));
    height = Math.max(to.height, Math.round(height / 2));
    steps.push({ width, height });
  }
  const last = steps[steps.length - 1];
  if (!last || last.width !== to.width || last.height !== to.height) steps.push({ ...to });
  return steps;
}
