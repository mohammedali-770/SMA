import {sentryVitePlugin} from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // Source-map upload is OPT-IN and secret-gated: it activates only when the
  // SENTRY_AUTH_TOKEN secret exists in the (CI/Vercel) build environment —
  // see Issue #81. Without the token (local dev, previews, current CI) the
  // build behaves exactly as before: no source maps are generated, nothing is
  // uploaded, nothing fails. With the token, hidden source maps are generated
  // for symbolication, uploaded to Sentry, then DELETED from the output so no
  // .map file is ever deployed or publicly served. The token value itself is
  // read by the official plugin from the environment and never logged here.
  const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(uploadSourceMaps
        ? [sentryVitePlugin({
            org: 'first-taste-trading-company',
            project: 'react-native',
            telemetry: false,
            release: process.env.VERCEL_GIT_COMMIT_SHA
              ? {name: `spicy-meal-web@${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)}`}
              : undefined,
            sourcemaps: {filesToDeleteAfterUpload: ['dist/**/*.map']},
          })]
        : []),
    ],
    // Vercel's system values are plain VERCEL_* env vars; Vite only exposes
    // VITE_*-prefixed vars to the client. Alias the two PUBLIC build-metadata
    // values (environment name + deploy commit sha) at build time so Sentry
    // tags preview/production and the release correctly — mirrors what
    // apps/mobile/scripts/export-web.js does for the Expo web export. Empty
    // string = absent; the runtime treats it as unset and falls back to
    // hostname heuristics. No secret is exposed here.
    define: {
      'import.meta.env.VITE_VERCEL_ENV':
        JSON.stringify(process.env.VERCEL_ENV ?? ''),
      'import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA':
        JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
    },
    build: {
      // 'hidden' emits maps without sourceMappingURL comments; combined with
      // filesToDeleteAfterUpload above, no map is ever publicly reachable.
      sourcemap: uploadSourceMaps ? ('hidden' as const) : false,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
