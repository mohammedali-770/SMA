import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STRINGS } from '../../i18n/strings';
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

/**
 * The order refusals added by 20261005120000. order-intake passes the
 * server's English sentence through unchanged; these cases pin that each one
 * reaches the customer as copy in their own language, never as the generic
 * apology and never as the English sentence.
 */
describe('order refusals from place_customer_order', () => {
  // Exactly what the server sends, counts included.
  const REFUSALS = [
    ['Please verify your phone number before placing an order.', 'order_phone_unverified', 'errOrderPhoneUnverified'],
    ['You already have 5 orders in progress. Please wait until one is ready before placing another.', 'order_open_limit', 'errOrderOpenLimit'],
    ['You have placed 10 orders in the last hour. Please try again later.', 'order_hourly_limit', 'errOrderHourlyLimit'],
    ['order_items_quantity_max: at most 50 of one item per order line.', 'order_quantity_limit', 'errOrderQuantityLimit'],
  ] as const;

  it.each(REFUSALS)('maps %j to its own copy', (raw, kind, key) => {
    const f = describeFailure(new Error(raw));
    expect(f.kind).toBe(kind);
    expect(f.messageKey).toBe(key);
    expect(STRINGS.en[key]).toBeTruthy();
    expect(STRINGS.ar[key]).toBeTruthy();
    expect(STRINGS.ar[key]).not.toBe(STRINGS.en[key]);
  });

  it('is matched before the generic classifiers', () => {
    // A 500-order count would otherwise read as an HTTP 500.
    expect(describeFailure(new Error('You have placed 500 orders in the last hour. Please try again later.')).kind)
      .toBe('order_hourly_limit');
  });

  it('matches the sentences the migration actually raises', () => {
    // If the server wording changes, the app silently falls back to the
    // generic apology. This reads the migration so that drift fails here.
    const sql = readFileSync(
      resolve(__dirname, '../../../../../supabase/migrations/20261005120000_server_input_bounds.sql'),
      'utf8',
    );
    expect(sql).toContain("message = 'Please verify your phone number before placing an order.'");
    expect(sql).toContain("'You already have %s orders in progress. Please wait until one is ready before placing another.'");
    expect(sql).toContain("'You have placed %s orders in the last hour. Please try again later.'");
    expect(sql).toContain("message    = 'order_items_quantity_max: at most 50 of one item per order line.';");
  });

  it('leaves other order errors on the generic apology, as before', () => {
    expect(describeFailure(new Error('Delivery is currently closed for this branch.')).kind).toBe('unknown');
    expect(describeFailure(new Error('Edge Function returned a non-2xx status code')).kind).toBe('unknown');
  });
});
