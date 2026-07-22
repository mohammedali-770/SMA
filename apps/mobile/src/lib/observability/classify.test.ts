import { describe, expect, it } from 'vitest';
import {
  classifyError, errorMessage, formatComponentStack, isExpectedError,
  shouldCaptureBoundaryError,
} from './classify';

describe('expected (breadcrumb-only) failures', () => {
  const expected = [
    'Network request failed',
    'Failed to fetch',
    'The Internet connection appears to be offline.',
    'timeout of 10000ms exceeded',
    'Aborted',
    'Request aborted',
    'cancelled by the user',
    'User cancelled the payment',
    'Invalid login credentials',
    'Invalid OTP',
    'Token has expired or is invalid',
    'JWT expired',
    'Invalid Refresh Token: Already Used',
    'Auth session missing!',
    'Rate limit exceeded, try again later',
    'Too many requests',
    'Invalid coupon',
    'Coupon usage limit reached',
    'Branch is closed',
    'This item is unavailable',
    'Product out of stock',
    'Address is outside the delivery zone',
    'Minimum order amount not met',
    'Payment cancelled by customer',
    'Payment declined by the bank',
  ];
  for (const message of expected) {
    it(`treats "${message}" as expected`, () => {
      expect(isExpectedError(new Error(message))).toBe(true);
      expect(classifyError(new Error(message))).toBe('expected');
    });
  }
});

describe('captured (unexpected technical) failures', () => {
  const unexpected = [
    "undefined is not a function (near '...items.map...')",
    "Cannot read property 'total' of null",
    'Invariant Violation: rendered fewer hooks than expected',
    'Unexpected API response shape: missing order id',
    'checkout initialization exception',
    'payment callback parsing error: malformed return payload',
    'order persistence failed after verified payment',
    'impossible state: paid order without payment record',
    'lazywait synchronization invariant broken',
    'JSON Parse error: Unexpected token',
    'Maximum call stack size exceeded',
  ];
  for (const message of unexpected) {
    it(`captures "${message.slice(0, 40)}…"`, () => {
      expect(isExpectedError(new Error(message))).toBe(false);
      expect(classifyError(new Error(message))).toBe('capture');
    });
  }

  it('captures non-Error throws and empty messages', () => {
    expect(classifyError(undefined)).toBe('capture');
    expect(classifyError({ weird: true })).toBe('capture');
    expect(classifyError('')).toBe('capture');
  });
});

describe('errorMessage', () => {
  it('extracts safely from strings, Errors and message-shaped objects', () => {
    expect(errorMessage('boom')).toBe('boom');
    expect(errorMessage(new Error('bang'))).toBe('bang');
    expect(errorMessage({ message: 'shaped' })).toBe('shaped');
    expect(errorMessage(42)).toBe('');
    expect(errorMessage(null)).toBe('');
  });
});

describe('error boundary capture decision', () => {
  it('captures the first error and suppresses repeats until retry', () => {
    expect(shouldCaptureBoundaryError(false)).toBe(true);
    expect(shouldCaptureBoundaryError(true)).toBe(false);
  });
});

describe('formatComponentStack', () => {
  it('trims and bounds the stack, never throws on null', () => {
    expect(formatComponentStack(null)).toBe('');
    expect(formatComponentStack(undefined)).toBe('');
    const stack = Array.from({ length: 40 }, (_, i) => `  in Component${i}`).join('\n');
    const out = formatComponentStack(`\n${stack}\n`);
    expect(out.split('\n')).toHaveLength(20);
    expect(out.startsWith('in Component0')).toBe(true);
  });
});
