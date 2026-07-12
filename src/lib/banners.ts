/**
 * Homepage-banner shared logic (pure — no Supabase, no React), so both the
 * admin dashboard and the unit tests use the exact same rules the mobile app
 * relies on server-side via RLS: which banners are "live", how they sort, and
 * what image files are accepted for upload.
 */
export const BANNER_BUCKET = 'banner-images';
export const MAX_BANNER_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors the bucket cap.
export const ALLOWED_BANNER_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_BANNER_EXT = ['jpg', 'jpeg', 'png', 'webp'] as const;

/** Accept only jpg/jpeg/png/webp — by MIME type when present, else by extension. */
export function isAllowedBannerType(input: { type?: string | null; name?: string | null }): boolean {
  const type = (input.type ?? '').toLowerCase();
  if (type) return (ALLOWED_BANNER_MIME as readonly string[]).includes(type);
  const ext = (input.name ?? '').split('.').pop()?.toLowerCase() ?? '';
  return (ALLOWED_BANNER_EXT as readonly string[]).includes(ext);
}

/** Reject empty and oversized files (<= 5 MB). */
export function isAllowedBannerSize(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_BANNER_BYTES;
}

/**
 * Unique, collision-safe object path (never overwrites an existing image).
 * `unique` is injected by the caller (timestamp + uuid) so this stays pure and
 * testable; the extension is sanitized and defaults to jpg.
 */
export function bannerStoragePath(originalName: string, unique: string): string {
  const raw = (originalName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = (ALLOWED_BANNER_EXT as readonly string[]).includes(raw) ? raw : 'jpg';
  return `banners/${unique}.${ext}`;
}

export interface ActiveBannerRow {
  is_active: boolean;
  sort_order: number;
  created_at: string;
  starts_at: string | null;
  ends_at: string | null;
}

/**
 * The banners a customer should currently see, in display order:
 *   is_active AND (starts_at is null OR starts_at <= now) AND (ends_at is null OR ends_at >= now)
 * sorted by sort_order ASC, then created_at DESC as a stable fallback.
 *
 * The mobile app relies on RLS to enforce this server-side; this mirror keeps
 * the dashboard preview honest and is what the tests exercise.
 */
export function selectActiveBanners<T extends ActiveBannerRow>(rows: readonly T[], nowMs: number): T[] {
  return rows
    .filter(
      (b) =>
        b.is_active &&
        (b.starts_at == null || Date.parse(b.starts_at) <= nowMs) &&
        (b.ends_at == null || Date.parse(b.ends_at) >= nowMs),
    )
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || Date.parse(b.created_at) - Date.parse(a.created_at));
}
