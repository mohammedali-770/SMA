import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PAYMENT_PAGE_LOAD_TIMEOUT_MS } from './webviewPolicy';

/**
 * The 2026-11-19 payment fixes are decided by call sites, not by logic a unit
 * test can call (vitest cannot render React Native). These read the source with
 * comments removed, so prose about an API can neither satisfy nor trip a check.
 */
const SRC = resolve(__dirname, '../..');
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (rel: string) => strip(readFileSync(resolve(SRC, rel), 'utf8'));

const screen = code('features/checkout/CheckoutScreen.tsx');
const page = code('app/payment/checkout.tsx');

describe('the customer never reads raw server text after a payment error', () => {
  it('no payment state carries e.message', () => {
    expect(screen).not.toMatch(/instanceof Error \? e\.message/);
  });

  it('initiate and verify errors are localized, with the right fallback', () => {
    expect(screen).toMatch(
      /failureMessage\(e, t, \{ subsystem: 'payment', op: 'initiate', fallbackKey: 'payFailed' \}\)/,
    );
    // Whether money moved is not known after a failed verify.
    expect(screen).toMatch(
      /failureMessage\(e, t, \{ subsystem: 'payment', op: 'verify', fallbackKey: 'payUnknown' \}\)/,
    );
  });
});

describe('after a failed card payment', () => {
  it('offers cash only when cash is available', () => {
    expect(screen).toMatch(/onUseCash=\{payMethods\.includes\('cash'\) \? useCashInstead : undefined\}/);
  });

  it('switching to cash selects it and places nothing', () => {
    const body = screen.match(/const useCashInstead = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    expect(body).toContain("setPaymentMethod('cash')");
    expect(body).not.toMatch(/placeOrder|retryFresh|orders\.|checkout\./);
  });

  it('Contact support opens the screen with the support contacts', () => {
    const body = screen.match(/const openHelp = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    expect(body).toContain("router.push('/legal')");
    expect(body).not.toMatch(/clearPendingSession/);
  });
});

describe('the payment page never leaves the customer on a spinner', () => {
  it('gives up waiting for the first paint after a bounded time', () => {
    expect(PAYMENT_PAGE_LOAD_TIMEOUT_MS).toBe(20_000);
    expect(page).toMatch(/setTimeout\(\(\) => setTimedOut\(true\), PAYMENT_PAGE_LOAD_TIMEOUT_MS\)/);
    expect(page).toMatch(/return \(\) => clearTimeout\(timer\)/);
  });

  it('shows Try again / Close on a timeout as on a load error', () => {
    expect(page).toContain('{failed || timedOut ? (');
  });

  it('a page that paints late replaces the message, and Try again re-arms the wait', () => {
    const onLoadEnd = page.match(/onLoadEnd=\{\(\) => \{([\s\S]*?)\}\}/)?.[1] ?? '';
    expect(onLoadEnd).toContain('setTimedOut(false)');
    const reload = page.match(/const reload = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    expect(reload).toContain('setTimedOut(false)');
  });
});

describe('remembered payment method', () => {
  it('is applied once, through rememberedPreselection, never over a choice already made', () => {
    expect(screen).toContain('rememberedPreselection(payment, rememberedMethod, Platform.OS)');
    expect(screen).toContain('setPaymentMethod((prev) => prev ?? preselect)');
    expect(screen).toContain('rememberAppliedRef.current = true');
  });

  it('is saved per account when the customer places an order', () => {
    expect(screen).toContain(
      'if (userId && paymentMethod) void saveLastPaymentMethod(userId, paymentMethod)',
    );
  });
});

describe('checkout timeline report', () => {
  it('sends durations and the outcome only', () => {
    const body =
      screen.match(/const reportTimeline = \(outcome: CheckoutOutcome\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    expect(body).toContain("captureMessage('card checkout timeline'");
    expect(body).toContain("level: 'info'");
    expect(body).toContain('tags: { outcome }');
    expect(body).toContain('extra: tl.marks()');
    expect(body).not.toMatch(/sessionId|orderId|amount|total|phone|profile/);
  });

  it('reports at most once per checkout', () => {
    expect(screen).toContain('if (!tl || !tl.claimReport()) return;');
  });
});
