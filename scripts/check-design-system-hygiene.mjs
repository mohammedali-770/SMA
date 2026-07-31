#!/usr/bin/env node
/**
 * Guards the NEW design-system code against re-introducing raw values.
 *
 * Deliberately SCOPED, not repo-wide. The existing screens legitimately carry
 * hundreds of literal colours and sizes and will be migrated in a later PR;
 * failing the whole repo today would either block every unrelated change or
 * force a risky mass rewrite. This checks only the directories that are
 * supposed to be token-pure, so the new surface cannot rot while the old one
 * is being migrated.
 *
 *   node scripts/check-design-system-hygiene.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Only these trees must be token-pure. */
const SCOPED_DIRS = [
  join(ROOT, 'design-system'),
  join(ROOT, 'src', 'design-system'),
  join(ROOT, 'apps', 'mobile', 'src', 'design-system'),
];

/** The canonical token/money modules are where literals are *supposed* to live. */
const LITERAL_ALLOWLIST = new Set(['tokens.ts', 'money.ts']);

const RULES = [
  {
    id: 'hardcoded-colour',
    // #abc, #aabbcc, #aabbccdd, rgb(), rgba(), hsl()
    re: /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/,
    message: 'hardcoded colour — import from the design-system tokens instead',
    skipInAllowlisted: true,
  },
  {
    id: 'currency-string',
    // The visible mark is the official SAMA SVG. Never letters, never U+20C0.
    re: /(['"`])\s*(SAR|ر\.س|﷼)\s*\1|⃀/,
    message: 'currency string — render <SaudiRiyalSymbol /> via <Price>, never a text code',
    skipInAllowlisted: false,
  },
  {
    id: 'font-family-literal',
    re: /fontFamily\s*:\s*['"`](?!.*\$)/,
    message: 'font-family literal — use tokens.fontFamily',
    skipInAllowlisted: true,
  },
  {
    id: 'raw-shadow',
    re: /shadowColor\s*:\s*['"`]#/,
    message: 'raw shadow colour — use the elevation tokens',
    skipInAllowlisted: true,
  },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

const violations = [];

/**
 * `npx expo start --web` rewrites apps/mobile/tsconfig.json#include, stripping
 * the .expo generated-types entry and expo-env.d.ts. That edit is made by the Expo
 * CLI, not authored, and silently removes the generated router types from
 * typechecking. A visual-review session must not be able to commit it.
 *
 * See docs/DEV_VISUAL_REVIEW.md.
 */
const MOBILE_TSCONFIG = 'apps/mobile/tsconfig.json';
const REQUIRED_TSCONFIG_INCLUDES = ['.expo/types/**/*.ts', 'expo-env.d.ts'];
{
  const full = join(ROOT, MOBILE_TSCONFIG);
  if (existsSync(full)) {
    let includes = [];
    try {
      includes = JSON.parse(readFileSync(full, 'utf8')).include ?? [];
    } catch {
      violations.push({
        file: MOBILE_TSCONFIG, line: 0, rule: 'tsconfig-unparseable',
        message: 'could not be parsed as JSON', snippet: '',
      });
    }
    for (const required of REQUIRED_TSCONFIG_INCLUDES) {
      if (!includes.includes(required)) {
        violations.push({
          file: MOBILE_TSCONFIG, line: 0, rule: 'expo-rewrote-tsconfig',
          message: `"include" is missing ${required} — this is the edit \`expo start --web\` makes. Run: git checkout -- ${MOBILE_TSCONFIG}`,
          snippet: JSON.stringify(includes),
        });
      }
    }
  }
}


/**
 * GLOBAL: the mobile app has no legacy UI left.
 *
 * `apps/mobile/src/theme.ts`, `components/Button.tsx` and `components/Notice.tsx`
 * are DELETED. This scans the whole mobile tree — not a per-surface list — so
 * the ban cannot be sidestepped by adding a new file, which the allowlist
 * approach could not prevent. Reintroducing any of the three now fails CI
 * wherever it is imported from.
 *
 * The per-surface list below is kept for the same reason its entries were never
 * removed: it is a record of what has been migrated, and it still fails if one
 * of those files disappears.
 */
const MOBILE_SRC = join(ROOT, 'apps', 'mobile', 'src');
const BANNED_MOBILE_IMPORT = /from\s+['"][^'"]*(\/theme|\/components\/Button|\/components\/Notice)['"]/;

for (const file of walk(MOBILE_SRC)) {
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (BANNED_MOBILE_IMPORT.test(line)) {
      violations.push({
        file: relative(ROOT, file), line: i + 1, rule: 'legacy-mobile-ui-import',
        message: 'the legacy theme / Button / Notice are deleted — use design-system/ui',
        snippet: line.trim().slice(0, 100),
      });
    }
  });
}

/** These three must stay deleted. */
for (const gone of ['theme.ts', join('components', 'Button.tsx'), join('components', 'Notice.tsx')]) {
  if (existsSync(join(MOBILE_SRC, gone))) {
    violations.push({
      file: `apps/mobile/src/${gone.replace(/\\/g, '/')}`, line: 0, rule: 'legacy-mobile-ui-restored',
      message: 'this legacy component was deleted and must not come back',
      snippet: '',
    });
  }
}

/**
 * Surfaces that have completed their design-system migration. Kept as a record,
 * and as a guard that these files continue to exist.
 *
 * Add files here as each surface lands. Do not remove entries.
 */
const MIGRATED_SURFACES = [
  // Surface 1 — Authentication
  'apps/mobile/src/features/auth/LoginScreen.tsx',
  'apps/mobile/src/features/auth/PhoneOtpLogin.tsx',
  'apps/mobile/src/features/profile/VerifyPhoneWhatsApp.tsx',
  'apps/mobile/src/components/SaudiPhoneInput.tsx',
  'apps/mobile/src/features/otp/OtpCodeInput.tsx',
  // Surface 2 — Home + Menu
  'apps/mobile/src/features/menu/HomeMenuScreen.tsx',
  'apps/mobile/src/features/menu/BannerCarousel.tsx',
  'apps/mobile/src/components/StateViews.tsx',
  'apps/mobile/src/components/OpenClosedBadge.tsx',
  'apps/mobile/src/components/Screen.tsx',
  'apps/mobile/src/components/Logo.tsx',
  // Surface 3 — Product Details + Cart
  'apps/mobile/src/features/product/ProductDetailScreen.tsx',
  'apps/mobile/src/features/cart/CartScreen.tsx',
  'apps/mobile/src/components/QtyStepper.tsx',
  'apps/mobile/src/components/Header.tsx',
  // Surface 4 — Checkout + Payment
  'apps/mobile/src/features/checkout/CheckoutScreen.tsx',
  'apps/mobile/src/features/checkout/view/CheckoutFooter.tsx',
  'apps/mobile/src/features/checkout/view/CheckoutLines.tsx',
  'apps/mobile/src/features/checkout/view/CouponRow.tsx',
  'apps/mobile/src/features/checkout/view/DeliveryLocationSection.tsx',
  'apps/mobile/src/features/checkout/view/Dialog.tsx',
  'apps/mobile/src/features/checkout/view/LoyaltyToggle.tsx',
  'apps/mobile/src/features/checkout/view/OrderTypeRow.tsx',
  'apps/mobile/src/features/checkout/view/PaymentMethodPicker.tsx',
  'apps/mobile/src/features/checkout/view/PaymentStatusDialog.tsx',
  'apps/mobile/src/features/checkout/view/SavedAddressList.tsx',
  'apps/mobile/src/features/checkout/view/Section.tsx',
  'apps/mobile/src/features/checkout/view/layout.ts',
  'apps/mobile/src/features/checkout/view/TotalsCard.tsx',
  'apps/mobile/src/app/payment/checkout.tsx',
  'apps/mobile/src/app/payment/return.tsx',
  // Surface 5 - Order Tracking + Receipt + Profile
  'apps/mobile/src/features/orders/OrdersScreen.tsx',
  'apps/mobile/src/features/orders/ReceiptScreen.tsx',
  'apps/mobile/src/features/orders/view/ConfirmationHero.tsx',
  'apps/mobile/src/features/orders/view/OrderCard.tsx',
  'apps/mobile/src/features/orders/view/ReceiptBody.tsx',
  'apps/mobile/src/features/orders/view/ReceiptRow.tsx',
  'apps/mobile/src/features/orders/view/Skeletons.tsx',
  'apps/mobile/src/features/orders/view/confirmationTone.ts',
  'apps/mobile/src/features/profile/ProfileScreen.tsx',
  'apps/mobile/src/features/account/DeleteAccountScreen.tsx',
  'apps/mobile/src/features/notifications/NotificationSettings.tsx',
  'apps/mobile/src/features/legal/LegalListScreen.tsx',
  'apps/mobile/src/features/legal/LegalDocScreen.tsx',
  // Surface 6 - Order Type Selection + legacy removal
  'apps/mobile/src/features/order/OrderTypeSelectScreen.tsx',
  'apps/mobile/src/design-system/ui/ContentColumn.tsx',
];

const LEGACY_IMPORT = /from\s+['"][^'"]*(\/theme|\/components\/Button)['"]/;

for (const rel of MIGRATED_SURFACES) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) {
    violations.push({
      file: rel, line: 0, rule: 'migrated-surface-missing',
      message: 'listed as migrated but the file does not exist — update MIGRATED_SURFACES',
      snippet: '',
    });
    continue;
  }
  readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (LEGACY_IMPORT.test(line)) {
      violations.push({
        file: rel, line: i + 1, rule: 'legacy-import-in-migrated-surface',
        message: 'migrated surface may not import the legacy theme or legacy Button',
        snippet: line.trim().slice(0, 100),
      });
    }
  });
}



for (const dir of SCOPED_DIRS) {
  for (const file of walk(dir)) {
    const base = file.split(/[\\/]/).pop();
    const allowlisted = LITERAL_ALLOWLIST.has(base);
    const raw = readFileSync(file, 'utf8');
    // Comments may discuss values freely (the docblocks explain exactly which
    // literals are banned). Blank out block comments while PRESERVING newlines
    // so reported line numbers still point at real code.
    const withoutBlocks = raw.replace(/\/\*[\s\S]*?\*\//g, (m) =>
      m.replace(/[^\n]/g, ' '),
    );
    const lines = raw.split(/\r?\n/);
    const codeLines = withoutBlocks.split(/\r?\n/);

    codeLines.forEach((codeLine, i) => {
      const line = lines[i] ?? codeLine;
      const code = codeLine.replace(/\/\/.*$/, '');
      if (!code.trim()) return;
      if (/eslint-disable|design-system-allow/.test(line)) return;

      for (const rule of RULES) {
        if (allowlisted && rule.skipInAllowlisted) continue;
        if (rule.re.test(code)) {
          violations.push({
            file: relative(ROOT, file),
            line: i + 1,
            rule: rule.id,
            message: rule.message,
            snippet: line.trim().slice(0, 100),
          });
        }
      }
    });
  }
}

if (violations.length) {
  console.error(`Design-system hygiene: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
    console.error(`    ${v.message}`);
    console.error(`    > ${v.snippet}\n`);
  }
  console.error('Add `// design-system-allow` on the line if it is a justified exception.');
  process.exit(1);
}

console.log('Design-system hygiene: clean.');
