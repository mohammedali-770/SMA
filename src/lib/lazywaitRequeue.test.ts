import { describe, it, expect } from 'vitest';
import { lazywaitRequeueEligibility, requeueEligibilityMessage, isUsablePosRef } from './lazywaitRequeue';

const NOW = Date.parse('2026-07-21T00:10:00.000Z');
const future = '2026-07-21T00:15:00.000Z'; // deadline not yet passed
const past = '2026-07-21T00:05:00.000Z';   // deadline already passed

// JS-trim whitespace samples (built from code points so the source stays ASCII).
const NBSP = String.fromCharCode(0x00a0);
const IDEO = String.fromCharCode(0x3000); // ideographic space
const NNBSP = String.fromCharCode(0x202f); // narrow no-break space
const BOM = String.fromCharCode(0xfeff);
const ZWSP = String.fromCharCode(0x200b);  // NOT trimmed by JS -> usable

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

  it('rejects a usable-ref order as already_synced (never resend)', () => {
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'blocked', lazywait_ref: 'REF_X', order_type: 'pickup', pos_sync_deadline_at: future }, NOW,
    )).toBe('already_synced');
    // a ref padded with whitespace is still usable (trims to non-empty)
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'blocked', lazywait_ref: '  REF_X  ', order_type: 'pickup', pos_sync_deadline_at: future }, NOW,
    )).toBe('already_synced');
    // ZWSP is not JS-trim whitespace, so it counts as a usable ref
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'blocked', lazywait_ref: ZWSP, order_type: 'pickup', pos_sync_deadline_at: future }, NOW,
    )).toBe('already_synced');
  });

  it('blocks resend on ANY non-null ref marker, but does not claim it is usable', () => {
    // A stored marker (even blank / ASCII- or Unicode-whitespace) blocks an
    // automatic resend, but is NOT reported already_synced.
    for (const ref of ['', '   ', '\t', '\n', NBSP, IDEO, NNBSP, BOM, NBSP + IDEO]) {
      expect(isUsablePosRef(ref)).toBe(false);
      expect(lazywaitRequeueEligibility(
        { lazywait_sync_state: 'blocked', lazywait_ref: ref, order_type: 'pickup', pos_sync_deadline_at: future, sync_attempt_count: 1 }, NOW,
      )).toBe('ref_present_unverified');
    }
    // 'synced' with no usable ref is also unverified (not already_synced).
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'synced', order_type: 'pickup', pos_sync_deadline_at: future }, NOW))
      .toBe('ref_present_unverified');
    // null ref + otherwise-safe failure is genuinely requeuable.
    expect(lazywaitRequeueEligibility(
      { lazywait_sync_state: 'failed', lazywait_ref: null, order_type: 'pickup', pos_sync_deadline_at: future, sync_attempt_count: 1 }, NOW,
    )).toBe('requeued');
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

  it('RETRIES a failed delivery order — it syncs now, so it retries like pickup', () => {
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'failed', order_type: 'delivery', pos_sync_deadline_at: future }, NOW))
      .toBe('requeued');
  });

  it('refuses the historical rows blocked under the retired reason', () => {
    // Never attempted, up to a month old, and no deadline to stop them.
    expect(lazywaitRequeueEligibility({
      lazywait_sync_state: 'blocked', order_type: 'delivery',
      sync_blocked_reason: 'delivery_schema_unconfirmed',
    }, NOW)).toBe('not_retryable');
  });

  it('rejects non-retryable states', () => {
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'syncing', order_type: 'delivery', pos_sync_deadline_at: future }, NOW))
      .toBe('not_retryable');
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'pending', order_type: 'pickup', pos_sync_deadline_at: future }, NOW))
      .toBe('not_retryable');
    expect(lazywaitRequeueEligibility({ lazywait_sync_state: 'syncing', order_type: 'pickup', pos_sync_deadline_at: future }, NOW))
      .toBe('not_retryable');
  });

  it('isUsablePosRef matches JS .trim() incl. Unicode whitespace', () => {
    for (const bad of [null, undefined, '', '   ', '\t', '\n', NBSP, IDEO, NNBSP, BOM, NBSP + IDEO]) {
      expect(isUsablePosRef(bad)).toBe(false);
    }
    for (const good of ['REF', '  REF ' + IDEO, ZWSP]) {
      expect(isUsablePosRef(good)).toBe(true);
    }
  });

  it('only "requeued" has no internal message', () => {
    expect(requeueEligibilityMessage('requeued')).toBeNull();
    for (const e of ['deadline_expired', 'confirmation_required', 'already_synced', 'ref_present_unverified', 'may_have_sent', 'attempt_limit_reached', 'not_retryable'] as const) {
      expect(requeueEligibilityMessage(e)).toBeTruthy();
    }
  });
});
