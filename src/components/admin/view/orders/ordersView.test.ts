/**
 * Live Orders — derived-state regression tests.
 *
 * Focused on the contracts where a silent change costs money or hides a
 * problem: when advancing an order's status must be confirmed, which POS sync
 * field wins, what an unrecognised state looks like, and which rows a search
 * matches. These were inline expressions inside a 610-line panel, checkable
 * only by clicking through the console.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORDER_FILTER,
  LIVE_ORDERS_PAGE,
  ONLINE_GUARDED_STATUSES,
  ORDER_FILTERS,
  POS_VERIFY_LIMIT,
  POS_VERIFY_REFRESH_MS,
  matchesOrderFilter,
  matchesOrderSearch,
  needsPaymentConfirm,
  orderStatusTone,
  paymentTone,
  syncStateOf,
  syncTone,
  verifyReasonKey,
} from './ordersView';

describe('needsPaymentConfirm — the money contract', () => {
  it('confirms before advancing an order whose ONLINE payment has not completed', () => {
    // Marking an unpaid online order "delivered" hands over food that was never
    // charged for, and the customer's tracking screen then says so too.
    for (const status of ONLINE_GUARDED_STATUSES) {
      expect(needsPaymentConfirm('pending_online', status)).toBe(true);
      expect(needsPaymentConfirm('unpaid', status)).toBe(true);
    }
  });

  it('does NOT confirm for a cash order', () => {
    // A cash order is legitimately unpaid until the driver collects. Prompting
    // on every one would train staff to click through the prompt that matters.
    for (const status of ONLINE_GUARDED_STATUSES) {
      expect(needsPaymentConfirm('cash_required', status)).toBe(false);
    }
  });

  it('does NOT confirm for a paid order', () => {
    for (const status of ONLINE_GUARDED_STATUSES) {
      expect(needsPaymentConfirm('paid', status)).toBe(false);
    }
  });

  it('never confirms for received or cancelled, whatever the payment state', () => {
    // "Received" is where every order starts, and cancelling needs no payment.
    for (const state of ['pending_online', 'unpaid', 'cash_required', 'paid']) {
      expect(needsPaymentConfirm(state, 'received')).toBe(false);
      expect(needsPaymentConfirm(state, 'cancelled')).toBe(false);
    }
  });

  it('guards exactly four statuses', () => {
    expect(ONLINE_GUARDED_STATUSES)
      .toEqual(['preparing', 'ready', 'out_for_delivery', 'delivered']);
  });
});

describe('syncStateOf — POS field precedence', () => {
  it('prefers the current field over the legacy one', () => {
    expect(syncStateOf({ lazywaitSyncState: 'synced', orderSyncStatus: 'sync_failed' }))
      .toBe('synced');
  });

  it('falls back to the legacy field', () => {
    expect(syncStateOf({ lazywaitSyncState: undefined, orderSyncStatus: 'sync_failed' }))
      .toBe('sync_failed');
  });

  it('reads a missing state as not_synced, not as unknown', () => {
    // An order with neither field has not been offered to the POS at all.
    expect(syncStateOf({ lazywaitSyncState: undefined, orderSyncStatus: undefined }))
      .toBe('not_synced');
  });
});

describe('tone mapping', () => {
  it('maps POS sync states', () => {
    expect(syncTone('synced')).toBe('success');
    for (const s of ['blocked', 'failed', 'dead_letter', 'sync_failed']) {
      expect(syncTone(s)).toBe('danger');
    }
    for (const s of ['not_synced', 'skipped']) {
      expect(syncTone(s)).toBe('neutral');
    }
    expect(syncTone('pending')).toBe('warning');
  });

  it('an UNRECOGNISED sync state reads as a warning, never as settled', () => {
    // A new backend state must not arrive on the board looking fine.
    expect(syncTone('brand_new_state')).toBe('warning');
    expect(syncTone('')).toBe('warning');
  });

  it('maps order statuses, with everything mid-flight as warning', () => {
    expect(orderStatusTone('delivered')).toBe('success');
    expect(orderStatusTone('cancelled')).toBe('danger');
    expect(orderStatusTone('received')).toBe('info');
    for (const s of ['preparing', 'ready', 'out_for_delivery']) {
      expect(orderStatusTone(s)).toBe('warning');
    }
  });

  it('maps payment states', () => {
    expect(paymentTone('paid')).toBe('success');
    expect(paymentTone('pending_online')).toBe('warning');
    expect(paymentTone('cash_required')).toBe('info');
    expect(paymentTone('unpaid')).toBe('neutral');
  });

  it('never maps anything to ember', () => {
    // Ember is the one interactive colour; a state painted ember reads as
    // something you can press.
    const tones = [
      syncTone('synced'), syncTone('failed'), syncTone('whatever'),
      orderStatusTone('delivered'), orderStatusTone('cancelled'),
      paymentTone('paid'), paymentTone('unpaid'),
    ];
    for (const t of tones) expect(t).not.toBe('ember');
  });
});

describe('matchesOrderSearch', () => {
  const row = {
    orderNumber: 'SM-1042',
    lazywaitOrderNumber: 'LW-77A',
    customerName: 'Nora Al-Harbi',
    customerPhone: '0551234567',
  };

  it('matches the order number case-insensitively', () => {
    expect(matchesOrderSearch(row, 'sm-1042')).toBe(true);
    expect(matchesOrderSearch(row, 'SM-1042')).toBe(true);
  });

  it('matches the POS order number', () => {
    expect(matchesOrderSearch(row, 'lw-77a')).toBe(true);
  });

  it('matches part of the customer name, either case', () => {
    expect(matchesOrderSearch(row, 'nora')).toBe(true);
    expect(matchesOrderSearch(row, 'HARBI')).toBe(true);
  });

  it('matches the phone against the RAW query, not the lower-cased one', () => {
    // Lower-casing a phone number does nothing, and folding it into the
    // lower-cased comparison would quietly change which digits match.
    expect(matchesOrderSearch(row, '1234')).toBe(true);
    expect(matchesOrderSearch(row, '0551234567')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesOrderSearch(row, '')).toBe(true);
  });

  it('tolerates a missing POS number', () => {
    expect(matchesOrderSearch({ ...row, lazywaitOrderNumber: null }, 'nora')).toBe(true);
    expect(matchesOrderSearch({ ...row, lazywaitOrderNumber: null }, 'lw-77a')).toBe(false);
  });

  it('does not match an unrelated query', () => {
    expect(matchesOrderSearch(row, 'zzz')).toBe(false);
  });
});

describe('matchesOrderFilter', () => {
  it('"all" keeps every status', () => {
    for (const s of ['received', 'preparing', 'cancelled']) {
      expect(matchesOrderFilter(s, 'all')).toBe(true);
    }
  });

  it('any other tab is an exact status match', () => {
    expect(matchesOrderFilter('preparing', 'preparing')).toBe(true);
    expect(matchesOrderFilter('ready', 'preparing')).toBe(false);
  });

  it('offers every status as a tab, in lifecycle order', () => {
    expect(ORDER_FILTERS).toEqual([
      'all', 'active', 'received', 'preparing', 'ready', 'out_for_delivery',
      'delivered', 'cancelled',
    ]);
  });

  it('"active" is the COMPLEMENT of settled, not a list of known statuses', () => {
    for (const s of ['received', 'preparing', 'ready', 'out_for_delivery']) {
      expect(matchesOrderFilter(s, 'active')).toBe(true);
    }
    expect(matchesOrderFilter('delivered', 'active')).toBe(false);
    expect(matchesOrderFilter('cancelled', 'active')).toBe(false);

    // The reason it is a complement: a status added to the workflow later is
    // outstanding work until somebody says otherwise. An allow-list would hide
    // it from the kitchen on the tab the kitchen actually watches.
    expect(matchesOrderFilter('awaiting_driver', 'active')).toBe(true);
  });

  it('the board opens on outstanding work, and the page size is fixed', () => {
    expect(DEFAULT_ORDER_FILTER).toBe('active');
    expect(ORDER_FILTERS).toContain(DEFAULT_ORDER_FILTER);
    // Named so a silent change is a visible diff.
    expect(LIVE_ORDERS_PAGE).toBe(50);
  });
});

describe('the confirmation-required queue', () => {
  it('reads 10 rows every 60 seconds', () => {
    // Named constants so a silent change to either is a visible diff. This is
    // an exception feed, not a live board — polling it harder is not better.
    expect(POS_VERIFY_LIMIT).toBe(10);
    expect(POS_VERIFY_REFRESH_MS).toBe(60_000);
  });

  it('maps every known POS failure reason', () => {
    expect(verifyReasonKey('timeout')).toBe('verify_reason_timeout');
    expect(verifyReasonKey('connection')).toBe('verify_reason_connection');
    expect(verifyReasonKey('missing_ref')).toBe('verify_reason_missing_ref');
    expect(verifyReasonKey('provider_5xx')).toBe('verify_reason_provider_5xx');
  });

  it('an UNKNOWN reason falls through to "ambiguous", never gets dropped', () => {
    // This queue exists precisely for outcomes nobody has classified yet.
    expect(verifyReasonKey('something_new')).toBe('verify_reason_ambiguous_response');
    expect(verifyReasonKey('')).toBe('verify_reason_ambiguous_response');
  });
});
