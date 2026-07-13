/**
 * Pure, framework-free decision for HOW to present Tap's hosted checkout, chosen
 * from the mode that payment-initiate reports. Unit-tested under Node (see
 * paymentFlow.test.ts) and imported by CheckoutScreen.
 *
 * Why the split:
 *   - TEST mode → the in-app WebView. Tap-hosted 3DS stays on Tap domains in the
 *     sandbox, so the strict allow-list can police the whole flow in-app.
 *   - LIVE (or an UNKNOWN mode) → the external auth browser. A live 3DS challenge
 *     redirects to the card issuer's own ACS domain (off-Tap), which the in-app
 *     allow-list intentionally blocks; the system browser can follow it. We fall
 *     back for anything that isn't an explicit 'test' so an unrecognised mode can
 *     never wedge a real payment inside the WebView.
 *
 * Either transport is server-authoritative: the app NEVER trusts the redirect
 * result — payment-verify is the only source of truth in both cases.
 */
export type CheckoutTransport = 'in-app-webview' | 'external-browser';

export function chooseCheckoutTransport(mode: string | null | undefined): CheckoutTransport {
  return mode === 'test' ? 'in-app-webview' : 'external-browser';
}
