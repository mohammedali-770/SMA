#!/usr/bin/env node
/**
 * Composes the Google Play phone screenshots from the owner's device captures.
 *
 * NOT RUN BY CI, AND THAT IS DELIBERATE. The captures are JPEG and the
 * composition resamples them, so this needs a JPEG decoder and a resampler;
 * rather than add an image dependency to a repository that has so far decoded
 * PNG by hand, it drives the Chromium that is already installed for Playwright.
 * CI checks the committed OUTPUT instead — `scripts/check-play-screenshots.mjs`
 * is pure Node and asserts the geometry contract this script produces.
 *
 * Run it after replacing anything in `assets/store/screenshots/source/`:
 *
 *   node scripts/build-play-screenshots.mjs
 *   npm run play-screenshots:check
 *
 * ── WHY THE CAPTURES CANNOT BE UPLOADED RAW ──────────────────────────────────
 *
 * Play's phone screenshots must be 16:9 or 9:16, each side 320-3840 px. The
 * captures are 736 x 1600 — ratio 0.460, narrower than 9:16's 0.5625 — so Play
 * rejects the shape before anyone looks at the content. They were also taken on
 * an iPhone, and the iOS status bar is the visible tell.
 *
 * ── THE TWO TRANSFORMATIONS, BOTH MEASURED ───────────────────────────────────
 *
 * 1. CROP the top `CROP_TOP` rows. A full-width dark-pixel scan of all five
 *    captures puts the iOS status-bar glyphs at rows 42-66 in every one, and
 *    the first pixel the app itself drew at row 120 at the earliest. 90 clears
 *    the status bar with 30 rows to spare and removes nothing the app drew.
 *    The number is a property of these captures, not of iOS — re-measure it if
 *    the source device changes.
 *
 * 2. PLACE the remainder on a 1080 x 1920 canvas: exactly 9:16, with 1080 on
 *    the short side, which is Google's recommendation for listing quality. The
 *    margin is not a taste decision — `MARGIN` is the value for which all four
 *    margins come out equal given the cropped aspect ratio, and it puts the
 *    content scale at 800/736 = 1.087x, an upscale small enough to be invisible.
 *
 * ── THE ONE CONTENT EDIT, STATED RATHER THAN BURIED ──────────────────────────
 *
 * `capture-5` (checkout) carries the "online payment unavailable / cash enabled"
 * banner across source rows 212-266, clipped mid-sentence by where the customer
 * had scrolled. PR #377 removed that banner from the app on the owner's
 * instruction, so the capture advertises a notice the shipped build does not
 * render. `BANNER` splices it out: rows below it shift up, and the freed band at
 * the bottom is refilled from the capture's own bottom rows — which the script
 * ASSERTS are a single uniform colour before trusting them, so the splice cannot
 * leave a seam. Removing it makes the screenshot match the shipped app; it is
 * the only pixel of content edited anywhere in this script.
 *
 * The sources are committed beside the outputs precisely so that edit is
 * auditable rather than taken on trust.
 *
 * Requires: Playwright with a Chromium build. Point PLAYWRIGHT_CHROMIUM at the
 * binary if `chromium.launch()` cannot find one.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodePng, encodePng } from './lib/png.mjs';

/**
 * Playwright is NOT a dependency of this repository, on purpose — it is a
 * ~300 MB install that exists here only to re-compose four asset files by hand
 * a few times a year, and CI never runs this script (it checks the committed
 * output instead, with `check-play-screenshots.mjs`, which is pure Node).
 *
 * So the import is dynamic, and its failure is caught and explained. A static
 * import gives `ERR_MODULE_NOT_FOUND` on a clean checkout, which tells the
 * reader nothing about what to install or why it was not installed for them.
 * Codex raised exactly that on #384.
 */
async function loadChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error(
      'This script needs Playwright, which is deliberately not a dependency of this ' +
        'repository — see the note above this function.\n\n' +
        '  npm i --no-save playwright\n' +
        '  PLAYWRIGHT_CHROMIUM=/path/to/chrome node scripts/build-play-screenshots.mjs\n\n' +
        'CI does not run this script. It validates the committed output with ' +
        '`npm run play-screenshots:check`, which is pure Node.',
    );
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'assets/store/screenshots/source');
const TARGET_DIR = join(ROOT, 'assets/store/screenshots');

const CANVAS_W = 1080;
const CANVAS_H = 1920;
/** Equal margins on all four sides, given a 736 x 1510 cropped capture. */
const MARGIN = 140;
/** Clears the iOS status bar; see the header. */
const CROP_TOP = 90;
/** design-system `color.appLine` — warm, on-palette, deeper than the app's own cream. */
const BACKDROP = '#F0E3D4';
const RADIUS = 44;

/** Source rows removed from capture-5; see the header. `end` is exclusive. */
const BANNER = { start: 212, end: 267 };

/*
 * ── AND ONE RE-ENCODE, WHICH IS NOT COSMETIC ────────────────────────────────
 *
 * Play's contract for a screenshot is "JPEG or 24-bit PNG (no alpha)" — the
 * OPPOSITE of the store icon, which must be a "32-bit PNG (with alpha)". A
 * canvas always hands back RGBA, so `toDataURL('image/png')` writes colour type
 * 6, and an image that is fully OPAQUE still declares a channel Play refuses.
 * The canvas PNG is therefore decoded and re-encoded as colour type 2 through
 * this repository's own codec, losslessly — the alpha is uniformly 255, so
 * dropping the channel discards nothing.
 *
 * Codex caught this on the feature graphic (PR #383). The same defect was here,
 * and the checker that should have caught it asserted OPACITY while its header
 * claimed "Play does not reject an alpha channel". It does.
 */

const SHOTS = [
  { source: 'capture-1.jpg', target: 'phone-1-orders.png' },
  { source: 'capture-2.jpg', target: 'phone-2-menu.png' },
  { source: 'capture-3.jpg', target: 'phone-3-profile.png' },
  { source: 'capture-4.jpg', target: 'phone-4-item.png' },
  { source: 'capture-5.jpg', target: 'phone-5-checkout.png', splice: BANNER },
];

const present = new Set(readdirSync(SOURCE_DIR));
for (const shot of SHOTS) {
  if (!present.has(shot.source)) throw new Error(`missing source capture: ${shot.source}`);
}

const urls = SHOTS.map(
  (s) => `data:image/jpeg;base64,${readFileSync(join(SOURCE_DIR, s.source)).toString('base64')}`,
);

const chromium = await loadChromium();
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const composed = await page.evaluate(
  async ({ urls, specs, CANVAS_W, CANVAS_H, MARGIN, CROP_TOP, BACKDROP, RADIUS }) => {
    const load = (url) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`could not decode ${url.slice(0, 40)}…`));
        image.src = url;
      });

    const roundRect = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const spec = specs[i];
      const image = await load(urls[i]);

      // Stage the capture, splicing the banner out of it if this one has one.
      const stage = document.createElement('canvas');
      stage.width = image.width;
      stage.height = image.height;
      const sctx = stage.getContext('2d', { willReadFrequently: true });
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(image, 0, 0);

      let splice = null;
      if (spec.splice) {
        const band = spec.splice.end - spec.splice.start;
        // The band freed at the bottom is refilled from the capture's own
        // bottom rows. Assert they are one flat colour FIRST: if they are not,
        // the refill would be a visible seam, and a silent seam in a store
        // asset is exactly the kind of thing nobody looks at again.
        const tail = sctx.getImageData(0, image.height - band, image.width, band).data;
        const [r0, g0, b0] = [tail[0], tail[1], tail[2]];
        let deviation = 0;
        for (let p = 0; p < tail.length; p += 4) {
          deviation = Math.max(
            deviation,
            Math.abs(tail[p] - r0),
            Math.abs(tail[p + 1] - g0),
            Math.abs(tail[p + 2] - b0),
          );
        }
        if (deviation !== 0) {
          throw new Error(
            `${spec.source}: the ${band} rows above the bottom edge are not a flat colour ` +
              `(max deviation ${deviation}) — the splice would leave a seam`,
          );
        }
        const below = sctx.getImageData(0, spec.splice.end, image.width, image.height - spec.splice.end);
        sctx.putImageData(below, 0, spec.splice.start);
        sctx.fillStyle = `rgb(${r0},${g0},${b0})`;
        sctx.fillRect(0, image.height - band, image.width, band);
        splice = { band, fill: [r0, g0, b0] };
      }

      const cropH = image.height - CROP_TOP;
      const innerW = CANVAS_W - 2 * MARGIN;
      const innerH = Math.round(cropH * (innerW / image.width));
      const x = MARGIN;
      const y = Math.round((CANVAS_H - innerH) / 2);

      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // A soft lift, because the backdrop is deliberately close to the app's own
      // cream and the card would otherwise have no edge at all.
      ctx.save();
      ctx.shadowColor = 'rgba(70, 44, 22, 0.20)';
      ctx.shadowBlur = 46;
      ctx.shadowOffsetY = 14;
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, x, y, innerW, innerH, RADIUS);
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRect(ctx, x, y, innerW, innerH, RADIUS);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(stage, 0, CROP_TOP, image.width, cropH, x, y, innerW, innerH);
      ctx.restore();

      ctx.save();
      roundRect(ctx, x + 0.75, y + 0.75, innerW - 1.5, innerH - 1.5, RADIUS - 0.75);
      ctx.strokeStyle = 'rgba(36, 20, 54, 0.10)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      results.push({
        target: spec.target,
        dataUrl: canvas.toDataURL('image/png'),
        geometry: { srcW: image.width, srcH: image.height, cropH, innerW, innerH, x, y },
        splice,
      });
    }
    return results;
  },
  { urls, specs: SHOTS, CANVAS_W, CANVAS_H, MARGIN, CROP_TOP, BACKDROP, RADIUS },
);

await browser.close();

mkdirSync(TARGET_DIR, { recursive: true });
for (const result of composed) {
  const canvasPng = Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64');

  const decoded = decodePng(canvasPng);
  for (let i = 3; i < decoded.pixels.length; i += 4) {
    if (decoded.pixels[i] !== 0xff) {
      throw new Error(
        `${result.target}: the canvas produced a transparent pixel — the composition should cover the whole canvas`,
      );
    }
  }
  const png = encodePng({ ...decoded, colorType: 2 });
  // Read the colour-type byte back out of the encoded buffer rather than
  // trusting the argument just passed: offset 25 is what Play reads.
  if (png[25] !== 2) {
    throw new Error(`${result.target}: encoded colour type ${png[25]}, expected 2 (RGB, no alpha)`);
  }
  writeFileSync(join(TARGET_DIR, result.target), png);
  const { cropH, innerW, innerH, x, y } = result.geometry;
  const spliceNote = result.splice
    ? `, spliced ${result.splice.band} rows, refilled rgb(${result.splice.fill})`
    : '';
  console.log(
    `✔ ${result.target} — ${CANVAS_W}x${CANVAS_H}, ${png.length} bytes ` +
      `(crop ${cropH} rows, placed ${innerW}x${innerH} at ${x},${y}${spliceNote})`,
  );
}
