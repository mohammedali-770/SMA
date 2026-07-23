import { describe, expect, it } from 'vitest';
import { normalizeTransactionName, normalizeWebRoute } from './webRoutes';

describe('normalizeWebRoute', () => {
  it('templates UUID segments', () => {
    expect(normalizeWebRoute('/orders/7c2f0a1e-9b1d-4c2a-8f3e-1a2b3c4d5e6f'))
      .toBe('/orders/[id]');
  });

  it('templates numeric, hex, and provider-prefixed segments', () => {
    expect(normalizeWebRoute('/orders/12345')).toBe('/orders/[id]');
    expect(normalizeWebRoute('/receipt/9f8e7d6c5b4a3f2e1d0c')).toBe('/receipt/[id]');
    expect(normalizeWebRoute('/payments/tap_Ab12Cd34')).toBe('/payments/[id]');
    expect(normalizeWebRoute('/payments/chg_TS0123456789')).toBe('/payments/[id]');
  });

  it('templates phone- and email-shaped segments', () => {
    expect(normalizeWebRoute('/customers/0501234567')).toBe('/customers/[id]');
    expect(normalizeWebRoute('/customers/+966501234567')).toBe('/customers/[id]');
    expect(normalizeWebRoute('/users/someone@example.com')).toBe('/users/[id]');
    expect(normalizeWebRoute('/users/someone%40example.com')).toBe('/users/[id]');
  });

  it('templates long opaque tokens', () => {
    expect(normalizeWebRoute('/session/aG9wZWZ1bGx5bm90YXRva2VuMTIz')).toBe('/session/[id]');
  });

  it('drops query strings and fragments entirely', () => {
    expect(normalizeWebRoute('/admin/orders?id=42&phone=0501234567')).toBe('/admin/orders');
    expect(normalizeWebRoute('/auth#access_token=opaque123')).toBe('/auth');
    expect(normalizeWebRoute('https://sma.vercel.app/app/product/42?ref=x#y'))
      .toBe('/app/product/[id]');
  });

  it('keeps static route words and template segments untouched', () => {
    expect(normalizeWebRoute('/app/checkout')).toBe('/app/checkout');
    expect(normalizeWebRoute('/product/[id]')).toBe('/product/[id]');
    expect(normalizeWebRoute('/(tabs)/orders')).toBe('/(tabs)/orders');
    expect(normalizeWebRoute('/operations-health')).toBe('/operations-health');
  });

  it('normalizes root, trailing slashes, and origin-only URLs', () => {
    expect(normalizeWebRoute('/')).toBe('/');
    expect(normalizeWebRoute('https://sma.vercel.app')).toBe('/');
    expect(normalizeWebRoute('/orders/123/')).toBe('/orders/[id]');
  });
});

describe('normalizeTransactionName', () => {
  it('normalizes URL-shaped transaction names', () => {
    expect(normalizeTransactionName('/orders/42')).toBe('/orders/[id]');
    expect(normalizeTransactionName('https://a.b/orders/42?x=1')).toBe('/orders/[id]');
  });

  it('passes non-URL names through for stable grouping', () => {
    expect(normalizeTransactionName('AdminDashboard.load')).toBe('AdminDashboard.load');
    expect(normalizeTransactionName('ui.react.render')).toBe('ui.react.render');
  });
});
