/**
 * Expo app config.
 *
 * `app.json` remains the single source of truth for every static field,
 * including the Sentry plugin's organization/project/url. This file adds ONE
 * piece of dynamic behaviour: it removes the `@sentry/react-native/expo`
 * config plugin when `SENTRY_AUTH_TOKEN` is absent from the build environment.
 *
 * WHY. That plugin wires the native source-map / debug-symbol upload into the
 * iOS and Android release builds. With no token the upload step fails and takes
 * the whole production build down with it:
 *
 *   Task :app:createBundleReleaseJsAndAssets_SentryUpload_... FAILED
 *   error: Auth token is required for this request
 *
 * This mirrors the web build exactly — `vite.config.ts` gates the Sentry Vite
 * plugin on `Boolean(process.env.SENTRY_AUTH_TOKEN)` — so both surfaces degrade
 * to "no source maps" instead of "no build", and both start uploading
 * automatically the moment the token exists. Nothing to remember to switch off,
 * which is what the previous static `SENTRY_DISABLE_AUTO_UPLOAD` flag in
 * `eas.json` required.
 *
 * WHAT THIS DOES NOT AFFECT: crash reporting itself. The native SDK is
 * autolinked from the `@sentry/react-native` dependency and started by
 * `Sentry.init()` in `src/lib/observability`; Debug IDs come from the
 * `getSentryExpoConfig` Metro wrapper in `metro.config.js`. Only the BUILD-TIME
 * UPLOAD wiring is conditional here. Events still flow in every case — stack
 * traces are simply unsymbolicated until a token is configured.
 *
 * Deliberately plain JavaScript, not TypeScript: Expo requires `ts-node` to
 * evaluate an `app.config.ts` and it is not a dependency of this package.
 * Adding it would mean a lockfile change, and a missing `ts-node` at build time
 * breaks config resolution for every build.
 */

const SENTRY_PLUGIN_PREFIX = '@sentry/react-native';

/** Plugin entries are either `"name"` or `["name", options]`. */
const pluginName = (entry) => (Array.isArray(entry) ? entry[0] : entry);

const isSentryPlugin = (entry) => {
  const name = pluginName(entry);
  return typeof name === 'string' && name.startsWith(SENTRY_PLUGIN_PREFIX);
};

module.exports = ({ config }) => {
  // Token present: hand back the app.json config completely untouched, so what
  // reaches a production build is bit-for-bit the configuration that ships
  // today. Only the no-token path below deviates.
  if (process.env.SENTRY_AUTH_TOKEN) return config;

  return {
    ...config,
    plugins: (config.plugins ?? []).filter((entry) => !isSentryPlugin(entry)),
  };
};
