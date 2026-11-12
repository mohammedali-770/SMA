import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

/*
 * apps/mobile/public/index.html replaces Expo's default web template so /app
 * paints a splash instead of a blank page while its bundle loads (22 s blank on
 * a throttled phone profile before it existed).
 *
 * Three properties matter, and each is a way the file could quietly go wrong:
 *   - it must not carry a script: the production CSP allows no inline script, so
 *     one would be blocked there and nowhere else (no build or test serves the
 *     real headers);
 *   - it must otherwise BE Expo's template, so an Expo upgrade that changes the
 *     template is noticed here rather than silently shadowed by a stale copy;
 *   - the splash must live INSIDE #root, which React empties on first render.
 */

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

const mobileRequire = createRequire(new URL('../../node_modules/expo/package.json', import.meta.url));
function expoTemplate(): string | null {
  try {
    const path = mobileRequire.resolve('@expo/cli/static/template/index.html');
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

/** The file with exactly the documented additions removed. */
function withoutSplash(src: string): string {
  return src
    .replace(/\n {4}<!--\n {6}Spicy Meal:[\s\S]*?<\/style>\n/, '\n')
    .replace(/<div id="root">[\s\S]*?\n {4}<\/div>/, '<div id="root"></div>');
}

describe('apps/mobile/public/index.html', () => {
  it('has no <script> at all, so the production CSP cannot block anything in it', () => {
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\son[a-z]+=/i); // nor an inline event handler
  });

  it('loads nothing: no stylesheet, image or font request before the bundle', () => {
    expect(html).not.toMatch(/<link\b|<img\b|url\(|@import/i);
  });

  it('puts the bilingual splash inside #root, which React replaces on mount', () => {
    const root = html.match(/<div id="root">([\s\S]*?)\n {4}<\/div>/)?.[1] ?? '';
    expect(root).toContain('class="sm-splash"');
    expect(root).toContain('class="sm-splash-spinner"');
    expect(root).toContain('Spicy Meal');
    expect(root).toContain('سبايسي ميل');
    expect(root).toMatch(/role="progressbar"/);
  });

  it('keeps the placeholders the Expo export fills in', () => {
    expect(html).toContain('<html lang="%LANG_ISO_CODE%">');
    expect(html).toContain('<title>%WEB_TITLE%</title>');
    expect(html).toContain('</head>');
    expect(html).toContain('</body>');
  });

  const template = expoTemplate();
  it.skipIf(template === null)('is otherwise identical to the installed Expo template', () => {
    expect(withoutSplash(html)).toBe(template);
  });
});
