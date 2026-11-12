#!/usr/bin/env node
/**
 * Web performance budget for the customer app at /app. Fails the build when a
 * shipped artifact grows past its threshold.
 *
 *   node scripts/web-budget.mjs [dist]      (default: dist)
 *
 * WHY. The /app entry (4.4 MB raw), eight TTF fonts and the brand mark shipped
 * with no size check at all, and a 388 KB mark sat on the launch screen as its
 * LCP image until somebody measured by hand. A threshold just above today's
 * value turns the next regression into a red build instead of a slow phone.
 *
 * WHAT IS MEASURED, and why each is the number that matters:
 *   1. the /app entry bundle, brotli. One bundle by design (async routes are off,
 *      webExportConfig.test.ts), so this is what every first visit downloads
 *      before anything renders;
 *   2. first load: entry + the fonts the app registers at start
 *      (DESIGN_SYSTEM_FONTS in apps/mobile/src/design-system/fonts.ts, read from
 *      source so a newly registered font is counted) + the brand mark;
 *   3. every UI image the build emits (dist/app/assets/assets/** and dist/*.png):
 *      each at most 150 KB, raw — PNG does not compress further on the wire.
 *
 * Brotli is quality 4, the level the assessment used to stand in for Vercel's
 * on-the-fly compression. Vercel's own encoding measured about 6% LARGER for
 * the entry (1 074 736 B served vs 1 016 277 B at q4 locally), so these are
 * like-for-like with each other, not with a production transfer size.
 *
 * Thresholds and the measured values they sit above are documented in
 * docs/DEPLOY.md §2. Lower a threshold when a change makes room; raise one
 * only in a change that says why the growth is worth it.
 *
 * It runs inside `npm run build`, after the export, for the reason recorded in
 * scripts/bundle-forbidden-libs.mjs: that is the build Vercel runs.
 */
import { brotliCompressSync, constants } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const KB = 1024;

export const BUDGET = Object.freeze({
  /** /app entry bundle, brotli q4. Measured 1 014 118 B on 2026-11-12 (docs/DEPLOY.md §2). */
  entryBrotli: 1_040 * KB,
  /**
   * entry + start-up fonts + brand mark, brotli q4 (PNG counted at its compressed
   * size). Measured 1 862 605 B on 2026-11-12 with the 450 px mark; with the
   * 885 px mark it was 2 123 038 B, which this fails.
   */
  firstLoadBrotli: 1_900 * KB,
  /** Any single UI image, raw bytes. */
  uiImage: 150 * KB,
});

/**
 * Images under dist/*.png that no UI draws, with the reason. Each is still
 * listed in the report, so a change to it is visible.
 */
export const NON_UI_IMAGES = Object.freeze({
  // The approved master artwork, kept opaque at full size: the iOS
  // apple-touch-icon (index.html), fetched only when the console is added to a
  // Home Screen, and the source build-logo-mark.mjs derives the UI mark from.
  'logo.png': 'apple-touch-icon and logo master; never drawn by either UI',
});

export function brotli(buffer) {
  return brotliCompressSync(buffer, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_SIZE_HINT]: buffer.length },
  }).length;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Font export names the app registers at start, read from fonts.ts source. */
export function startupFontNames(source) {
  const body = source.match(/DESIGN_SYSTEM_FONTS\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';
  return [...body.matchAll(/:\s*([A-Za-z]+_\d{3}[A-Za-z]+)\s*,?/g)].map((m) => m[1]);
}

/**
 * Measure `dist` against `budget`. Returns `{ rows, failures }`; throws when an
 * input is missing, because a budget over nothing passes for ever.
 *
 * @param {string} dist
 * @param {{ budget?: { entryBrotli: number; firstLoadBrotli: number; uiImage: number }; fontsSource?: string }} [options]
 *   `fontsSource` replaces the contents of fonts.ts (tests only).
 */
export function measure(dist, { budget = BUDGET, fontsSource } = {}) {
  const failures = [];
  const rows = [];

  const entries = walk(join(dist, 'app/_expo/static/js/web')).filter((f) =>
    /\/entry-[0-9a-f]{32}\.js$/.test(f),
  );
  if (entries.length !== 1)
    throw new Error(`expected exactly one /app entry bundle, found ${entries.length}`);
  const entry = entries[0];

  const assets = walk(join(dist, 'app/assets'));
  const fontNames = startupFontNames(
    fontsSource ?? readFileSync(join(ROOT, 'apps/mobile/src/design-system/fonts.ts'), 'utf8'),
  );
  if (fontNames.length === 0)
    throw new Error('no start-up fonts found in fonts.ts; the budget would prove nothing');
  const fonts = fontNames.map((name) => {
    const hit = assets.find((f) => new RegExp(`/${name}\\.[0-9a-f]{32}\\.ttf$`).test(f));
    if (!hit) throw new Error(`start-up font ${name} is not in the export`);
    return hit;
  });
  const marks = assets.filter((f) => /\/assets\/assets\/logo-mark\.[0-9a-f]{32}\.png$/.test(f));
  if (marks.length !== 1) throw new Error(`expected exactly one exported brand mark, found ${marks.length}`);

  const entryBr = brotli(readFileSync(entry));
  rows.push(['/app entry (br)', relative(dist, entry), entryBr, budget.entryBrotli]);
  if (entryBr > budget.entryBrotli)
    failures.push(`/app entry is ${entryBr} B brotli, budget ${budget.entryBrotli} B`);

  const fontBr = fonts.reduce((sum, f) => sum + brotli(readFileSync(f)), 0);
  const markBr = brotli(readFileSync(marks[0]));
  const firstLoad = entryBr + fontBr + markBr;
  rows.push([`  start-up fonts x${fonts.length} (br)`, '', fontBr, null]);
  rows.push(['  brand mark (br)', relative(dist, marks[0]), markBr, null]);
  rows.push(['first load: entry + fonts + mark (br)', '', firstLoad, budget.firstLoadBrotli]);
  if (firstLoad > budget.firstLoadBrotli) {
    failures.push(`first load is ${firstLoad} B brotli, budget ${budget.firstLoadBrotli} B`);
  }

  const images = [
    ...walk(join(dist, 'app/assets/assets')).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)),
    ...readdirSync(dist)
      .filter((n) => n.endsWith('.png'))
      .map((n) => join(dist, n)),
  ];
  if (images.length === 0) throw new Error('no UI images found; the budget would prove nothing');
  for (const image of images) {
    const bytes = statSync(image).size;
    const exempt = NON_UI_IMAGES[relative(dist, image)];
    rows.push([
      exempt ? `image (not UI: ${exempt})` : 'UI image',
      relative(dist, image),
      bytes,
      exempt ? null : budget.uiImage,
    ]);
    if (!exempt && bytes > budget.uiImage)
      failures.push(`${relative(dist, image)} is ${bytes} B, budget ${budget.uiImage} B`);
  }

  return { rows, failures };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dist = process.argv[2] ?? 'dist';
  let result;
  try {
    result = measure(dist);
  } catch (error) {
    console.error(`::error::web budget: ${error.message}`);
    process.exit(1);
  }
  for (const [label, file, bytes, limit] of result.rows) {
    const verdict =
      limit == null ? '' : bytes > limit ? '  OVER' : `  (${Math.round((bytes / limit) * 100)}% of ${limit})`;
    console.log(`${label.padEnd(44)} ${String(bytes).padStart(9)} B${verdict}  ${basename(file)}`);
  }
  if (result.failures.length > 0) {
    for (const f of result.failures)
      console.error(`::error title=web budget exceeded::${f}. See docs/DEPLOY.md §2.`);
    process.exit(1);
  }
  console.log('web budget: within every threshold');
}
