// Sentry-wrapped Expo Metro config: adds Debug IDs to bundles/source maps so
// crashes symbolicate against the maps uploaded during EAS release builds.
// Behaves as the default Expo config in every other respect. Extend here if
// you add SVG transformers, monorepo watch folders, etc.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

module.exports = config;
