import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the unit suite runs without the
// React/Tailwind plugins — these tests exercise pure logic, no DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
