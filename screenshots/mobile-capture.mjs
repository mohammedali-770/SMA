/**
 * Captures the customer app's screens from the preview harness.
 *
 * The app is gated behind a real Supabase session, so it is served with
 * SPICY_MEAL_PREVIEW=1, which makes Metro resolve `services/api` to
 * apps/mobile/preview/apiStub.ts. The screens, providers, navigation and theme
 * are the real ones; only the data is synthetic.
 *
 *   cd apps/mobile
 *   SPICY_MEAL_PREVIEW=1 npx expo start --web --port 8085
 *   node screenshots/mobile-capture.mjs            # both languages
 *   node screenshots/mobile-capture.mjs en         # one language
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:8085';
const OUT = 'screenshots/mobile-out';
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const LANGS = ARGS.length ? ARGS : ['en', 'ar'];
// Dark mode follows the device, so the harness just tells Chromium it prefers
// dark and React Native Web's useColorScheme reports it — the same path a real
// phone on its evening schedule takes.
const DARK = process.argv.includes('--dark');
const SUFFIX = DARK ? '-dark' : '';

mkdirSync(OUT, { recursive: true });

// The environment ships Chromium at a pinned path; the npm-installed Playwright
// expects a different build number, so point at the real binary rather than
// downloading one.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

const problems = [];

/** Tap by visible text, failing loudly rather than capturing the wrong screen. */
async function tap(page, text, { optional = false } = {}) {
  const el = page.getByText(text, { exact: false }).first();
  if (!(await el.count())) {
    if (!optional) problems.push(`not found: ${text}`);
    return false;
  }
  await el.click();
  await page.waitForTimeout(700);
  return true;
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}${SUFFIX}.png`, fullPage: true });
  console.log(`captured ${name}${SUFFIX}`);
}

for (const lang of LANGS) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: DARK ? 'dark' : 'light',
  });
  page.on('pageerror', (e) => problems.push(`[${lang}] pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);

  // The order-type gate is the first thing a customer sees, and it carries the
  // language toggle, so the Arabic run switches here rather than at the menu.
  const isAr = lang === 'ar';
  if (isAr) {
    await tap(page, 'العربية');
    await page.waitForTimeout(1200);
  }
  await shot(page, `${lang}-01-order-type`);

  // Delivery tab: map picker + zone check.
  await tap(page, isAr ? 'توصيل' : 'Delivery');
  await shot(page, `${lang}-02-delivery`);

  // Back to pickup, choose a branch, continue into the menu.
  await tap(page, isAr ? 'استلام' : 'Pickup');
  await tap(page, isAr ? 'فرع العليا' : 'Olaya');
  await tap(page, isAr ? 'متابعة' : 'Continue', { optional: true });
  await page.waitForTimeout(1500);
  await shot(page, `${lang}-03-home-menu`);

  // Fill the cart so Cart and Checkout have something to show. The menu is a
  // virtualized SectionList, so the simple items are scrolled into existence
  // with the wheel rather than located by name — an off-screen row is not in
  // the DOM to be scrolled to.
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(900);
  const addBtn = page.getByText(isAr ? 'إضافة' : 'Add', { exact: true });
  const n = Math.min(await addBtn.count(), 2);
  for (let i = 0; i < n; i += 1) {
    await addBtn.nth(i).click();
    await page.waitForTimeout(500);
  }
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(900);
  await shot(page, `${lang}-03b-home-cart-bar`);

  // Product detail. Cards navigate from their action button, so the route is
  // opened directly rather than by tapping a title that is not pressable.
  await page.goto(`${BASE}/product/p-classic`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, `${lang}-04-product`);

  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, `${lang}-05-cart`);

  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await shot(page, `${lang}-06-checkout`);

  await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await shot(page, `${lang}-07-orders`);

  await page.goto(`${BASE}/receipt/o-1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await shot(page, `${lang}-08-receipt`);

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, `${lang}-09-profile`);

  await page.goto(`${BASE}/legal`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, `${lang}-10-legal`);

  await page.close();
}

await browser.close();

if (problems.length) {
  console.error('\nProblems:');
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
}
