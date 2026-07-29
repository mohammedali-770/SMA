/**
 * Captures the admin console tabs from the screenshot harness.
 *
 * Run the harness first:
 *   npx vite --config vite.screenshots.config.ts
 *   node screenshots/capture.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4180/screenshots/index.html';
const OUT = 'screenshots/out';
mkdirSync(OUT, { recursive: true });

// Sidebar label -> output name. Labels are matched on the rendered button text,
// so a renamed tab fails loudly here rather than silently capturing the wrong one.
const TABS = [
  ['Sales Overview', '01-sales-overview'],
  ['Live Orders', '02-live-orders'],
  ['Menu Management', '03-menu-management'],
  ['Banners', '04-banners'],
  ['Branch Management', '05-branch-management'],
  ['Financial Reports', '06-financial-reports'],
  ['Integrations', '07-integrations'],
  ['Operations Health', '08-operations-health'],
  ['Operations Alerts', '09-operations-alerts'],
  ['Order Integrity', '10-order-integrity'],
  ['Settings', '11-settings'],
  ['Legal Documents', '12-legal-documents'],
];

// The environment ships Chromium at a pinned path; the npm-installed Playwright
// expects a different build number, so point at the real binary instead of
// downloading one (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set here).
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});

const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('text=Sales Overview', { timeout: 20000 });

for (const [label, name] of TABS) {
  const button = page.locator('button', { hasText: label }).first();
  if (!(await button.count())) {
    problems.push(`tab not found: ${label}`);
    continue;
  }
  await button.click();
  // Panels fetch on mount and settle into a loaded or error state; give them a
  // beat rather than racing the first paint.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`captured ${name}`);
}

// The dark playground is the reason .glass-panel-dark changed, so capture it too.
await page.goto(`${BASE}?view=db`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/13-database-playground.png`, fullPage: true });
console.log('captured 13-database-playground');

await browser.close();
if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log(`  ${p}`);
}
