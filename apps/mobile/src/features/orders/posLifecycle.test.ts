import { describe, it, expect } from 'vitest';
import {
  deriveCustomerPosLifecycle, hasUsablePosRef, posLifecyclePresentation, type CustomerPosLifecycle,
} from './posLifecycle';

describe('deriveCustomerPosLifecycle (customer confirmation safety)', () => {
  it('shows NOTHING for non-pickup (delivery is never sent to POS)', () => {
    expect(deriveCustomerPosLifecycle({ orderType: 'delivery', syncState: 'synced', ref: 'REF' })).toBeNull();
    expect(deriveCustomerPosLifecycle({ orderType: 'delivery', syncState: 'pending' })).toBeNull();
  });

  it('says "confirmed" ONLY for synced + a usable POS ref', () => {
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'synced', ref: 'REF_1' }))
      .toBe('confirmed_by_restaurant');
    // trimmed non-empty ref is usable
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'synced', ref: '  REF_2  ' }))
      .toBe('confirmed_by_restaurant');
  });

  it('NEVER says confirmed for a synced row without a usable ref (falls back to verify)', () => {
    // null / missing ref
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'synced' }))
      .toBe('pos_confirmation_required');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'synced', ref: null }))
      .toBe('pos_confirmation_required');
    // empty / whitespace-only ref
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'synced', ref: '' }))
      .toBe('pos_confirmation_required');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'synced', ref: '   ' }))
      .toBe('pos_confirmation_required');
    // non-string ref (defensive; runtime data)
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'synced', ref: 123 as unknown }))
      .toBe('pos_confirmation_required');
  });

  it('hasUsablePosRef normalizes correctly', () => {
    expect(hasUsablePosRef('REF')).toBe(true);
    expect(hasUsablePosRef('  x ')).toBe(true);
    expect(hasUsablePosRef('')).toBe(false);
    expect(hasUsablePosRef('   ')).toBe(false);
    expect(hasUsablePosRef(null)).toBe(false);
    expect(hasUsablePosRef(undefined)).toBe(false);
    expect(hasUsablePosRef(42)).toBe(false);
  });

  it('never says confirmed for ambiguous/failed states', () => {
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'confirmation_required' }))
      .toBe('pos_confirmation_required');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'dead_letter' }))
      .toBe('pos_sync_failed');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'blocked' }))
      .toBe('pos_sync_failed');
  });

  it('first submission vs retrying is driven by first_pos_sync_failure_at', () => {
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'pending' }))
      .toBe('submitting_to_restaurant');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'syncing' }))
      .toBe('submitting_to_restaurant');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'pending', firstFailureAt: '2026-07-20T00:00:00Z' }))
      .toBe('retrying_pos_sync');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'syncing', firstFailureAt: '2026-07-20T00:00:00Z' }))
      .toBe('retrying_pos_sync');
  });

  it('failed is "retrying" while a next attempt is queued, else "failed"', () => {
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'failed', nextAttemptAt: '2026-07-20T00:05:00Z' }))
      .toBe('retrying_pos_sync');
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'failed', nextAttemptAt: null }))
      .toBe('pos_sync_failed');
  });

  it('shows NOTHING before payment (awaiting_payment) or for pre-integration (skipped)/unknown', () => {
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'awaiting_payment' })).toBeNull();
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'skipped' })).toBeNull();
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: null })).toBeNull();
    expect(deriveCustomerPosLifecycle({ orderType: 'pickup', syncState: 'made_up_state' })).toBeNull();
  });
});

describe('posLifecyclePresentation', () => {
  const cases: Array<[CustomerPosLifecycle, string, string]> = [
    ['submitting_to_restaurant', 'pos_lc_submitting', 'info'],
    ['retrying_pos_sync', 'pos_lc_retrying', 'warning'],
    ['confirmed_by_restaurant', 'pos_lc_confirmed', 'success'],
    ['pos_confirmation_required', 'pos_lc_verify', 'warning'],
    ['pos_sync_failed', 'pos_lc_failed', 'danger'],
  ];
  it('maps every lifecycle to a label/body key + tone', () => {
    for (const [lc, labelKey, tone] of cases) {
      const p = posLifecyclePresentation(lc);
      expect(p.labelKey).toBe(labelKey);
      expect(p.bodyKey).toBe(`${labelKey}_body`);
      expect(p.tone).toBe(tone);
    }
  });
});
