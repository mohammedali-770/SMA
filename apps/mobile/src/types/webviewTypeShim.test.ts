import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * The guard for `react-native-webview.d.ts`, the type-only shim that restores
 * the `P = {}` default react-native-webview 14 dropped (see that file's header).
 *
 * A shim like this has two ways to go wrong quietly, and each case below is one
 * of them:
 *
 *   - OUTLIVING ITS BUG. When upstream fixes the default, the shim becomes dead
 *     weight that hides whatever the package declares next. The first case fails
 *     on that day, telling whoever reads it to delete the shim.
 *   - CHANGING THE RUNTIME. Metro reads the same `paths` as TypeScript. A `.d.ts`
 *     is not a source file, so Expo's resolver skips the alias and bundles the
 *     real package. A `.ts` or `.js` file of the same name WOULD be bundled in
 *     its place and replace every WebView in the app, including the payment
 *     screen. The last case keeps that impossible.
 */

const MOBILE = resolve(__dirname, '../..');
const UPSTREAM = resolve(MOBILE, 'node_modules/react-native-webview/index.d.ts');
const SHIM = resolve(__dirname, 'react-native-webview.d.ts');
const INSTALLED = existsSync(UPSTREAM);

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('react-native-webview type shim', () => {
  it('is still needed: the installed package still defaults P to undefined', (ctx) => {
    if (!INSTALLED) return ctx.skip();
    const upstream = readFileSync(UPSTREAM, 'utf8');
    expect(
      /declare class WebView<P = undefined>/.test(upstream),
      'react-native-webview no longer declares `P = undefined`. ' +
        'Delete src/types/react-native-webview.d.ts and its tsconfig paths entry.',
    ).toBe(true);
  });

  it('is wired through one exact paths entry, and nothing broader', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(MOBILE, 'tsconfig.json'), 'utf8'));
    expect(tsconfig.compilerOptions.paths['react-native-webview']).toEqual([
      './src/types/react-native-webview',
    ]);
    // A wildcard would also redirect the shim's own `react-native-webview/index`
    // import back to itself.
    expect(tsconfig.compilerOptions.paths['react-native-webview/*']).toBeUndefined();
  });

  it('changes only the default type argument and inherits everything else', () => {
    const code = stripComments(readFileSync(SHIM, 'utf8'));
    expect(code).toMatch(/import UpstreamWebView from 'react-native-webview\/index';/);
    expect(code).toMatch(/export \* from 'react-native-webview\/index';/);
    expect(code.match(/declare class/g)).toHaveLength(1);
    expect(code).toMatch(/declare class WebView<P = \{\}> extends UpstreamWebView<P> \{\}/);
  });

  it('has no runtime twin, so Metro still bundles the real package', () => {
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
    const platforms = ['', '.android', '.ios', '.native', '.web'];
    for (const platform of platforms) {
      for (const ext of exts) {
        const twin = resolve(__dirname, `react-native-webview${platform}${ext}`);
        expect(existsSync(twin), `${twin} would be bundled in place of the real package`).toBe(false);
      }
    }
    expect(existsSync(resolve(__dirname, 'react-native-webview')), 'a directory would be resolved too').toBe(
      false,
    );
  });
});
