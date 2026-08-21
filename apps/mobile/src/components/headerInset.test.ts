import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * EVERY SCREEN WITH A HEADER GETS ITS TOP INSET EXACTLY ONCE.
 *
 * WHY THIS EXISTS. This defect class has shipped six times in this app, in both
 * directions, and neither direction failed anything:
 *
 *   - Checkout rendered `<Header showBack />` inside a bare `View`, so the
 *     title sat level with the clock and the RTL back pill landed under the
 *     battery cluster — inside the strip where iOS also claims taps for
 *     scroll-to-top, so it was a reachability bug as well as a cosmetic one.
 *   - Four Profile screens did the opposite: wrapped in `Screen` AND passed
 *     `safeTop`, applying `insets.top` twice for ~50px of dead space, across
 *     six call sites.
 *
 * Nothing caught either one. `vitest.config.ts` runs under Node and mobile test
 * files may not import React Native or Expo, so a rendering test cannot exist
 * here — which is exactly why this reads the SOURCE instead. It is a lint with
 * a reason, not a unit test.
 *
 * THE RULE. There are exactly two ways a header gets its top inset, and a
 * screen must use exactly one:
 *
 *   Pattern A   bare root + `<Header safeTop />`
 *               The header's own surface and bottom border extend up through
 *               the status-bar strip. Cart, ProductDetail, OrderTypeSelect,
 *               Checkout.
 *
 *   Pattern B   `<Screen>` (its SafeAreaView defaults to edges including 'top')
 *               + `<Header />` with no `safeTop`.
 *               The strip paints the screen background and the header starts
 *               below it. Legal x2, DeleteAccount, Profile x4.
 *
 * Both are correct; they simply look different, so a screen picks one. Zero is
 * the Checkout bug, two is the Profile bug.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Files that render a header with NO top inset and are knowingly left that way.
 *
 * An entry here is a debt with a reason, not a permanent exemption — and it is
 * itself asserted below, so a fixed file cannot sit in this list unnoticed.
 */
const KNOWN_MISSING_INSET = new Map<string, string>([
  [
    'app/payment/checkout.tsx',
    'Has the same defect Checkout had (bare View root, no safeTop) but sits under '
    + 'the CLAUDE.md §6 payment freeze and the `payments` docs-ownership rule, so it '
    + 'is not folded into a UI change. Remove this entry when the freeze lifts and the '
    + 'screen is fixed.',
  ],
]);

/** The component that DEFINES `safeTop`; scanning it would match its own prop. */
const HEADER_COMPONENT = 'components/Header.tsx';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

/** POSIX-style path relative to apps/mobile/src, so messages read the same everywhere. */
function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

interface Analysis {
  file: string;
  /** A `<Screen>` whose SafeAreaView pads the top (default edges, or 'top' listed). */
  screenTopEdge: boolean;
  /** `safeTop` passed to the Header. */
  headerSafeTop: boolean;
  sources: number;
}

function analyse(file: string, source: string): Analysis {
  const screenTags = source.match(/<Screen\b[^>]*?>/g) ?? [];

  // A parse failure must fail loudly rather than quietly report "no inset" and
  // then be silenced by someone adding an allowlist entry for a phantom bug.
  if (/<Screen\b/.test(source) && screenTags.length === 0) {
    throw new Error(`${rel(file)}: found <Screen but could not parse its opening tag`);
  }

  // `edges` omitted means the Screen default, which includes 'top'.
  const screenTopEdge = screenTags.some(
    (tag) => !/\bedges\s*=/.test(tag) || /['"]top['"]/.test(tag),
  );

  // A bare token test, deliberately, rather than matching inside the `<Header …>`
  // tag: header props can carry nested elements (`left={<X />}`), whose `>` ends
  // any `[^>]*` scan early and would hide a `safeTop` written after it. The
  // component that defines the prop is excluded from the scan, so in any screen
  // file this token is a Header prop.
  const headerSafeTop = /\bsafeTop\b/.test(source);

  return {
    file,
    screenTopEdge,
    headerSafeTop,
    sources: (screenTopEdge ? 1 : 0) + (headerSafeTop ? 1 : 0),
  };
}

const headerScreens: Analysis[] = walk(SRC)
  .filter((file) => rel(file) !== HEADER_COMPONENT)
  .map((file) => [file, readFileSync(file, 'utf8')] as const)
  .filter(([, source]) => /<Header\b/.test(source))
  .map(([file, source]) => analyse(file, source));

describe('header top inset — exactly one source per screen', () => {
  it('finds the header screens at all', () => {
    // Guards the guard: a rename or a moved directory that made the scan match
    // nothing would otherwise turn every assertion below into a silent pass.
    expect(headerScreens.length).toBeGreaterThanOrEqual(10);
  });

  it('never applies the inset twice', () => {
    const doubled = headerScreens.filter((a) => a.sources === 2).map((a) => rel(a.file));
    // `<Screen>` already pads the top; `safeTop` pads it again. Drop one — and
    // prefer dropping `safeTop`, which keeps the screen matching its siblings.
    expect(doubled).toEqual([]);
  });

  it('never leaves a header with no inset at all', () => {
    const bare = headerScreens
      .filter((a) => a.sources === 0)
      .map((a) => rel(a.file))
      .filter((f) => !KNOWN_MISSING_INSET.has(f));
    // The header would render under the status bar, and in RTL the back control
    // lands under the battery cluster where the OS also takes taps.
    expect(bare).toEqual([]);
  });

  it('keeps the known-missing list honest', () => {
    for (const [file, reason] of KNOWN_MISSING_INSET) {
      const found = headerScreens.find((a) => rel(a.file) === file);
      expect(found, `${file} is allowlisted but renders no <Header> — drop the entry`).toBeDefined();
      expect(
        found?.sources,
        `${file} now has a top inset — remove it from KNOWN_MISSING_INSET. Reason it was listed: ${reason}`,
      ).toBe(0);
    }
  });
});

describe('the premise this rule rests on', () => {
  const header = readFileSync(path.join(SRC, HEADER_COMPONENT), 'utf8');

  it('Header applies the top inset ONLY when asked', () => {
    // If `safeTop` ever became the default, Pattern B would silently become the
    // doubled case and every assertion above would be measuring the wrong thing.
    expect(header).toMatch(/safeTop\s*&&\s*\{\s*paddingTop:\s*insets\.top/);
    expect(header).toMatch(/safeTop\?:\s*boolean/);
  });

  it('Screen still pads the top by default', () => {
    // Pattern B depends on this default. An `edges` default that dropped 'top'
    // would turn seven correct screens into seven headers under the status bar.
    const screen = readFileSync(path.join(SRC, 'components/Screen.tsx'), 'utf8');
    expect(screen).toMatch(/edges\s*=\s*\[\s*'top'/);
  });
});
