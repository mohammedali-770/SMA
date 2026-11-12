/**
 * R07#5: customer sign-in errors are announced, and the policy links in the
 * consent sentence are real links.
 *
 * A wrong or expired code, a rate limit or a network failure appeared as plain
 * caption text, so a screen-reader user heard nothing (WCAG 4.1.3). The Terms
 * and Privacy links were pressable spans with no role and tabIndex -1, so a
 * keyboard user could not reach the documents they were agreeing to (WCAG
 * 2.1.1 / 4.1.2). Both screens need a native runtime to render, so the wiring
 * is pinned at source level, with comments stripped.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (name: string) => strip(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));

describe('PhoneOtpLogin errors are announced', () => {
  const code = read('PhoneOtpLogin.tsx');

  it('every error text is an alert with a polite live region', () => {
    const errorTexts = code.match(/<Text[^>]*tone="danger"[^>]*>\s*\{error\}/g) ?? [];
    expect(errorTexts).toHaveLength(2);
    for (const el of errorTexts) {
      expect(el).toMatch(/accessibilityRole="alert"/);
      expect(el).toMatch(/accessibilityLiveRegion="polite"/);
    }
  });

  it('iOS, which honours neither, is told directly', () => {
    expect(code).toMatch(
      /useEffect\(\(\) => \{\s*if \(error && Platform\.OS === 'ios'\) AccessibilityInfo\.announceForAccessibility\(error\);\s*\}, \[error\]\)/,
    );
  });
});

describe('LoginScreen policy links', () => {
  const code = read('LoginScreen.tsx');

  it.each(['terms_conditions', 'privacy_policy'])('%s is a Link with role link', (slug) => {
    expect(code).toMatch(
      new RegExp(
        `<Link href="/legal/${slug}" push style=\\{styles\\.policyLink\\} accessibilityRole="link">`,
      ),
    );
  });

  it('no policy link is left as a pressable span', () => {
    expect(code).not.toMatch(/<RNText style=\{styles\.policyLink\}/);
  });
});
