import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

/*
 * The /app export produces, uploads and then removes source maps only when
 * SENTRY_AUTH_TOKEN is present (apps/mobile/scripts/webExportSourceMaps.js).
 *
 * Two properties carry the weight:
 *   - without the token NOTHING changes: same arguments, no extra step;
 *   - with it, no map and no reference to one can reach dist/app, whatever the
 *     upload did. A failed upload is a warning, not a failed build.
 */

type SpawnResult = { status: number | null; error?: Error };
type Upload = { args: string[]; env: Record<string, string> };
type Plan = { sourceMaps: boolean; exportArgs: string[]; steps: string[]; upload?: Upload | null };
type Leak = { file: string; reason: string };
type Ops = {
  deleteSourceMaps: (dir: string) => string[];
  stripSourceMapComments: (dir: string) => string[];
  findSourceMapLeaks: (dir: string) => Leak[];
};
type Mod = {
  OUTPUT_DIR: string;
  BASE_EXPORT_ARGS: readonly string[];
  shouldUploadSourceMaps: (env: Record<string, string | undefined>) => boolean;
  readSentryPluginConfig: (appJson: unknown) => Record<string, string> | null;
  planWebExport: (env: Record<string, string | undefined>, cfg: Record<string, string> | null) => Plan;
  stripSourceMappingUrl: (text: string) => string;
  hasSourceMappingUrl: (text: string) => boolean;
  deleteSourceMaps: Ops['deleteSourceMaps'];
  stripSourceMapComments: Ops['stripSourceMapComments'];
  findSourceMapLeaks: Ops['findSourceMapLeaks'];
  runWithSourceMaps: (o: {
    plan: Plan;
    outputDir: string;
    runExport: (args: string[]) => SpawnResult;
    runUpload: (u: Upload) => SpawnResult;
    log?: {
      log: (...a: unknown[]) => void;
      warn: (...a: unknown[]) => void;
      error: (...a: unknown[]) => void;
    };
    ops?: Ops;
  }) => number;
};

const req = createRequire(import.meta.url);
const mod = req('../../scripts/webExportSourceMaps.js') as Mod;
const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')) as unknown;

/** The argument list the export has always had. Pinned literally, not imported. */
const ORIGINAL_ARGS = ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', '../../dist/app'];

// A fake. CLAUDE.md §9: no real token appears in this repository.
const FAKE = { SENTRY_AUTH_TOKEN: 'fake-token-for-tests' };

const ENTRY = 'entry-0123456789abcdef0123456789abcdef.js';
const BUNDLE_TAIL =
  '__r(0);\n//# sourceMappingURL=/app/_expo/static/js/web/' +
  `${ENTRY}.map\n//# debugId=58c7f338-a8bc-4cd8-aa56-ce3c61d825c4`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A dist/app as `expo export --source-maps` leaves it. */
function exportedTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-export-maps-'));
  dirs.push(dir);
  const js = join(dir, '_expo/static/js/web', ENTRY);
  mkdirSync(dirname(js), { recursive: true });
  writeFileSync(js, `var a="//# sourceMappingURL=not-a-comment";\n${BUNDLE_TAIL}`);
  writeFileSync(`${js}.map`, '{"version":3,"debugId":"58c7f338"}');
  writeFileSync(join(dir, 'index.html'), `<script src="/app/_expo/static/js/web/${ENTRY}"></script>`);
  return dir;
}

const quiet = () => {
  const lines: string[] = [];
  const push = (...a: unknown[]) => lines.push(a.join(' '));
  return { lines, log: { log: push, warn: push, error: push } };
};

const ok = (): SpawnResult => ({ status: 0 });
const tokenPlan = () => mod.planWebExport(FAKE, mod.readSentryPluginConfig(appJson));

describe('planWebExport without SENTRY_AUTH_TOKEN', () => {
  it('returns the original export arguments and no other step', () => {
    for (const env of [{}, { SENTRY_AUTH_TOKEN: '' }, { SENTRY_AUTH_TOKEN: undefined }]) {
      const plan = mod.planWebExport(env, mod.readSentryPluginConfig(appJson));
      expect(plan.sourceMaps).toBe(false);
      expect(plan.exportArgs).toEqual(ORIGINAL_ARGS);
      expect(plan.steps).toEqual([]);
      expect(plan.upload).toBeUndefined();
    }
  });
});

describe('planWebExport with SENTRY_AUTH_TOKEN', () => {
  it('adds --source-maps to the original arguments and nothing else', () => {
    const plan = tokenPlan();
    expect(plan.sourceMaps).toBe(true);
    expect(plan.exportArgs).toEqual([...ORIGINAL_ARGS, '--source-maps']);
  });

  it('uploads, then deletes, then strips, then verifies, in that order', () => {
    expect(tokenPlan().steps).toEqual(['export', 'upload', 'delete-maps', 'strip-map-comments', 'verify']);
  });

  it('uploads dist/app to the org and project app.json names, without carrying the token itself', () => {
    const { upload } = tokenPlan();
    expect(upload?.args).toEqual(['../../dist/app']);
    expect(upload?.env).toEqual({
      SENTRY_ORG: 'first-taste-trading-company',
      SENTRY_PROJECT: 'react-native',
      SENTRY_URL: 'https://sentry.io/',
    });
    expect(JSON.stringify(upload)).not.toContain(FAKE.SENTRY_AUTH_TOKEN);
  });

  it('has no upload when app.json names no Sentry org/project', () => {
    expect(mod.planWebExport(FAKE, null).upload).toBeNull();
  });
});

describe('stripSourceMappingUrl', () => {
  it('removes the comment Metro appends and keeps the Debug ID comment Sentry matches on', () => {
    const out = mod.stripSourceMappingUrl(BUNDLE_TAIL);
    expect(out).toBe('__r(0);\n//# debugId=58c7f338-a8bc-4cd8-aa56-ce3c61d825c4');
    expect(mod.hasSourceMappingUrl(out)).toBe(false);
  });

  it('removes a final-line comment and a CSS one', () => {
    expect(mod.stripSourceMappingUrl('x();\n//# sourceMappingURL=a.js.map')).toBe('x();\n');
    expect(mod.stripSourceMappingUrl('a{}\n/*# sourceMappingURL=a.css.map */\n')).toBe('a{}\n');
  });

  it('leaves the same text inside a string in minified code alone', () => {
    const code = 'var a="//# sourceMappingURL=x";';
    expect(mod.stripSourceMappingUrl(code)).toBe(code);
    expect(mod.hasSourceMappingUrl(code)).toBe(false);
  });
});

describe('runWithSourceMaps', () => {
  it('ships no map and no map reference after a successful upload', () => {
    const dir = exportedTree();
    const uploads: Upload[] = [];
    const { log } = quiet();
    const code = mod.runWithSourceMaps({
      plan: tokenPlan(),
      outputDir: dir,
      runExport: ok,
      runUpload: (u) => {
        // The upload must see the map: it runs before deletion.
        expect(existsSync(join(dir, '_expo/static/js/web', `${ENTRY}.map`))).toBe(true);
        uploads.push(u);
        return ok();
      },
      log,
    });
    expect(code).toBe(0);
    expect(uploads).toHaveLength(1);
    expect(mod.findSourceMapLeaks(dir)).toEqual([]);
    const js = readFileSync(join(dir, '_expo/static/js/web', ENTRY), 'utf8');
    expect(js).toContain('//# debugId=58c7f338');
    expect(js).toContain('var a="//# sourceMappingURL=not-a-comment"');
  });

  it('still removes every map when the upload fails, warns, and does not fail the build', () => {
    for (const failed of [{ status: 1 }, { status: null, error: new Error('spawn ENOENT') }]) {
      const dir = exportedTree();
      const { lines, log } = quiet();
      const code = mod.runWithSourceMaps({
        plan: tokenPlan(),
        outputDir: dir,
        runExport: ok,
        runUpload: () => failed,
        log,
      });
      expect(code).toBe(0);
      expect(mod.findSourceMapLeaks(dir)).toEqual([]);
      expect(lines.join('\n')).toMatch(/NOT uploaded to Sentry/);
    }
  });

  it('removes maps and keeps the export failure when the export fails', () => {
    const dir = exportedTree();
    const code = mod.runWithSourceMaps({
      plan: tokenPlan(),
      outputDir: dir,
      runExport: () => ({ status: 3 }),
      runUpload: () => {
        throw new Error('must not upload after a failed export');
      },
      log: quiet().log,
    });
    expect(code).toBe(3);
    expect(mod.findSourceMapLeaks(dir)).toEqual([]);
  });

  it('fails the build when a map survives deletion', () => {
    const dir = exportedTree();
    const { lines, log } = quiet();
    const code = mod.runWithSourceMaps({
      plan: tokenPlan(),
      outputDir: dir,
      runExport: ok,
      runUpload: ok,
      log,
      ops: {
        deleteSourceMaps: () => [],
        stripSourceMapComments: mod.stripSourceMapComments,
        findSourceMapLeaks: mod.findSourceMapLeaks,
      },
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/map file: .*\.js\.map/);
  });

  it('fails the build when a sourceMappingURL comment survives', () => {
    const dir = exportedTree();
    const { lines, log } = quiet();
    const code = mod.runWithSourceMaps({
      plan: tokenPlan(),
      outputDir: dir,
      runExport: ok,
      runUpload: ok,
      log,
      ops: {
        deleteSourceMaps: mod.deleteSourceMaps,
        stripSourceMapComments: () => [],
        findSourceMapLeaks: mod.findSourceMapLeaks,
      },
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/sourceMappingURL comment: .*\.js$/m);
  });
});

describe('findSourceMapLeaks', () => {
  it('reports a map and a reference on a freshly exported tree', () => {
    const reasons = mod
      .findSourceMapLeaks(exportedTree())
      .map((l) => l.reason)
      .sort();
    expect(reasons).toEqual(['map file', 'sourceMappingURL comment']);
  });
});

describe('export-web.js', () => {
  const src = readFileSync(new URL('../../scripts/export-web.js', import.meta.url), 'utf8');

  it('takes its export arguments from the plan, not from a second literal list', () => {
    expect(src).toContain('runExport(plan.exportArgs)');
    expect(src).not.toMatch(/'--output-dir'/);
  });

  it('never reads the token value, only tests for its presence through the plan', () => {
    expect(src).not.toMatch(/SENTRY_AUTH_TOKEN\s*[)\].,;]/);
    expect(src).not.toMatch(/process\.env\.SENTRY_AUTH_TOKEN/);
  });
});

/*
 * export-web.js itself, run as a child process with a fake `npx` first on PATH,
 * so no export, no network and no upload happen. The fake records its argv and
 * exits with the status it is told to. The token case also runs the cleanup over
 * the real dist/app, which only ever removes .map files and map comments: what
 * every token build does to it anyway.
 */
describe.skipIf(process.platform === 'win32')('export-web.js as a process', () => {
  const script = new URL('../../scripts/export-web.js', import.meta.url).pathname;

  function run(extraEnv: Record<string, string>, fakeStatus: number) {
    const bin = mkdtempSync(join(tmpdir(), 'fake-npx-'));
    dirs.push(bin);
    const record = join(bin, 'argv.json');
    writeFileSync(
      join(bin, 'npx'),
      '#!/usr/bin/env node\n' +
        `require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\n` +
        `process.exit(${fakeStatus});\n`,
    );
    chmodSync(join(bin, 'npx'), 0o755);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && k !== 'SENTRY_AUTH_TOKEN') env[k] = v;
    const r = spawnSync(process.execPath, [script], {
      env: { ...env, ...extraEnv, PATH: `${bin}:${env.PATH ?? ''}` },
      encoding: 'utf8',
    });
    const argv = existsSync(record) ? (JSON.parse(readFileSync(record, 'utf8')) as string[]) : null;
    return { status: r.status, argv, output: `${r.stdout}${r.stderr}` };
  }

  it('without the token runs the original export once and passes its status through', () => {
    for (const status of [0, 5]) {
      const r = run({}, status);
      expect(r.argv).toEqual(ORIGINAL_ARGS);
      expect(r.status).toBe(status);
      expect(r.output).not.toContain('[export-web]');
    }
  });

  it('with the token exports with --source-maps and does not upload after a failed export', () => {
    const r = run(FAKE, 7);
    expect(r.argv).toEqual([...ORIGINAL_ARGS, '--source-maps']);
    expect(r.status).toBe(7);
    expect(r.output).not.toMatch(/Uploading|uploaded to Sentry/);
    expect(r.output).not.toContain(FAKE.SENTRY_AUTH_TOKEN);
  });
});
