import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the unit suite runs without the
// React/Tailwind plugins. Pure-logic suites default to the fast `node`
// environment; the provider tests opt into jsdom per-file via a
// `// @vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: 'node',
    // Pure app logic under src/, pure Edge-Function helpers (no Deno APIs), and
    // pure mobile logic (e.g. checkout-session recovery). Mobile test files MUST
    // import only framework-free modules — no React Native / Expo / Supabase.
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/functions/**/*.test.ts',
      'apps/mobile/src/**/*.test.{ts,tsx}',
    ],
  },
});
