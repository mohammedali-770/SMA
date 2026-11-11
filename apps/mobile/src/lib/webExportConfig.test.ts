import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The web export (`/app` on Vercel) must ship every route in ONE bundle.
 *
 * Expo Router 58 turned async routes on by default for web (its plugin's options.json:
 * "Stable and enabled by default on web in SDK 58 and later"). The export then splits
 * every screen into a lazy chunk named by content hash. After a deploy, those chunk
 * files are gone, and Vercel's `/app/(.*)` rewrite answers the old URL with
 * index.html, which `nosniff` refuses to run. So a customer who already had `/app`
 * open got an error screen on the first screen they had not yet visited, checkout
 * included, until a full reload. SDK 57 shipped one bundle and never had this.
 *
 * Measured 2026-11-10 against a replica of vercel.json's headers and rewrites: the
 * default build fails exactly that way, and the same deploy with
 * `asyncRoutes: false` opens the screen normally, with 0 CSP violations.
 */
describe('web export bundling', () => {
  const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')) as {
    expo: { plugins?: (string | [string, Record<string, unknown>])[] };
  };
  const routers = (appJson.expo.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) === 'expo-router');

  it('configures expo-router once, with async routes off', () => {
    expect(routers).toHaveLength(1);
    const [entry] = routers;
    expect(Array.isArray(entry) ? entry[1]?.asyncRoutes : undefined).toBe(false);
  });
});
