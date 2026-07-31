/**
 * Operations Health — derived-value tests.
 *
 * These lock the values an operator's trust actually rests on: how stale a
 * reading is, which panel a card sends them to, and whether an unrecognised
 * incident still appears. Each was an inline expression before the migration,
 * verifiable only by rendering the panel.
 *
 * `now` is injected so the clock is not a source of flake.
 */
import { describe, expect, it } from 'vitest';

import {
  HEALTH_POLL_INTERVAL_MS,
  attentionText,
  attentionTone,
  booleanValue,
  exactTime,
  healthStateTone,
  navTargetFor,
  numberValue,
  relativeAge,
  sourceLabel,
  stringValue,
} from './healthView';
import type { OperationsHealthAttention } from '../../../../lib/operationsHealthApi';

/** 2026-01-01T00:00:00Z */
const NOW = 1767225600000;
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('polling contract', () => {
  it('refreshes every 60 seconds', () => {
    // A silent change here alters how quickly an operator learns a subsystem
    // has failed, and nothing else in the code would look different.
    expect(HEALTH_POLL_INTERVAL_MS).toBe(60_000);
  });
});

describe('relativeAge', () => {
  it('renders an em dash for missing or unparseable input', () => {
    // A broken reading must not look like a fresh one.
    expect(relativeAge(null, 'en', NOW)).toBe('—');
    expect(relativeAge(undefined, 'en', NOW)).toBe('—');
    expect(relativeAge('not-a-date', 'en', NOW)).toBe('—');
  });

  it('switches unit exactly at each boundary (en)', () => {
    expect(relativeAge(ago(0), 'en', NOW)).toBe('0s ago');
    expect(relativeAge(ago(59), 'en', NOW)).toBe('59s ago');
    expect(relativeAge(ago(60), 'en', NOW)).toBe('1m ago');
    expect(relativeAge(ago(3599), 'en', NOW)).toBe('59m ago');
    expect(relativeAge(ago(3600), 'en', NOW)).toBe('1h ago');
    expect(relativeAge(ago(86399), 'en', NOW)).toBe('23h ago');
    expect(relativeAge(ago(86400), 'en', NOW)).toBe('1d ago');
  });

  it('switches unit exactly at each boundary (ar)', () => {
    expect(relativeAge(ago(30), 'ar', NOW)).toBe('قبل 30 ث');
    expect(relativeAge(ago(60), 'ar', NOW)).toBe('قبل 1 د');
    expect(relativeAge(ago(3600), 'ar', NOW)).toBe('قبل 1 س');
    expect(relativeAge(ago(86400), 'ar', NOW)).toBe('قبل 1 يوم');
  });

  it('clamps a future timestamp to zero', () => {
    expect(relativeAge(new Date(NOW + 5000).toISOString(), 'en', NOW)).toBe('0s ago');
  });
});

describe('exactTime', () => {
  it('renders an em dash for missing or unparseable input', () => {
    expect(exactTime(null, 'en')).toBe('—');
    expect(exactTime('nonsense', 'en')).toBe('—');
  });

  it('produces a non-empty localized string for a valid instant', () => {
    // The exact format is the platform's; only that it renders is our contract.
    expect(exactTime(ago(0), 'en')).not.toBe('—');
    expect(exactTime(ago(0), 'ar')).not.toBe('—');
  });
});

describe('detail readers degrade safely', () => {
  it('numberValue rejects non-finite and non-number', () => {
    // This panel is opened WHEN something is wrong; a malformed field must
    // degrade to zero, never to a blank screen.
    expect(numberValue({ a: 5 }, 'a')).toBe(5);
    expect(numberValue({ a: 0 }, 'a')).toBe(0);
    expect(numberValue({ a: NaN }, 'a')).toBe(0);
    expect(numberValue({ a: Infinity }, 'a')).toBe(0);
    expect(numberValue({ a: '5' }, 'a')).toBe(0);
    expect(numberValue({}, 'missing')).toBe(0);
  });

  it('stringValue rejects empty and non-string', () => {
    expect(stringValue({ a: 'tap' }, 'a')).toBe('tap');
    expect(stringValue({ a: '' }, 'a')).toBeNull();
    expect(stringValue({ a: 5 }, 'a')).toBeNull();
    expect(stringValue({}, 'missing')).toBeNull();
  });

  it('booleanValue distinguishes false from absent', () => {
    // false means "we know it is off"; null means "we do not know".
    expect(booleanValue({ a: true }, 'a')).toBe(true);
    expect(booleanValue({ a: false }, 'a')).toBe(false);
    expect(booleanValue({ a: 'true' }, 'a')).toBeNull();
    expect(booleanValue({}, 'missing')).toBeNull();
  });
});

describe('healthStateTone', () => {
  it('maps faults to danger and degradation to warning', () => {
    expect(healthStateTone('failing')).toBe('danger');
    expect(healthStateTone('configuration_error')).toBe('danger');
    expect(healthStateTone('degraded')).toBe('warning');
    expect(healthStateTone('healthy')).toBe('success');
  });

  it('treats idle as INFO, not success', () => {
    // "No pending work" is not the same claim as "working correctly".
    expect(healthStateTone('idle')).toBe('info');
  });

  it('treats every not-a-fault state as neutral', () => {
    // None of these is actionable; tinting them amber fills the page with
    // warnings nobody can act on, which is how real warnings stop being read.
    for (const s of ['disabled', 'not_configured', 'not_monitored', 'unavailable'] as const) {
      expect(healthStateTone(s)).toBe('neutral');
    }
  });

  it('never maps a state to ember', () => {
    for (const s of ['healthy', 'idle', 'degraded', 'failing', 'disabled'] as const) {
      expect(healthStateTone(s)).not.toBe('ember');
    }
  });
});

describe('navTargetFor', () => {
  it('sends order integrity to its own panel', () => {
    expect(navTargetFor('order_integrity')).toBe('integrity');
  });

  it('sends every provider-backed system to integrations', () => {
    for (const id of ['lazywait', 'payment', 'push', 'email', 'otp'] as const) {
      expect(navTargetFor(id)).toBe('integrations');
    }
  });

  it('offers no link for systems with no panel', () => {
    // A link to a panel that shows nothing about the system is worse than none.
    expect(navTargetFor('account_deletion')).toBeNull();
    expect(navTargetFor('database_jobs')).toBeNull();
  });
});

describe('attentionText', () => {
  const item = (code: string, subsystem = 'payment'): OperationsHealthAttention =>
    ({ code, subsystem, severity: 'warning', count: 1, oldest_at: null } as OperationsHealthAttention);

  it('uses known copy in both languages', () => {
    expect(attentionText(item('PAYMENT_INTEGRITY_INCIDENTS'), 'en'))
      .toBe('Payment integrity incidents require investigation.');
    expect(attentionText(item('PAYMENT_INTEGRITY_INCIDENTS'), 'ar'))
      .toContain('سلامة الدفع');
  });

  it('falls back to the raw code for an unknown incident', () => {
    // A NEW backend code the UI has not learned yet must still appear. Dropping
    // unknown codes would hide exactly the incidents nobody has seen before.
    expect(attentionText(item('BRAND_NEW_CODE', 'push'), 'en'))
      .toBe('push: BRAND NEW CODE');
    expect(attentionText(item('BRAND_NEW_CODE', 'push'), 'ar'))
      .toBe('push: BRAND NEW CODE');
  });
});

describe('attentionTone', () => {
  it('treats only critical as blocking', () => {
    expect(attentionTone('critical')).toBe('blocking');
    expect(attentionTone('warning')).toBe('warning');
    expect(attentionTone('anything-else')).toBe('warning');
  });
});

describe('sourceLabel', () => {
  it('humanises the telemetry source', () => {
    expect(sourceLabel('lazywait_sync_runs')).toBe('lazywait sync runs');
  });
});
