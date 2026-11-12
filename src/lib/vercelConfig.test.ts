import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Pins the shape of `vercel.json`, which reaches production on every merge
 * (CLAUDE.md §13: the Vercel Git integration deploys the default branch).
 *
 * Nothing else in CI reads this file, so a rewrite or header mistake here would
 * otherwise be found by customers. The resolver below is a deliberately small
 * model of Vercel's routing for THIS file's constructs, checked against the
 * route table `vercel build` compiles from it (`.vercel/output/config.json`):
 *
 *   1. every `headers` rule whose source matches the REQUEST path applies, in
 *      order, later keys overriding earlier ones. They compile to routes with
 *      `continue: true` placed BEFORE `{ handle: 'filesystem' }`, so they attach
 *      whatever the outcome is — a 404 included;
 *   2. an existing file is served as-is;
 *   3. otherwise the first matching rewrite whose destination exists is served;
 *   4. otherwise 404.
 *
 * Sources are compared as anchored regular expressions. That is exact for the
 * sources here, which use only literal text and `( … )` groups; the first test
 * refuses a path-to-regexp named parameter (`:name`), where it would not be.
 */

interface Rule {
  source: string;
}
interface HeaderRule extends Rule {
  headers: { key: string; value: string }[];
}
interface RewriteRule extends Rule {
  destination: string;
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
  rewrites: RewriteRule[];
  headers: HeaderRule[];
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const matches = (rule: Rule, path: string) => new RegExp(`^${rule.source}$`).test(path);

/** Files a build emits, enough to exercise every rule. */
const FILES = new Set([
  '/index.html',
  '/legal.html',
  '/favicon.png',
  '/logo-mark.png',
  '/sw.js',
  '/assets/index-AbC123xy.js',
  '/assets/AdminDashboard-v5ezbamL.js',
  '/app/index.html',
  '/app/favicon.ico',
  '/app/_expo/static/js/web/entry-d266cf362a3cd849499fc3f8a028b220.js',
  '/app/assets/assets/logo-mark.b156facd087eb9ef4356a53939f0c1e6.png',
]);

function resolve(path: string): { status: number; file: string | null; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  for (const rule of config.headers) {
    if (!matches(rule, path)) continue;
    for (const h of rule.headers) headers[h.key.toLowerCase()] = h.value;
  }
  if (FILES.has(path)) return { status: 200, file: path, headers };
  for (const rule of config.rewrites) {
    if (matches(rule, path) && FILES.has(rule.destination))
      return { status: 200, file: rule.destination, headers };
  }
  return { status: 404, file: null, headers };
}

/** Every Expo Router screen, as the URL a browser would request under /app. */
function appRoutes(): string[] {
  const dir = join(ROOT, 'apps/mobile/src/app');
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !name.startsWith('_') && !name.startsWith('+')) {
        const segments = relative(dir, full)
          .replace(/\.tsx?$/, '')
          .split('/')
          .filter((s) => !/^\(.*\)$/.test(s)) // route groups do not appear in the URL
          .map((s) => (/^\[.*\]$/.test(s) ? 'sample-id' : s));
        if (segments[segments.length - 1] === 'index') segments.pop();
        out.push(`/app/${segments.join('/')}`);
      }
    }
  };
  walk(dir);
  return out;
}

describe('vercel.json is expressible by this model', () => {
  it('uses no path-to-regexp named parameters, so the anchored-regex reading is exact', () => {
    for (const rule of [...config.rewrites, ...config.headers]) expect(rule.source).not.toMatch(/:[A-Za-z]/);
  });
});

describe('content-hashed assets are cached for a year, and nothing else is', () => {
  it('marks exactly the three hashed prefixes immutable', () => {
    const immutable = config.headers
      .filter((r) => r.headers.some((h) => h.key.toLowerCase() === 'cache-control' && h.value === IMMUTABLE))
      .map((r) => r.source)
      .sort();
    expect(immutable).toEqual(['/app/_expo/(.*)', '/app/assets/(.*)', '/assets/(.*)']);
  });

  it.each([
    '/app/_expo/static/js/web/entry-d266cf362a3cd849499fc3f8a028b220.js',
    '/app/assets/assets/logo-mark.b156facd087eb9ef4356a53939f0c1e6.png',
    '/assets/AdminDashboard-v5ezbamL.js',
  ])('serves %s with the immutable header', (path) => {
    const r = resolve(path);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe(IMMUTABLE);
  });

  it.each(['/', '/app', '/app/', '/app/index.html', '/index.html', '/legal', '/sw.js', '/logo-mark.png'])(
    'never marks the HTML shells or unhashed files immutable: %s',
    (path) => {
      expect(resolve(path).headers['cache-control']).toBeUndefined();
    },
  );
});

describe('a missing hashed asset is a 404, never the SPA shell', () => {
  // Before this rule, an asset that a deploy removed was answered with the HTML
  // shell, 200, under the immutable header — so a browser cached HTML under a
  // script URL for a year, and a Vercel rollback could not heal it.
  it.each([
    '/assets/AdminDashboard-OLDHASH0.js',
    '/assets/DeliveryZoneModal-OLDHASH0.css',
    '/app/_expo/static/js/web/entry-00000000000000000000000000000000.js',
    '/app/assets/assets/logo-mark.00000000000000000000000000000000.png',
    '/app/assets/node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.00000000000000000000000000000000.ttf',
  ])('%s', (path) => {
    const r = resolve(path);
    expect(r.status).toBe(404);
    expect(r.file).toBeNull();
  });
});

describe('every SPA route still resolves to its shell', () => {
  const routes = appRoutes();

  it('found the Expo Router screens', () => {
    expect(routes.length).toBeGreaterThan(15);
    expect(routes).toContain('/app/select');
    expect(routes).toContain('/app/product/sample-id');
  });

  it('has no screen whose URL begins with an excluded asset prefix', () => {
    for (const route of routes) expect(route).not.toMatch(/^\/app\/(_expo|assets)(\/|$)/);
  });

  it.each([
    '/app',
    '/app/',
    ...routes,
    '/app/orders',
    '/app/some/deep/unknown/path',
    '/app/assets',
    '/app/_expo',
  ])('customer app: %s', (path) => {
    const r = resolve(path);
    expect(r.status).toBe(200);
    expect(r.file).toBe('/app/index.html');
  });

  it.each(['/', '/stats', '/admin/orders', '/assets', '/assetsfoo', '/appx', '/legalese'])(
    'staff console: %s',
    (path) => {
      const r = resolve(path);
      expect(r.status).toBe(200);
      expect(r.file).toBe('/index.html');
    },
  );

  it.each(['/legal', '/legal/privacy_policy', '/privacy', '/terms', '/support'])(
    'public legal page: %s',
    (path) => {
      expect(resolve(path).file).toBe('/legal.html');
    },
  );
});

describe("index.html's inline scripts are allowed by the production CSP", () => {
  // The CSP has no 'unsafe-inline' for scripts, so an inline <script> runs only
  // if its exact sha256 is listed. Editing the theme script without updating the
  // hash would block it in production and nowhere else — not in `vite build`,
  // `vite preview` or any test that does not serve the real headers.
  const csp =
    config.headers.flatMap((r) => r.headers).find((h) => h.key.toLowerCase() === 'content-security-policy')
      ?.value ?? '';
  const scriptSrc = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('script-src '));
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const inline = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\ssrc=/i.test(m[1] ?? ''))
    .map((m) => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  const listed = (scriptSrc ?? '').split(/\s+/).filter((t) => t.startsWith("'sha256-"));

  it('has a script-src without unsafe-inline', () => {
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('lists the sha256 of every inline script', () => {
    expect(inline.length).toBeGreaterThan(0);
    for (const hash of inline) expect(listed).toContain(hash);
  });

  it('lists no hash that no longer matches a script', () => {
    for (const hash of listed) expect(inline).toContain(hash);
  });
});
