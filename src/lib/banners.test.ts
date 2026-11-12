import { describe, it, expect } from 'vitest';
import {
  isAllowedBannerSize, isAllowedBannerType, bannerStoragePath, selectActiveBanners,
  MAX_BANNER_BYTES, BANNER_MAX_EDGE, planBannerUpload, type ActiveBannerRow,
} from './banners';

const NOW = Date.parse('2026-07-12T12:00:00Z');
const past = (d: string) => d; // readability helper
const row = (over: Partial<ActiveBannerRow> & { id?: string; sort_order?: number; created_at?: string }): ActiveBannerRow & { id: string } => ({
  id: over.id ?? 'x',
  is_active: over.is_active ?? true,
  sort_order: over.sort_order ?? 0,
  created_at: over.created_at ?? '2026-07-01T00:00:00Z',
  starts_at: over.starts_at ?? null,
  ends_at: over.ends_at ?? null,
});

describe('selectActiveBanners', () => {
  it('hides nothing wrong: no rows -> empty', () => {
    expect(selectActiveBanners([], NOW)).toEqual([]);
  });

  it('shows a single active banner with null dates', () => {
    const rows = [row({ id: 'a' })];
    expect(selectActiveBanners(rows, NOW).map((b) => b.id)).toEqual(['a']);
  });

  it('hides inactive banners', () => {
    const rows = [row({ id: 'on' }), row({ id: 'off', is_active: false })];
    expect(selectActiveBanners(rows, NOW).map((b) => b.id)).toEqual(['on']);
  });

  it('hides expired banners (ends_at in the past)', () => {
    const rows = [row({ id: 'live' }), row({ id: 'expired', ends_at: past('2026-07-10T00:00:00Z') })];
    expect(selectActiveBanners(rows, NOW).map((b) => b.id)).toEqual(['live']);
  });

  it('hides future banners (starts_at in the future)', () => {
    const rows = [row({ id: 'live' }), row({ id: 'future', starts_at: '2026-08-01T00:00:00Z' })];
    expect(selectActiveBanners(rows, NOW).map((b) => b.id)).toEqual(['live']);
  });

  it('shows a banner inside its start/end window', () => {
    const rows = [row({ id: 'inwin', starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-07-31T00:00:00Z' })];
    expect(selectActiveBanners(rows, NOW).map((b) => b.id)).toEqual(['inwin']);
  });

  it('orders by sort_order asc, then created_at desc as a fallback', () => {
    const rows = [
      row({ id: 'c', sort_order: 2, created_at: '2026-07-05T00:00:00Z' }),
      row({ id: 'a', sort_order: 0, created_at: '2026-07-01T00:00:00Z' }),
      row({ id: 'b1', sort_order: 1, created_at: '2026-07-02T00:00:00Z' }),
      row({ id: 'b2', sort_order: 1, created_at: '2026-07-09T00:00:00Z' }), // same order, newer -> first
    ];
    expect(selectActiveBanners(rows, NOW).map((b) => b.id)).toEqual(['a', 'b2', 'b1', 'c']);
  });
});

describe('isAllowedBannerType', () => {
  it('accepts jpg/jpeg/png/webp by MIME', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(isAllowedBannerType({ type: t })).toBe(true);
    }
  });
  it('accepts by extension when MIME is absent', () => {
    for (const n of ['a.jpg', 'a.JPEG', 'a.png', 'a.webp']) {
      expect(isAllowedBannerType({ name: n })).toBe(true);
    }
  });
  it('rejects gif/svg/pdf and unknown', () => {
    expect(isAllowedBannerType({ type: 'image/gif' })).toBe(false);
    expect(isAllowedBannerType({ type: 'image/svg+xml' })).toBe(false);
    expect(isAllowedBannerType({ name: 'a.pdf' })).toBe(false);
    expect(isAllowedBannerType({})).toBe(false);
  });
});

describe('isAllowedBannerSize', () => {
  it('accepts within the 5 MB cap, rejects empty and oversized', () => {
    expect(isAllowedBannerSize(1024)).toBe(true);
    expect(isAllowedBannerSize(MAX_BANNER_BYTES)).toBe(true);
    expect(isAllowedBannerSize(MAX_BANNER_BYTES + 1)).toBe(false);
    expect(isAllowedBannerSize(0)).toBe(false);
    expect(isAllowedBannerSize(NaN)).toBe(false);
  });
});

describe('bannerStoragePath', () => {
  it('builds a unique, sanitized path and defaults to jpg', () => {
    expect(bannerStoragePath('promo.PNG', 'u1')).toBe('banners/u1.png');
    expect(bannerStoragePath('promo.webp', 'u2')).toBe('banners/u2.webp');
    expect(bannerStoragePath('no-ext', 'u3')).toBe('banners/u3.jpg');
    expect(bannerStoragePath('weird.exe', 'u4')).toBe('banners/u4.jpg'); // unsupported ext -> jpg
  });
  it('never reuses the same path for different unique ids', () => {
    expect(bannerStoragePath('a.jpg', 'A')).not.toBe(bannerStoragePath('a.jpg', 'B'));
  });
});

describe('banner resize decision', () => {
  it('bounds a stored banner at a full-width banner, 390 pt at 3x', () => {
    expect(BANNER_MAX_EDGE).toBe(1200);
  });

  it('scales a wide banner down by its longest edge', () => {
    expect(planBannerUpload({ width: 3000, height: 1000, bytes: 900_000 })).toEqual({
      action: 'encode',
      target: { width: 1200, height: 400 },
    });
  });

  it('leaves an already-small banner alone', () => {
    expect(planBannerUpload({ width: 1170, height: 420, bytes: 120_000 })).toEqual({ action: 'keep' });
  });

  it('stores a re-encoded WebP under a .webp path', () => {
    expect(bannerStoragePath('hero.webp', '1-u')).toBe('banners/1-u.webp');
  });
});
