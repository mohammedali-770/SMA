/**
 * Source maps for the `/app` web export: plan, upload, and make sure none ship.
 *
 * WHY. Without maps, every `/app` error reaches Sentry as minified frames
 * (`o @ entry-….js:914:1211`), and a map that was never produced cannot be
 * uploaded later, so each deploy without one is unreadable for good.
 *
 * THE GATE IS `SENTRY_AUTH_TOKEN`, the same one `vite.config.ts` (console) and
 * `app.config.js` (native) use. Without it, `planWebExport` returns exactly the
 * arguments the export always had and nothing else runs, so local builds,
 * previews without the secret, and CI behave byte-for-byte as before.
 *
 * WITH IT, in this order:
 *   1. `expo export … --source-maps` — Metro writes `entry-<hash>.js.map` next to
 *      the bundle and appends `//# sourceMappingURL=/app/…js.map` to it;
 *   2. upload with `sentry-expo-upload-sourcemaps`, the uploader
 *      `@sentry/react-native` ships, matched by Debug ID;
 *   3. delete every `*.map` under the output — ALWAYS, whether or not 2 worked;
 *   4. strip the `sourceMappingURL` comment, so the shipped bundle does not
 *      point at a file that is not there. This mirrors the console's
 *      `sourcemap: 'hidden'`. The `//# debugId=` comment is kept: it is what
 *      Sentry matches events against;
 *   5. re-scan, and fail the build if any map or map reference survived.
 *
 * A FAILED UPLOAD WARNS AND THE BUILD CONTINUES. That matches the console: the
 * Sentry Vite plugin passes an upload error to `handleRecoverableError(e,
 * false)`, which logs it and does not throw. Production is built by Vercel's
 * Git integration on every merge (CLAUDE.md §13), so failing here would let a
 * Sentry outage or an expired token block a release. What must never happen is
 * a map shipping, and that is what step 5 fails on.
 *
 * NO SECRET IS READ HERE. The token travels in the environment to the uploader
 * and sentry-cli, which read it themselves; this module only tests that it is
 * present and never prints it.
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '../../dist/app';

/** The export's arguments as they were before source maps existed. Do not reorder. */
const BASE_EXPORT_ARGS = Object.freeze([
  'expo',
  'export',
  '--platform',
  'web',
  '--clear',
  '--output-dir',
  OUTPUT_DIR,
]);

/** Same gate as `vite.config.ts` and `app.config.js`. */
const shouldUploadSourceMaps = (env) => Boolean(env.SENTRY_AUTH_TOKEN);

/**
 * Reads org/project/url from the `@sentry/react-native/expo` plugin entry in
 * app.json, the one place the native build already takes them from.
 */
function readSentryPluginConfig(appJson) {
  const plugins = (appJson && appJson.expo && appJson.expo.plugins) || [];
  const entry = plugins.find(
    (p) => Array.isArray(p) && (p[0] === '@sentry/react-native/expo' || p[0] === '@sentry/react-native'),
  );
  return entry && entry[1] ? entry[1] : null;
}

/**
 * The whole decision, with no side effects.
 *
 * `uploadEnv` holds only what this module adds for the uploader; the caller
 * merges it over the process environment, which already carries the token.
 * Org and project come from app.json and win over the environment, as the
 * console's hard-coded plugin options do. The URL honours `SENTRY_URL`.
 */
function planWebExport(env, sentryConfig) {
  if (!shouldUploadSourceMaps(env)) {
    return { sourceMaps: false, exportArgs: [...BASE_EXPORT_ARGS], steps: [] };
  }
  const org = sentryConfig && sentryConfig.organization;
  const project = sentryConfig && sentryConfig.project;
  const upload =
    org && project
      ? {
          args: [OUTPUT_DIR],
          env: {
            SENTRY_ORG: org,
            SENTRY_PROJECT: project,
            SENTRY_URL: env.SENTRY_URL || (sentryConfig && sentryConfig.url) || 'https://sentry.io/',
          },
        }
      : null;
  return {
    sourceMaps: true,
    exportArgs: [...BASE_EXPORT_ARGS, '--source-maps'],
    steps: ['export', 'upload', 'delete-maps', 'strip-map-comments', 'verify'],
    upload,
  };
}

/** Every regular file under `dir`, recursively. Missing dir → []. */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...listFiles(full));
    else if (item.isFile()) out.push(full);
  }
  return out;
}

const isMap = (file) => file.endsWith('.map');
const carriesCode = (file) => /\.(?:m?js|cjs|css|html)$/.test(file);

// Line-anchored, so only a whole-line comment matches, never a string inside
// minified code. `//#` and the legacy `//@` (JS), `/*# … */` (CSS).
const MAP_COMMENT =
  /^(?:\/\/[#@] sourceMappingURL=[^\r\n]*|\/\*[#@] sourceMappingURL=[^\r\n]*?\*\/)(?:\r?\n|$)/gm;

function stripSourceMappingUrl(text) {
  return text.replace(MAP_COMMENT, '');
}

function hasSourceMappingUrl(text) {
  MAP_COMMENT.lastIndex = 0;
  const found = MAP_COMMENT.test(text);
  MAP_COMMENT.lastIndex = 0;
  return found;
}

/** Step 3. Returns the files removed. */
function deleteSourceMaps(dir) {
  const maps = listFiles(dir).filter(isMap);
  for (const file of maps) fs.rmSync(file, { force: true });
  return maps;
}

/** Step 4. Rewrites only files that carry a reference. Returns those files. */
function stripSourceMapComments(dir) {
  const changed = [];
  for (const file of listFiles(dir).filter(carriesCode)) {
    const text = fs.readFileSync(file, 'utf8');
    const next = stripSourceMappingUrl(text);
    if (next !== text) {
      fs.writeFileSync(file, next);
      changed.push(file);
    }
  }
  return changed;
}

/** Step 5. Every map file, and every file still pointing at one. */
function findSourceMapLeaks(dir) {
  const files = listFiles(dir);
  return [
    ...files.filter(isMap).map((file) => ({ file, reason: 'map file' })),
    ...files
      .filter(carriesCode)
      .filter((file) => hasSourceMappingUrl(fs.readFileSync(file, 'utf8')))
      .map((file) => ({ file, reason: 'sourceMappingURL comment' })),
  ];
}

const DEFAULT_OPS = { deleteSourceMaps, stripSourceMapComments, findSourceMapLeaks };

/**
 * Steps 1-5. `runExport` and `runUpload` return a spawnSync-shaped result
 * (`{ status, error }`), so tests drive every branch without spawning anything.
 * Returns the process exit code.
 */
function runWithSourceMaps({ plan, outputDir, runExport, runUpload, log = console, ops = DEFAULT_OPS }) {
  let exitCode = 0;
  try {
    const exported = runExport(plan.exportArgs);
    if (exported.error) log.error('[export-web] failed to run expo export:', exported.error.message);
    exitCode = exported.status ?? 1;

    if (exitCode === 0) {
      const uploaded = plan.upload ? runUpload(plan.upload) : null;
      if (!uploaded || uploaded.error || uploaded.status !== 0) {
        const why = !plan.upload
          ? 'no Sentry organization/project in app.json'
          : uploaded.error
            ? uploaded.error.message
            : `uploader exited ${uploaded.status}`;
        log.warn(
          `[export-web] WARNING: /app source maps were NOT uploaded to Sentry (${why}). ` +
            'This deploy will report minified stack traces. The build continues, as the console build does.',
        );
      } else {
        log.log('[export-web] /app source maps uploaded to Sentry.');
      }
    }
  } finally {
    // Unconditional: a map must not ship whether the export or upload failed.
    const removed = ops.deleteSourceMaps(outputDir);
    const stripped = ops.stripSourceMapComments(outputDir);
    log.log(
      `[export-web] removed ${removed.length} source map(s), stripped ${stripped.length} reference(s).`,
    );
  }

  const leaks = ops.findSourceMapLeaks(outputDir);
  if (leaks.length > 0) {
    log.error('[export-web] source maps would ship in /app — refusing:');
    for (const leak of leaks) log.error(`  ${leak.reason}: ${leak.file}`);
    return 1;
  }
  return exitCode;
}

module.exports = {
  OUTPUT_DIR,
  BASE_EXPORT_ARGS,
  shouldUploadSourceMaps,
  readSentryPluginConfig,
  planWebExport,
  stripSourceMappingUrl,
  hasSourceMappingUrl,
  deleteSourceMaps,
  stripSourceMapComments,
  findSourceMapLeaks,
  runWithSourceMaps,
};
