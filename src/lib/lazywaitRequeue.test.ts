import { describe, it, expect } from 'vitest';
import { lazywaitRequeueEligibility, requeueEligibilityMessage } from './lazywaitRequeue';

const NOW = Date.parse('2026-07-21T00:10:00.000Z');
const future = '2026-07-21T00:15:00.000Z'; // deadline not yet passed
const past = '2026-07-21T00:05:00.000Z';   // deadline already passed

describe('lazywaitRequeueEligibility (mirror of SQL rule)', () => {
  it('requeues a proven-safe failure inside its budget', () => {
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'blocked', order_type: 'pickup', pos_sync_deadline_at: future, sync_attempt_count: 1 }, NOW,
    )).toBe('requeued');
    // 'skipped' (pre-integration, no deadline window) is requeuable
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'skipped', order_type: 'pickup' }, NOW)).toBe('requeued');
  });

  it('rejects a past-deadline order (no false success)', () => {
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'failed', order_type: 'pickup', pos_sync_deadline_at: past, sync_attempt_count: 1 }, NOW,
    )).toBe('deadline_expired');
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'dead_letter', order_type: 'pickup', pos_sync_deadline_at: past, sync_attempt_count: 2 }, NOW,
    )).toBe('deadline_expired');
  });

  it('rejects confirmation_required (manual verification only)', () => {
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'confirmation_required', order_type: 'pickup', pos_sync_deadline_at: future }, NOW,
    )).toBe('confirmation_required');
  });

  it('rejects a synced / ref-bearing order (never resend)', () => {
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'synced', order_type: 'pickup', pos_sync_deadline_at: future }, NOW))
      .toBe('already_synced');
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'blocked', lazywait_ref: 'REF_X', order_type: 'pickup', pos_sync_deadline_at: future }, NOW,
    )).toBe('already_synced');
  });

  it('rejects when the attempt limit is reached', () => {
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'failed', order_type: 'pickup', pos_sync_deadline_at: future, sync_attempt_count: 5 }, NOW,
    )).toBe('attempt_limit_reached');
  });

  it('rejects when the phase marker indicates the request may have left', () => {
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'blocked', order_type: 'pickup', pos_sync_deadline_at: future,
        sync_attempt_count: 1, pos_create_attempted_at: past }, NOW,
    )).toBe('may_have_sent');
  });

  it('rejects delivery and non-retryable states', () => {
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'failed', order_type: 'delivery', pos_sync_deadline_at: future }, NOW))
      .toBe('not_retryable');
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'pending', order_type: 'pickup', pos_sync_deadline_at: future }, NOW))
      .toBe('not_retryable');
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'syncing', order_type: 'pickup', pos_sync_deadline_at: future }, NOW))
      .toBe('not_retryable');
  });

  it('only "requeued" has no internal message', () => {
    expect(requeueEligibilityMessage('requeued')).toBeNull();
    for (const e of ['deadline_expired', 'confirmation_required', 'already_synced', 'may_have_sent', 'attempt_limit_reached', 'not_retryable'] as const) {
      expect(requeueEligibilityMessage(e)).toBeTruthy();
    }
  });
});
