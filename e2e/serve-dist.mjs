#!/usr/bin/env node
/**
 * Serves `dist/` the way Vercel serves it, for the end-to-end spec.
 *
 *   node e2e/serve-dist.mjs [--port 8840] [--root dist] [--config vercel.json]
 *
 * It reads `vercel.json` and applies its `headers` and `rewrites` with Vercel's
 * order of operations, so a change to either is exercised by the spec rather
 * than assumed:
 *
 *   1. headers: every rule whose `source` matches the REQUEST path applies, in
 *      file order, and a later rule overrides the same key from an earlier one;
 *   2. the filesystem is tried first;
 *   3. only on a miss, rewrites are tried in file order and the first match wins.
 *
 * It speaks HTTPS with a throwaway self-signed certificate, made with `openssl`
 * at start-up and deleted at exit. Plain HTTP is not an option: the
 * Content-Security-Policy carries `upgrade-insecure-requests`, so a browser on
 * a non-localhost name would upgrade every subresource to https.
 *
 * Only the `(.*)` wildcard is understood, which is all vercel.json uses. A
 * `source` with any other pattern syntax stops the server rather than being
 * matched literally — a replica that silently misreads a rule would prove
 * nothing about the real one.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', process.env.E2E_PORT ?? '8840'));
const ROOT = resolve(REPO, arg('root', 'dist'));
const CONFIG = resolve(REPO, arg('config', 'vercel.json'));
const HOSTNAME = process.env.E2E_HOSTNAME ?? 'spicymeal-review.test';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/vnd.microsoft.icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** `/app/(.*)` -> /^\/app\/(.*)$/, refusing any syntax it does not model. */
export function sourceToRegExp(source) {
  const parts = source.split('(.*)');
  for (const literal of parts) {
    if (/[:()*+?{}[\]|\\^$]/.test(literal)) {
      throw new Error(
        `vercel.json source ${JSON.stringify(source)} uses pattern syntax this server does not model`,
      );
    }
  }
  const escaped = parts.map((s) => s.replace(/[.]/g, '\\.'));
  return new RegExp(`^${escaped.join('(.*)')}$`);
}

export function loadRules(configPath) {
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  return {
    headers: (cfg.headers ?? []).map((h) => ({ re: sourceToRegExp(h.source), headers: h.headers })),
    rewrites: (cfg.rewrites ?? []).map((r) => ({ re: sourceToRegExp(r.source), destination: r.destination })),
  };
}

function fileFor(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function makeCertificate() {
  const dir = mkdtempSync(join(tmpdir(), 'sma-e2e-tls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      `/CN=${HOSTNAME}`,
      '-addext',
      `subjectAltName=DNS:${HOSTNAME},IP:127.0.0.1`,
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const tls = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
  rmSync(dir, { recursive: true, force: true });
  return tls;
}

function main() {
  const rules = loadRules(CONFIG);
  statSync(join(ROOT, 'app', 'index.html')); // fail fast when dist was not built

  const server = createServer(makeCertificate(), (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x').pathname;
    const headers = {};
    for (const rule of rules.headers) {
      if (rule.re.test(path)) for (const h of rule.headers) headers[h.key.toLowerCase()] = h.value;
    }
    let file = fileFor(ROOT, path);
    if (!file) {
      const rewrite = rules.rewrites.find((r) => r.re.test(path));
      if (rewrite) file = fileFor(ROOT, rewrite.destination);
    }
    if (!file) {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, {
      'cache-control': 'public, max-age=0, must-revalidate',
      ...headers,
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': String(body.length),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`serving ${ROOT} as https://${HOSTNAME}:${PORT} (127.0.0.1), rules from ${CONFIG}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
