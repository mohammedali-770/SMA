#!/usr/bin/env node
/**
 * Fail the build if a file the CDN serves as `immutable` is not content-hashed.
 *
 *   node scripts/check-immutable-asset-names.mjs [dist]      (default: dist)
 *
 * `vercel.json` sends `Cache-Control: public, max-age=31536000, immutable` for
 * everything under `/app/assets/` and `/app/_expo/`. That is correct only while
 * every file there carries a hash of its own bytes in its name, so a changed
 * file gets a new URL. Metro does that today: an asset is
 * `name.<md5>.ext` (plus `@2x`-style scale suffixes), a bundle is
 * `entry-<md5>.js`. If a future export emitted an unhashed name — a config
 * change, an Expo release, a file copied in by hand — browsers would keep the
 * old bytes for a year with no way to reach them. This check turns that into a
 * failed build, and a failed build is a deploy that does not happen.
 *
 * It runs inside `npm run build`, after the export, for the reason recorded in
 * `scripts/bundle-forbidden-libs.mjs`: that is the build Vercel runs.
 *
 * Not covered, stated rather than implied: the console's `/assets/` (Vite).
 * Vite's hash is 8 base64url characters after a hyphen, which an ordinary word
 * can imitate (`font-cyrillic.woff2`), so a name test there would prove little.
 * Vite has hashed every emitted asset by default since its first release.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Directories under `dist` that vercel.json marks immutable, with the name rule each must obey. */
export const IMMUTABLE_DIRS = Object.freeze([
  // logo-mark.b156facd087eb9ef4356a53939f0c1e6.png, close-icon.808e…a7@3x.png
  Object.freeze({ dir: 'app/assets', pattern: /\.[0-9a-f]{32}(?:@\d+(?:\.\d+)?x)?\.[A-Za-z0-9]+$/ }),
  // entry-d266cf362a3cd849499fc3f8a028b220.js (and its .map, if one is emitted)
  Object.freeze({ dir: 'app/_expo', pattern: /-[0-9a-f]{32}\.[A-Za-z0-9]+(?:\.map)?$/ }),
]);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else out.push(full);
  }
  return out;
}

/**
 * Every unhashed file under the immutable directories of `dist`. Throws when a
 * directory is missing or empty: a check over nothing passes for ever.
 */
export function findUnhashedAssets(dist, rules = IMMUTABLE_DIRS) {
  const unhashed = [];
  let checked = 0;
  for (const { dir, pattern } of rules) {
    const root = join(dist, dir);
    if (!existsSync(root)) throw new Error(`${root} does not exist; build before checking`);
    const list = files(root);
    if (list.length === 0) throw new Error(`no files under ${root}; the check would prove nothing`);
    checked += list.length;
    for (const file of list) {
      if (!pattern.test(file.split('/').pop() ?? '')) unhashed.push(relative(dist, file));
    }
  }
  return { checked, unhashed };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dist = process.argv[2] ?? 'dist';
  let result;
  try {
    result = findUnhashedAssets(dist);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
  if (result.unhashed.length > 0) {
    for (const file of result.unhashed) {
      console.error(
        `::error file=${file},title=unhashed file under an immutable path::${file} is served with ` +
          '`immutable` for a year by vercel.json but has no content hash in its name, so a changed ' +
          'version could never reach a browser that cached it. See docs/DEPLOY.md §7.',
      );
    }
    process.exit(1);
  }
  console.log(`immutable asset names: ${result.checked} file(s), all content-hashed`);
}
