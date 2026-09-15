#!/usr/bin/env node
/**
 * Generates the transparent-background brand mark from the official logo master.
 *
 * The master (`public/logo.png`) is the approved chef-rooster artwork drawn on a
 * flat white square. That square is fine for the iOS/Android store icons, which
 * must stay opaque, but it renders as a bright white tile on the app's dark
 * surfaces. This script derives `logo-mark.png` — the same artwork with the
 * surrounding white knocked out — for use in the UI.
 *
 * The mascot's body and chef hat are themselves white, so a naive
 * "every white pixel becomes transparent" pass would hollow the bird out. We
 * instead flood-fill inwards from the image border and only clear white that is
 * reachable from outside, which leaves every enclosed white region opaque.
 *
 * Anti-aliased outline pixels are a blend of navy ink and the white backdrop.
 * They get a proportional alpha and their colour is un-blended back towards the
 * ink, otherwise the removed white survives as a pale halo on dark backgrounds.
 *
 * Pure Node — no image dependency. Reads and writes 8-bit RGBA, non-interlaced
 * PNG, which is what every logo asset in this repository already is.
 *
 * Usage: node scripts/build-logo-mark.mjs [--check]
 */
import { decodePng, encodePng } from './lib/png.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The approved master artwork. Never overwritten by this script. */
const SOURCE = join(ROOT, 'public/logo.png');

/** Every copy of the derived mark. Kept byte-identical so all surfaces match. */
const TARGETS = [
  join(ROOT, 'public/logo-mark.png'),
  join(ROOT, 'assets/logo-mark.png'),
  join(ROOT, 'apps/mobile/assets/logo-mark.png'),
];

/** Luminance at or above this is treated as pure backdrop and fully cleared. */
const OPAQUE_WHITE = 250;
/** Below this the pixel is ink, so the flood fill stops rather than eating the outline. */
const INK_EDGE = 200;
/** Backdrop is neutral grey; a wider channel spread means it is tinted artwork. */
const MAX_TINT = 12;
/** Transparent margin kept around the trimmed artwork, as a fraction of its longest side. */
const MARGIN = 0.03;


/**
 * Clears the backdrop that is reachable from the image border, leaving white
 * that is enclosed by the outline (the bird's body, the chef hat) untouched.
 */
function knockOutBackdrop({ width, height, pixels }) {
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isBackdrop = (index) => {
    const p = index * 4;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    // Rec. 601 luma — matches how the eye weights the navy outline against white.
    const luma = (0.299 * r) + (0.587 * g) + (0.114 * b);
    return spread <= MAX_TINT && luma >= INK_EDGE;
  };

  const push = (x, y) => {
    const index = (y * width) + x;
    if (seen[index] || !isBackdrop(index)) return;
    seen[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;

    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  for (let index = 0; index < seen.length; index++) {
    if (!seen[index]) continue;
    const p = index * 4;
    const luma = (0.299 * pixels[p]) + (0.587 * pixels[p + 1]) + (0.114 * pixels[p + 2]);

    if (luma >= OPAQUE_WHITE) {
      pixels[p] = 0;
      pixels[p + 1] = 0;
      pixels[p + 2] = 0;
      pixels[p + 3] = 0;
      continue;
    }

    // Anti-aliased edge: the stored colour is `alpha * ink + (1 - alpha) * white`.
    // Keeping it as-is would composite the removed white back on top of a dark
    // surface as a pale fringe, so recover the underlying ink colour.
    const alpha = Math.min(255, Math.max(0, Math.round(((OPAQUE_WHITE - luma) / (OPAQUE_WHITE - INK_EDGE)) * 255)));
    if (alpha === 0) {
      pixels[p] = 0;
      pixels[p + 1] = 0;
      pixels[p + 2] = 0;
      pixels[p + 3] = 0;
      continue;
    }

    const a = alpha / 255;
    for (let c = 0; c < 3; c++) {
      const unblended = (pixels[p + c] - (255 * (1 - a))) / a;
      pixels[p + c] = Math.min(255, Math.max(0, Math.round(unblended)));
    }
    pixels[p + 3] = alpha;
  }

  return { width, height, pixels };
}

/** Trims fully transparent rows/columns, then re-centres the artwork on a square canvas. */
function trimToSquare({ width, height, pixels }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[((y * width) + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error('every pixel was cleared — check the thresholds');

  const artWidth = maxX - minX + 1;
  const artHeight = maxY - minY + 1;
  const side = Math.round(Math.max(artWidth, artHeight) * (1 + (MARGIN * 2)));

  const out = Buffer.alloc(side * side * 4);
  const offsetX = Math.round((side - artWidth) / 2);
  const offsetY = Math.round((side - artHeight) / 2);

  for (let y = 0; y < artHeight; y++) {
    const src = (((minY + y) * width) + minX) * 4;
    const dst = ((((offsetY + y) * side) + offsetX)) * 4;
    pixels.copy(out, dst, src, src + (artWidth * 4));
  }

  return { width: side, height: side, pixels: out };
}

const check = process.argv.includes('--check');
const mark = encodePng(trimToSquare(knockOutBackdrop(decodePng(readFileSync(SOURCE)))));

let stale = false;
for (const target of TARGETS) {
  let current = null;
  try {
    current = readFileSync(target);
  } catch {
    /* not generated yet */
  }

  if (current && current.equals(mark)) continue;

  if (check) {
    stale = true;
    console.error(`✖ ${target} is out of date — run: node scripts/build-logo-mark.mjs`);
    continue;
  }

  writeFileSync(target, mark);
  console.log(`✔ wrote ${target}`);
}

if (check && stale) process.exit(1);
if (check && !stale) console.log('✔ logo mark assets are up to date');
