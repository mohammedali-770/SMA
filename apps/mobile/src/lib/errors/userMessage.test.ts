import { describe, expect, it } from 'vitest';

import { describeFailure, isConnectivityFailure, technicalText } from './userMessage';

/**
 * The string a customer actually saw printed on the login screen, on a
 * corporate Wi-Fi that intercepts TLS. Pinned verbatim: this is the exact
 * regression this module exists to prevent.
 */
const TLS_ON_CORPORATE_WIFI =
  'fetch failed: UnexpectedException: A TLS error caused the secure connection to fail. (at ExpoModulesCore/Promise.swift:56)';

describe('describeFailure', () => {
  it('reads the reported corporate-Wi-Fi TLS failure as a blocked network, not offline', () => {
    const f = describeFailure(new Error(TLS_ON_CORPORATE_WIFI));
    // The ordering guarantee: the string also contains "fetch failed", so a
    // naive offline check would win and tell the customer to check a
    // connection that is working fine.
    expect(f.kind).toBe('network_blocked');
    expect(f.messageKey).toBe('errNetworkBlocked');
  });

  it('never leaks the technical text through the message key', () => {
    const f = describeFailure(new Error(TLS_ON_CORPORATE_WIFI));
    expect(f.messageKey).not.toContain('TLS');
    expect(f.messageKey).not.toContain('Swift');
    // …but keeps it for diagnostics.
    expect(f.technical).toBe(TLS_ON_CORPORATE_WIFI);
  });

  it.each([
    ['SSL handshake failed', 'network_blocked'],
    ['certificate has expired', 'network_blocked'],
    ['Network request failed', 'offline'],
    ['TypeError: Failed to fetch', 'offline'],
    ['Could not connect to the server', 'offline'],
    ['The request timed out', 'timeout'],
    ['AbortError: aborted', 'timeout'],
    ['429 Too Many Requests', 'rate_limited'],
    ['rate limit exceeded, retry later', 'rate_limited'],
    ['500 Internal Server Error', 'server'],
    ['503 Service Unavailable', 'server'],
    ['Coupon has expired', 'unknown'],
  ] as const)('classifies %j as %s', (raw, kind) => {
    expect(describeFailure(new Error(raw)).kind).toBe(kind);
  });

  it('falls back to the generic apology for anything unrecognised', () => {
    expect(describeFailure(new Error('something odd')).messageKey).toBe('somethingWentWrong');
  });

  it('survives non-Error throws without crashing the screen', () => {
    expect(describeFailure('plain string').kind).toBe('unknown');
    expect(describeFailure(null).kind).toBe('unknown');
    expect(describeFailure(undefined).technical).toBe('');
    expect(describeFailure({ message: 'SSL error' }).kind).toBe('network_blocked');
  });
});

describe('technicalText', () => {
  it('prefers Error.message, then string, then a message property', () => {
    expect(technicalText(new Error('boom'))).toBe('boom');
    expect(technicalText('boom')).toBe('boom');
    expect(technicalText({ message: 'boom' })).toBe('boom');
  });
});

describe('isConnectivityFailure', () => {
  it('separates the network fault from ours', () => {
    expect(isConnectivityFailure('offline')).toBe(true);
    expect(isConnectivityFailure('network_blocked')).toBe(true);
    expect(isConnectivityFailure('timeout')).toBe(true);
    expect(isConnectivityFailure('server')).toBe(false);
    expect(isConnectivityFailure('unknown')).toBe(false);
  });
});
