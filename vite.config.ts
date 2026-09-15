import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import type { PublicLegalDoc } from './src/legal/legalPage';
import { injectPrerender, renderStaticLegal } from './src/legal/prerender';

const LEGAL_SELECT = 'document_type,title_en,title_ar,content_en,content_ar,version,effective_date';

/**
 * Renders the active legal documents into `legal.html` at build time.
 *
 * Play Console's and App Store Connect's policy-URL checks fetch the page and
 * read the markup; they do not run the module that populates it. Until this
 * plugin existed, stripping `<script>` from the deployed page left 253 visible
 * characters saying the documents need JavaScript, in which the word "privacy"
 * did not appear — a required privacy policy that read as absent. See
 * `docs/GO_LIVE_READINESS.md` B7.
 *
 * It FAILS OPEN, deliberately and in every direction: no credentials, an
 * unreachable database, a non-200, an empty result or missing markers all warn
 * and return the HTML untouched, which is exactly the page that ships today.
 * Making a deploy depend on the database being reachable from CI would trade a
 * documented gap for an outage.
 */
function prerenderLegal(): Plugin {
  // Logged through `console` rather than the Rollup plugin context. Vite 6 does
  // not bind that context as `this` in the object-form `transformIndexHtml`
  // handler, so calling a context method there throws a TypeError — and every
  // call in this plugin sits on a FAIL-OPEN path, so it turned "skip quietly
  // and ship today's page" into "break the build". Caught by running the build,
  // not by reading the types: the types say it is fine.
  const note = (msg: string) => console.warn(`[prerender-legal] ${msg}`);

  return {
    name: 'spicy-meal:prerender-legal',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        if (!ctx.filename.endsWith('legal.html')) return html;

        const url = process.env.VITE_SUPABASE_URL;
        const key = process.env.VITE_SUPABASE_ANON_KEY;
        if (!url || !key) {
          note('skipped: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set');
          return html;
        }

        let docs: PublicLegalDoc[];
        try {
          const res = await fetch(`${url}/rest/v1/legal_documents?select=${LEGAL_SELECT}&is_active=eq.true`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          docs = (await res.json()) as PublicLegalDoc[];
        } catch (err) {
          note(`skipped: ${err instanceof Error ? err.message : String(err)}`);
          return html;
        }

        const block = renderStaticLegal(docs, new Date().toISOString().slice(0, 10));
        if (!block) {
          note('skipped: no active document carried any content');
          return html;
        }

        const out = injectPrerender(html, block);
        if (out === null) {
          note('skipped: markers missing from legal.html');
          return html;
        }

        note(`rendered ${docs.length} document(s), ${block.length} bytes`);
        return out;
      },
    },
  };
}

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
      prerenderLegal(),
      ...(uploadSourceMaps
        ? [
            sentryVitePlugin({
              org: 'first-taste-trading-company',
              project: 'react-native',
              telemetry: false,
              release: process.env.VERCEL_GIT_COMMIT_SHA
                ? { name: `spicy-meal-web@${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)}` }
                : undefined,
              sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] },
            }),
          ]
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
      'import.meta.env.VITE_VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV ?? ''),
      'import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
    },
    build: {
      // 'hidden' emits maps without sourceMappingURL comments; combined with
      // filesToDeleteAfterUpload above, no map is ever publicly reachable.
      sourcemap: uploadSourceMaps ? ('hidden' as const) : false,
      rollupOptions: {
        // TWO ENTRIES, NOT ONE. `index.html` is the admin console. `legal.html`
        // is the public policy page that App Store Connect and Play Console
        // require a reviewer to be able to open with no account — see
        // src/legal/legalPage.ts. Keeping it a separate entry is the point: it
        // must not pull the admin bundle, and `vercel.json` routes /legal,
        // /privacy, /terms and /support to it before the catch-all rewrite.
        input: { main: 'index.html', legal: 'legal.html' },
      },
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
