#!/usr/bin/env node
/**
 * Validates the Google Play phone screenshots in `assets/store/screenshots/`.
 *
 * Play's phone-screenshot contract: PNG or JPEG, at most 8 MB each, a 16:9 or
 * 9:16 aspect ratio, each side between 320 and 3840 px, and between 2 and 8
 * images. The owner's device captures are 736 x 1600 — ratio 0.460, narrower
 * than 9:16 — so they cannot be uploaded raw, and the whole point of
 * `build-play-screenshots.mjs` is to conform them. This asserts the result.
 *
 * WHAT THIS CAN AND CANNOT PROVE. It proves geometry and format, and it proves
 * the composition ran: a raw capture dropped into this directory has no uniform
 * backdrop border and fails. It does NOT prove the iOS status bar was cropped,
 * or that the image shows this app at all — those are judgement calls that live
 * in review, not in a byte check. Saying so here is the point; a check whose
 * limits are not written down gets read as proving more than it does.
 *
 * Pure Node — the PNG codec is `scripts/lib/png.mjs`, shared with
 * `build-logo-mark.mjs` and `build-play-icon.mjs`. There is deliberately no
 * generator half here: composing the screenshots needs a JPEG decoder and a
 * resampler, which is why that script uses a browser and does not run in CI.
 *
 * Usage: node scripts/check-play-screenshots.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets/store/screenshots');

/** Exactly 9:16 at 1080 on the short side — Google's recommended minimum. */
const WIDTH = 1080;
const HEIGHT = 1920;
/** Play's per-image ceiling. */
const MAX_BYTES = 8 * 1024 * 1024;
/** Play accepts 2 to 8 phone screenshots. */
const MIN_COUNT = 2;
const MAX_COUNT = 8;

/**
 * The canvas margin and backdrop from `build-play-screenshots.mjs`. Duplicated
 * rather than imported because that script needs Playwright, which CI does not
 * install — importing it would make this check unrunnable there. The two are
 * pinned together by this check failing if either drifts.
 */
const MARGIN = 140;
const BACKDROP = [0xf0, 0xe3, 0xd4];

const failures = [];

const files = readdirSync(DIR)
  .filter((n) => n.endsWith('.png'))
  .sort();

if (files.length < MIN_COUNT || files.length > MAX_COUNT) {
  failures.push(`${files.length} screenshots — Play accepts ${MIN_COUNT} to ${MAX_COUNT}`);
}

for (const name of files) {
  const bytes = readFileSync(join(DIR, name));
  if (bytes.length > MAX_BYTES) {
    failures.push(`${name}: ${bytes.length} bytes, over Play's ${MAX_BYTES} limit`);
    continue;
  }

  let png;
  try {
    png = decodePng(bytes);
  } catch (error) {
    failures.push(`${name}: not a PNG this codec can read — ${error.message}`);
    continue;
  }

  const { width, height, pixels } = png;
  if (width !== WIDTH || height !== HEIGHT) {
    failures.push(`${name}: ${width}x${height}, expected ${WIDTH}x${HEIGHT}`);
    continue;
  }

  // Opaque throughout. Play does not reject an alpha channel, but a screenshot
  // with a transparent region composites against an unknown ground in the
  // listing, so it is never what was intended.
  let firstTransparent = null;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0xff) {
      const p = (i - 3) / 4;
      firstTransparent = `${p % width},${Math.floor(p / width)}`;
      break;
    }
  }
  if (firstTransparent) failures.push(`${name}: transparent pixel at ${firstTransparent}`);

  // The backdrop border. Sampled on the four mid-edges rather than swept: the
  // composition fills the whole canvas before drawing, so a single row per side
  // separates a composed image from a raw capture, and a full sweep of four
  // 1080x1920 images buys nothing for the time.
  const at = (x, y) => {
    const o = (y * width + x) * 4;
    return [pixels[o], pixels[o + 1], pixels[o + 2]];
  };
  const probes = [
    ['top', at(width >> 1, MARGIN >> 1)],
    ['bottom', at(width >> 1, height - (MARGIN >> 1))],
    ['left', at(MARGIN >> 1, height >> 1)],
    ['right', at(width - (MARGIN >> 1), height >> 1)],
  ];
  for (const [side, rgb] of probes) {
    if (rgb[0] !== BACKDROP[0] || rgb[1] !== BACKDROP[1] || rgb[2] !== BACKDROP[2]) {
      failures.push(
        `${name}: ${side} margin is rgb(${rgb}), expected the backdrop rgb(${BACKDROP}) — ` +
          'was this composed by build-play-screenshots.mjs?',
      );
    }
  }
}

if (failures.length > 0) {
  console.error('✖ Play phone screenshots do not meet the store contract:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `✔ ${files.length} Play phone screenshots are ${WIDTH}x${HEIGHT} (9:16), opaque, under ${MAX_BYTES} bytes`,
);
