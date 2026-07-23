import { describe, expect, it } from 'vitest';
import { classifyWebError, isExpectedWebError } from './webClassify';

describe('web expected-error classification', () => {
  it('inherits every shared expected pattern (offline, business declines, auth flows)', () => {
    for (const msg of [
      'Network request failed',
      'Failed to fetch',
      'Invalid login credentials',
      'coupon expired',
      'branch is closed right now',
      'payment cancelled by user',
      'JWT has expired',
    ]) {
      expect(isExpectedWebError(new Error(msg)), msg).toBe(true);
    }
  });

  it('treats browser-only noise as expected (ResizeObserver, aborts)', () => {
    expect(isExpectedWebError(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe(true);
    expect(isExpectedWebError(new Error('The operation was aborted.'))).toBe(true);
    expect(isExpectedWebError(new Error('signal is aborted without reason'))).toBe(true);
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';
    expect(isExpectedWebError(abortError)).toBe(true);
  });

  it('still captures actionable failures (chunk load, invalid shapes, render errors)', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: /assets/AdminDashboard-x.js',
      'Cannot read properties of undefined (reading "summary")',
      'invalid response shape: missing state field',
      'Minified React error #185',
    ]) {
      expect(classifyWebError(new Error(msg)), msg).toBe('capture');
    }
  });
});
