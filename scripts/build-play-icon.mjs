#!/usr/bin/env node
/**
 * Generates the Google Play store icon from the app icon master.
 *
 * Play requires the store listing icon to be exactly 512 x 512, 32-bit PNG, at
 * most 1 MB. Every icon in this repository is 1024 x 1024, so nothing here
 * satisfied that requirement and the listing could not be completed — see
 * `docs/OWNER_ACTIONS.md` §38. Apple takes the 1024 master directly, which is
 * why this gap survived: the iOS path never needed a second size.
 *
 * 1024 -> 512 is an exact 2:1 reduction, so each output pixel is the mean of a
 * whole 2x2 block with no resampling kernel, no interpolation and no edge case.
 * That is the entire reason this can be done correctly in a few lines instead of
 * pulling in an image library.
 *
 * The averaging is done in PREMULTIPLIED alpha. Today's master is fully opaque
 * (asserted below), so the two are identical — but averaging straight RGBA is
 * wrong the moment a master has soft edges, because a transparent pixel's colour
 * channels are meaningless and would still drag the mean. Getting it right now
 * costs five lines and removes a trap from whoever replaces the artwork.
 *
 * Pure Node — the PNG codec is `scripts/lib/png.mjs`, shared with
 * `build-logo-mark.mjs`.
 *
 * Usage: node scripts/build-play-icon.mjs [--check]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The app icon master. Never overwritten by this script. */
const SOURCE = join(ROOT, 'assets/icon.png');

/** What is uploaded to Play Console -> Store listing -> Graphics -> App icon. */
const TARGET = join(ROOT, 'assets/store/play-icon-512.png');

const EDGE = 512;
/** Play's hard ceiling for the store icon. */
const MAX_BYTES = 1024 * 1024;

/**
 * Box-downscales by an exact integer factor, averaging in premultiplied alpha.
 * Rejects a non-integer ratio rather than silently resampling: a store icon is
 * not the place to discover that a master was re-exported at an odd size.
 */
function downscale({ width, height, pixels }, edge) {
  if (width !== height) throw new Error(`master must be square, got ${width}x${height}`);
  if (width % edge !== 0) throw new Error(`${width} is not an integer multiple of ${edge}`);

  const factor = width / edge;
  const area = factor * factor;
  const out = Buffer.alloc(edge * edge * 4);

  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * width + (x * factor + dx)) * 4;
          const alpha = pixels[i + 3];
          r += pixels[i] * alpha;
          g += pixels[i + 1] * alpha;
          b += pixels[i + 2] * alpha;
          a += alpha;
        }
      }

      const o = (y * edge + x) * 4;
      // Un-premultiply against the summed alpha, not the averaged one, so the
      // division cancels exactly. A fully transparent block leaves black/0.
      out[o] = a === 0 ? 0 : Math.round(r / a);
      out[o + 1] = a === 0 ? 0 : Math.round(g / a);
      out[o + 2] = a === 0 ? 0 : Math.round(b / a);
      out[o + 3] = Math.round(a / area);
    }
  }

  return { width: edge, height: edge, pixels: out };
}

const check = process.argv.includes('--check');

const master = decodePng(readFileSync(SOURCE));

// Play applies its own shape mask and background, so the icon it is given must
// be opaque. Asserting it here means a future master with a knocked-out
// backdrop fails this script instead of failing review.
for (let i = 3; i < master.pixels.length; i += 4) {
  if (master.pixels[i] !== 0xff) {
    throw new Error(`${SOURCE} must be fully opaque for a store icon; found alpha ${master.pixels[i]}`);
  }
}

const icon = encodePng(downscale(master, EDGE));

if (icon.length > MAX_BYTES) {
  throw new Error(`generated icon is ${icon.length} bytes, over Play's ${MAX_BYTES} limit`);
}

let current = null;
try {
  current = readFileSync(TARGET);
} catch {
  /* not generated yet */
}

if (current && current.equals(icon)) {
  if (check) console.log('✔ Play store icon is up to date');
  process.exit(0);
}

if (check) {
  console.error(`✖ ${TARGET} is out of date — run: node scripts/build-play-icon.mjs`);
  process.exit(1);
}

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, icon);
console.log(`✔ wrote ${TARGET} (${EDGE}x${EDGE}, ${icon.length} bytes)`);
