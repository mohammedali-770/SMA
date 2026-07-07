// Default Expo Metro config. Extend here if you add SVG transformers, monorepo
// watch folders, etc. Kept minimal for the first pass.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
