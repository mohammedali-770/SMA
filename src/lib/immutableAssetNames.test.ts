import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findUnhashedAssets } from '../../scripts/check-immutable-asset-names.mjs';

/*
 * scripts/check-immutable-asset-names.mjs fails the build when a file that
 * vercel.json serves as `immutable` has no content hash in its name. These cases
 * are the real names the Expo export emits, plus the shapes that must fail.
 */

const HASH = 'b156facd087eb9ef4356a53939f0c1e6';
const dirs: string[] = [];

function dist(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'immutable-names-'));
  dirs.push(root);
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'x');
  }
  return root;
}

const GOOD = [
  `app/assets/assets/logo-mark.${HASH}.png`,
  `app/assets/node_modules/expo-router/assets/react-navigation/elements/close-icon.${HASH}@3x.png`,
  `app/assets/node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.${HASH}.ttf`,
  `app/_expo/static/js/web/entry-${HASH}.js`,
];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('findUnhashedAssets', () => {
  it('passes the names the Expo export emits', () => {
    expect(findUnhashedAssets(dist(GOOD))).toEqual({ checked: 4, unhashed: [] });
  });

  it.each([
    'app/assets/assets/logo-mark.png',
    'app/assets/assets/logo-mark.b156facd.png', // a short hash is not a content hash
    `app/assets/assets/logo-mark-${HASH}.png`, // Metro separates with a dot
    `app/assets/assets/logo-mark.${HASH.toUpperCase()}.png`,
    'app/_expo/static/js/web/entry.js',
    `app/_expo/static/js/web/entry.${HASH}.js`,
  ])('fails %s', (bad) => {
    expect(findUnhashedAssets(dist([...GOOD, bad])).unhashed).toEqual([bad]);
  });

  it('refuses to pass over an empty or missing directory', () => {
    expect(() => findUnhashedAssets(dist([`app/assets/assets/logo-mark.${HASH}.png`]))).toThrow(
      /does not exist/,
    );
    const root = dist([`app/_expo/static/js/web/entry-${HASH}.js`]);
    mkdirSync(join(root, 'app/assets'));
    expect(() => findUnhashedAssets(root)).toThrow(/no files under/);
  });
});
