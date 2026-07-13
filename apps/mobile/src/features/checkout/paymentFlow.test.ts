import { describe, expect, it } from 'vitest';

import { chooseCheckoutTransport } from './paymentFlow';

describe('chooseCheckoutTransport', () => {
  it('TEST mode uses the in-app WebView', () => {
    expect(chooseCheckoutTransport('test')).toBe('in-app-webview');
  });

  it('LIVE mode falls back to the external/auth browser (issuer ACS is off-Tap)', () => {
    expect(chooseCheckoutTransport('live')).toBe('external-browser');
  });

  it('an unknown / missing mode falls back to the external browser (never wedge a real payment in-app)', () => {
    expect(chooseCheckoutTransport(undefined)).toBe('external-browser');
    expect(chooseCheckoutTransport(null)).toBe('external-browser');
    expect(chooseCheckoutTransport('')).toBe('external-browser');
    expect(chooseCheckoutTransport('sandbox')).toBe('external-browser');
    expect(chooseCheckoutTransport('TEST')).toBe('external-browser'); // exact-match only; case matters
  });
});
