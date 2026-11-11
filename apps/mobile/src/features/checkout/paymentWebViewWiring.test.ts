import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Where Moyasar's hosted page opens, and what the WebView lets it do, are
 * decided by call sites and props, not by logic a unit test can call. vitest
 * runs under Node and cannot render React Native, so these read the source with
 * comments removed: prose about a prop can neither satisfy nor trip a check.
 */

const SRC = resolve(__dirname, '../..');

/** Source with comments removed, so prose about an API cannot satisfy a check. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const code = (rel: string) => strip(readFileSync(resolve(SRC, rel), 'utf8'));

describe('CheckoutScreen opens the hosted page only in the in-app WebView', () => {
  const screen = code('features/checkout/CheckoutScreen.tsx');

  it('never hands the hosted page to the system browser', () => {
    // ASWebAuthenticationSession has no documented Apple Pay support, asks the
    // customer to "sign in" to moyasar.com, and tells the app nothing about
    // where the page went.
    expect(screen).not.toContain('openAuthSessionAsync');
    expect(screen).not.toContain('expo-web-browser');
  });

  it('chooses no transport from the mode the server reports', () => {
    expect(screen).not.toMatch(/\binit\.mode\b/);
  });

  it('pushes the in-app route, carrying only the session id', () => {
    expect(screen).toContain(
      "router.push({ pathname: '/payment/checkout', params: { session: sessionId } })",
    );
  });
});
