import { defineConfig } from '@playwright/test';

/**
 * End-to-end spec for the built customer web app (`dist/app`).
 *
 *   npm run build && npm run test:e2e
 *
 * The browser reaches the export under a non-localhost name, mapped to
 * 127.0.0.1 by Chromium's resolver, so the app behaves as it does in
 * production (observability resolves `localhost` to development). Every other
 * name resolves to nothing: a request the spec did not intercept cannot leave
 * the machine. See e2e/guest-journey.spec.ts for what it asserts.
 *
 * E2E_CHROMIUM_PATH points at a locally installed Chromium when the one this
 * Playwright version downloads is not present. CI leaves it unset and installs
 * the browser the lockfile's Playwright expects.
 */
const E2E_HOSTNAME = 'spicymeal-review.test';
const PORT = Number(process.env.E2E_PORT ?? '8840');

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `https://${E2E_HOSTNAME}:${PORT}`,
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Direct connections only. A proxy from the environment would resolve
      // names for the browser and undo the resolver rule; `--no-proxy-server`
      // was measured NOT to stop chrome-headless-shell using HTTPS_PROXY.
      args: [
        `--host-resolver-rules=MAP ${E2E_HOSTNAME} 127.0.0.1, MAP * ~NOTFOUND`,
        '--proxy-server=direct://',
      ],
      ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
    },
  },
  webServer: {
    command: `node serve-dist.mjs --port ${PORT}`,
    url: `https://127.0.0.1:${PORT}/app`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
  },
});
