// Sentry-wrapped Expo Metro config: adds Debug IDs to bundles/source maps so
// crashes symbolicate against the maps uploaded during EAS release builds.
// Behaves as the default Expo config in every other respect. Extend here if
// you add SVG transformers, monorepo watch folders, etc.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// Screenshot/preview mode ONLY. With SPICY_MEAL_PREVIEW=1 set, `services/api`
// resolves to preview/apiStub.ts, so the real screens render through the real
// providers against demo rows instead of a live Supabase project. Without the
// variable this block does nothing and the released bundle is unaffected —
// which is why it is an env gate and not a committed alias.
if (process.env.SPICY_MEAL_PREVIEW === '1') {
  const path = require('path');
  const stub = path.resolve(__dirname, 'preview/apiStub.ts');
  const base = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (/(^|\/)services\/api$/.test(moduleName)) {
      return { type: 'sourceFile', filePath: stub };
    }
    return (base ?? context.resolveRequest)(context, moduleName, platform);
  };
}

module.exports = config;
