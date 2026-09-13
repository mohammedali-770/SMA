/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { BranchReferenceRow, DeliveryRequestRow } from '../../lib/opsApi';
import {
  SECRET_MASK, awaitingRequest, canRequest, displayValue, isAwaiting, isHidden,
  lastAnswered, minutesUntilExpiry, orderedEntries, safeHref, telHref,
} from './branchReference';

const NOW = Date.parse('2026-09-13T12:00:00Z');

function req(over: Partial<DeliveryRequestRow> = {}): DeliveryRequestRow {
  return {
    id: 'r1',
    branchId: 'b1',
    requestedMinutes: 60,
    reasonCode: 'no_driver',
    note: null,
    requestedAt: '2026-09-13T11:30:00Z',
    expiresAt: '2026-09-13T12:30:00Z',
    status: 'pending',
    resolutionNote: null,
    appliedMinutes: null,
    ...over,
  };
}

function entry(over: Partial<BranchReferenceRow> = {}): BranchReferenceRow {
  return {
    id: 'e1',
    branchId: 'b1',
    kind: 'text',
    labelEn: 'Note',
    labelAr: 'ملاحظة',
    valuePlain: 'something',
    sortOrder: 0,
    ...over,
  };
}

describe('delivery request state', () => {
  it('treats a pending request inside its window as awaiting', () => {
    expect(isAwaiting(req(), NOW)).toBe(true);
  });

  it('does NOT treat a pending row past its expiry as awaiting', () => {
    // The server retires a stale request only when somebody touches it, so a
    // row can sit at 'pending' past expires_at. Trusting status alone would
    // tell a cashier the call centre is still coming.
    expect(isAwaiting(req({ expiresAt: '2026-09-13T11:59:00Z' }), NOW)).toBe(false);
  });

  it.each(['accepted', 'declined', 'cancelled', 'expired'] as const)(
    'does not treat a %s request as awaiting', (status) => {
      expect(isAwaiting(req({ status }), NOW)).toBe(false);
    });

  it('reports minutes left, rounded up, and never negative', () => {
    expect(minutesUntilExpiry(req(), NOW)).toBe(30);
    expect(minutesUntilExpiry(req({ expiresAt: '2026-09-13T12:00:01Z' }), NOW)).toBe(1);
    expect(minutesUntilExpiry(req({ expiresAt: '2026-09-13T11:00:00Z' }), NOW)).toBe(0);
  });

  it('finds the awaiting request among a mixed history', () => {
    const rows = [req({ id: 'old', status: 'declined' }), req({ id: 'live' })];
    expect(awaitingRequest(rows, NOW)?.id).toBe('live');
  });

  it('reports the last ANSWERED request only when nothing is waiting', () => {
    const answered = req({ id: 'a', status: 'accepted' });
    expect(lastAnswered([answered], NOW)?.id).toBe('a');
    expect(lastAnswered([req({ id: 'live' }), answered], NOW)).toBeNull();
  });

  it('does not report a withdrawn or expired request as an answer', () => {
    expect(lastAnswered([req({ status: 'cancelled' })], NOW)).toBeNull();
    expect(lastAnswered([req({ status: 'expired' })], NOW)).toBeNull();
  });
});

describe('canRequest mirrors the server refusals', () => {
  it('allows a request when nothing is waiting and delivery runs', () => {
    expect(canRequest({ requests: [], deliveryClosed: false, now: NOW })).toBe(true);
  });

  it('refuses while one is already waiting', () => {
    expect(canRequest({ requests: [req()], deliveryClosed: false, now: NOW })).toBe(false);
  });

  it('refuses while delivery is already closed', () => {
    expect(canRequest({ requests: [], deliveryClosed: true, now: NOW })).toBe(false);
  });

  it('allows again once the waiting request has expired', () => {
    const stale = req({ expiresAt: '2026-09-13T11:00:00Z' });
    expect(canRequest({ requests: [stale], deliveryClosed: false, now: NOW })).toBe(true);
  });
});

describe('reference values', () => {
  it('masks a secret until it is revealed, with a CONSTANT mask', () => {
    const secret = entry({ kind: 'secret', valuePlain: null });
    expect(displayValue(secret, undefined)).toBe(SECRET_MASK);
    // A length-derived mask would leak the length; assert it does not vary.
    expect(displayValue(entry({ kind: 'secret', valuePlain: null, id: 'e2' }), undefined))
      .toBe(SECRET_MASK);
    expect(displayValue(secret, 'revealed-value')).toBe('revealed-value');
  });

  it('reports a secret as hidden only while unrevealed', () => {
    const secret = entry({ kind: 'secret', valuePlain: null });
    expect(isHidden(secret, undefined)).toBe(true);
    expect(isHidden(secret, 'v')).toBe(false);
    expect(isHidden(entry(), undefined)).toBe(false);
  });

  it('shows a plain value directly', () => {
    expect(displayValue(entry({ valuePlain: 'Tuesday' }), undefined)).toBe('Tuesday');
  });
});

describe('safeHref allowlists the scheme', () => {
  it('accepts http and https', () => {
    expect(safeHref(entry({ kind: 'link', valuePlain: 'https://example.com/a' })))
      .toBe('https://example.com/a');
    expect(safeHref(entry({ kind: 'link', valuePlain: 'http://example.com/' })))
      .toBe('http://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('refuses %s', (raw) => {
    expect(safeHref(entry({ kind: 'link', valuePlain: raw }))).toBeNull();
  });

  it('refuses unparseable text and returns null for non-link kinds', () => {
    expect(safeHref(entry({ kind: 'link', valuePlain: 'not a url' }))).toBeNull();
    expect(safeHref(entry({ kind: 'text', valuePlain: 'https://example.com' }))).toBeNull();
  });
});

describe('telHref', () => {
  it('strips formatting and keeps a leading plus', () => {
    expect(telHref(entry({ kind: 'phone', valuePlain: '+966 55 123 4567' })))
      .toBe('tel:+966551234567');
  });

  it('refuses something too short to be a number, and other kinds', () => {
    expect(telHref(entry({ kind: 'phone', valuePlain: '11' }))).toBeNull();
    expect(telHref(entry({ kind: 'text', valuePlain: '+966551234567' }))).toBeNull();
  });
});

describe('orderedEntries', () => {
  it('sorts by the administrator ordering, then label, without mutating input', () => {
    const rows = [
      entry({ id: 'c', sortOrder: 2, labelEn: 'C' }),
      entry({ id: 'b', sortOrder: 1, labelEn: 'B' }),
      entry({ id: 'a', sortOrder: 1, labelEn: 'A' }),
    ];
    const frozen = [...rows];
    expect(orderedEntries(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual(frozen);
  });
});
