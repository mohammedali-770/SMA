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

describe('CheckoutScreen shows a verify result the way recovery reads it', () => {
  const screen = code('features/checkout/CheckoutScreen.tsx');

  it('maps the result through describeVerifyResult and clears only what it calls terminal', () => {
    expect(screen).toContain('const shown = describeVerifyResult(res, { dismissed: opts?.dismissed });');
    expect(screen).toContain('if (shown.terminal) void clearPendingSession();');
  });

  it('keeps no second, inline list of terminal statuses', () => {
    // A second list is how 'refunded' came to clear nothing: recovery and the
    // screen each had their own, and neither knew it.
    expect(screen).not.toMatch(/res\.status === '(failed|cancelled|expired|refunded)'/);
  });
});

describe('the payment WebView lets the page pay, and nothing more', () => {
  const screen = code('app/payment/checkout.tsx');
  // The JSX element, not `useRef<WebView>`: a tag name followed by whitespace.
  const tag = screen.match(/<WebView\s[\s\S]*?\/>/)?.[0] ?? '';

  it('renders exactly one WebView, from the platform-split PaymentWebView', () => {
    expect(screen.match(/<WebView\s/g)).toHaveLength(1);
    expect(screen).toContain("import { WebView } from '../../components/PaymentWebView';");
    expect(tag).not.toBe('');
  });

  it('enables Apple Pay (iOS; the prop is a no-op on Android)', () => {
    expect(tag).toMatch(/^\s*enableApplePay(?:=\{true\})?\s*$/m);
  });

  it('injects nothing into the page and reads nothing from it', () => {
    // Any of these would put a script in the page, which is what costs Apple Pay
    // under react-native-webview, or open a channel from the page into the app.
    expect(screen).not.toMatch(/injectedJavaScript|injectJavaScript/);
    expect(screen).not.toMatch(/\bonMessage\b|\bpostMessage\b/);
    expect(screen).not.toContain('sharedCookiesEnabled');
  });

  it("keeps originWhitelist at ['*'], so every navigation reaches the policy", () => {
    // A narrower list makes react-native-webview hand a non-matching URL to the
    // OS with Linking.openURL instead of asking our handler.
    expect(tag).toMatch(/originWhitelist=\{\[\s*'\*'\s*\]\}/);
  });

  it('decides every navigation, top frame or iframe, from its URL alone', () => {
    expect(tag).toContain('onShouldStartLoadWithRequest={onShouldStart}');
    expect(screen).toContain('decideNavigation(req.url, cfg)');
    // A bank's 3-D Secure challenge can load in an iframe; telling frames apart
    // is how a policy ends up cancelling it.
    expect(screen).not.toContain('isTopFrame');
  });

  it('keeps popups inside the WebView on Android', () => {
    expect(tag).toContain('setSupportMultipleWindows={false}');
  });

  it('never pulls react-native-webview into the web build', () => {
    expect(code('components/PaymentWebView.tsx')).toContain(
      "export { WebView } from 'react-native-webview';",
    );
    expect(code('components/PaymentWebView.web.tsx')).not.toContain('react-native-webview');
  });
});
