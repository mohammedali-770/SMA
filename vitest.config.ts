import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the unit suite runs without the
// React/Tailwind plugins. Pure-logic suites default to the fast `node`
// environment; the provider tests opt into jsdom per-file via a
// `// @vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
