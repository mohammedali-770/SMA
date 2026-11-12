import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  UPLOAD_IMAGE_KEEP_MAX_BYTES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_IMAGE_MAX_EDGE,
  UPLOADED_IMAGE_CACHE_CONTROL,
  WEBP_QUALITY,
  chooseUpload,
  downscaleSteps,
  encoderHonoured,
  encodingsToTry,
  extensionForMime,
  fitWithin,
  hasTransparency,
  mayHaveAlpha,
  planImageUpload,
  renameForMime,
} from './imageUpload';

describe('fitWithin', () => {
  it('caps the longest edge at 1200 px and keeps the aspect ratio', () => {
    expect(UPLOAD_IMAGE_MAX_EDGE).toBe(1200);
    expect(fitWithin({ width: 5305, height: 5305 })).toEqual({ width: 1200, height: 1200 });
    expect(fitWithin({ width: 4032, height: 3024 })).toEqual({ width: 1200, height: 900 });
    expect(fitWithin({ width: 3024, height: 4032 })).toEqual({ width: 900, height: 1200 });
  });

  it('never scales up', () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(fitWithin({ width: 1200, height: 10 })).toEqual({ width: 1200, height: 10 });
  });

  it('never rounds an edge to zero', () => {
    expect(fitWithin({ width: 10_000, height: 2 })).toEqual({ width: 1200, height: 1 });
  });
});

describe('planImageUpload — keep or convert', () => {
  it('keeps a photo already within bounds in pixels and bytes', () => {
    expect(planImageUpload({ width: 1200, height: 800, bytes: UPLOAD_IMAGE_KEEP_MAX_BYTES })).toEqual({
      action: 'keep',
    });
  });

  it('converts the measured case: a 28 MP, ~1 MB phone JPEG', () => {
    expect(planImageUpload({ width: 5305, height: 5305, bytes: 1_008_283 })).toEqual({
      action: 'encode',
      target: { width: 1200, height: 1200 },
    });
  });

  it('re-encodes at the same size when only the bytes are out of bounds', () => {
    expect(planImageUpload({ width: 1000, height: 1000, bytes: 2_000_000 })).toEqual({
      action: 'encode',
      target: { width: 1000, height: 1000 },
    });
  });

  it('converts a small file that is too large in pixels', () => {
    expect(planImageUpload({ width: 1201, height: 100, bytes: 1_000 }).action).toBe('encode');
  });
});

describe('output type', () => {
  it('tries WebP at q0.8 first, whether or not the source has alpha', () => {
    expect(WEBP_QUALITY).toBe(0.8);
    expect(encodingsToTry(false)[0]).toEqual({ mime: 'image/webp', quality: 0.8 });
    expect(encodingsToTry(true)[0]).toEqual({ mime: 'image/webp', quality: 0.8 });
  });

  it('falls back to JPEG for an opaque source and PNG for a transparent one', () => {
    expect(encodingsToTry(false)[1].mime).toBe('image/jpeg');
    expect(encodingsToTry(true)[1].mime).toBe('image/png');
    expect(encodingsToTry(true)).toHaveLength(2);
  });

  it('detects the silent PNG an encoder returns for an unsupported type', () => {
    expect(encoderHonoured('image/webp', 'image/webp')).toBe(true);
    expect(encoderHonoured('image/webp', 'image/png')).toBe(false);
    expect(encoderHonoured('image/webp', '')).toBe(false);
    expect(encoderHonoured('image/jpeg', null)).toBe(false);
  });

  it('detects transparency from RGBA data', () => {
    expect(hasTransparency([0, 0, 0, 255, 9, 9, 9, 255])).toBe(false);
    expect(hasTransparency([0, 0, 0, 255, 9, 9, 9, 254])).toBe(true);
  });

  it('only scans PNG and WebP for alpha, by MIME then extension', () => {
    expect(mayHaveAlpha({ type: 'image/png' })).toBe(true);
    expect(mayHaveAlpha({ type: 'image/webp' })).toBe(true);
    expect(mayHaveAlpha({ type: 'image/jpeg', name: 'x.png' })).toBe(false);
    expect(mayHaveAlpha({ type: '', name: 'logo.PNG' })).toBe(true);
    expect(mayHaveAlpha({ type: '', name: 'x.jpg' })).toBe(false);
  });
});

describe('chooseUpload', () => {
  it('always takes the encoding when the original was too large in pixels', () => {
    expect(chooseUpload({ originalBytes: 100, originalFits: false, encodedBytes: 200 })).toBe('encoded');
  });

  it('keeps the original when a same-size re-encode is not smaller', () => {
    expect(chooseUpload({ originalBytes: 400_000, originalFits: true, encodedBytes: 400_000 })).toBe(
      'original',
    );
    expect(chooseUpload({ originalBytes: 400_000, originalFits: true, encodedBytes: 90_000 })).toBe(
      'encoded',
    );
  });

  it('never takes an encoding the bucket would refuse', () => {
    expect(
      chooseUpload({ originalBytes: 1, originalFits: false, encodedBytes: UPLOAD_IMAGE_MAX_BYTES + 1 }),
    ).toBe('original');
  });
});

describe('name and extension', () => {
  it('maps each output type to the extension the storage path keeps', () => {
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
  });

  it('renames so the extension tells the truth', () => {
    expect(renameForMime('IMG_0042.JPG', 'image/webp')).toBe('IMG_0042.webp');
    expect(renameForMime('burger.final.png', 'image/jpeg')).toBe('burger.final.jpg');
    expect(renameForMime('noext', 'image/webp')).toBe('noext.webp');
    expect(renameForMime('.png', 'image/webp')).toBe('image.webp');
  });
});

describe('downscaleSteps', () => {
  it('halves while the remaining factor exceeds 2, then lands exactly on the target', () => {
    expect(downscaleSteps({ width: 5305, height: 5305 }, { width: 1200, height: 1200 })).toEqual([
      { width: 2653, height: 2653 },
      { width: 1327, height: 1327 },
      { width: 1200, height: 1200 },
    ]);
  });

  it('is a single step for a small factor, or for a same-size re-encode', () => {
    expect(downscaleSteps({ width: 2000, height: 1500 }, { width: 1200, height: 900 })).toEqual([
      { width: 1200, height: 900 },
    ]);
    expect(downscaleSteps({ width: 900, height: 900 }, { width: 900, height: 900 })).toEqual([
      { width: 900, height: 900 },
    ]);
  });
});

describe('cache lifetime of an uploaded image', () => {
  it('is one year, because no upload reuses a path', () => {
    expect(UPLOADED_IMAGE_CACHE_CONTROL).toBe('31536000');
  });

  it('is what BOTH upload calls send, after re-encoding and with upsert off', () => {
    const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
    const uploads = [...api.matchAll(/\.upload\(path, file, \{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(uploads).toHaveLength(2);
    for (const options of uploads) {
      expect(options).toContain('cacheControl: UPLOADED_IMAGE_CACHE_CONTROL');
      expect(options).toContain('upsert: false');
    }
    expect(api).not.toMatch(/cacheControl:\s*'3600'/);
    expect(api).toContain('prepareImageForUpload(picked, planBannerUpload)');
    expect(api).toContain('prepareImageForUpload(picked, planProductImageUpload)');
  });
});
