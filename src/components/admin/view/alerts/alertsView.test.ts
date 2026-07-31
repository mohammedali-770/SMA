/**
 * Operations Alerts — derived-state tests.
 *
 * These lock the values that decide what an operator sees: the exact filter
 * payload (including the empty-string-to-null coercion and the row limit),
 * which section fetches what, how a timeline distinguishes "loading" from
 * "loaded but empty", and the fallbacks that keep an unrecognised subsystem,
 * event or severity visible instead of silently dropping it.
 */
import { describe, expect, it } from 'vitest';

import {
  ALERTS_LIST_LIMIT,
  DIGEST_HISTORY_LIMIT,
  buildAlertsFilters,
  eventLabel,
  severityLabel,
  severityTone,
  shouldLoadSection,
  statusLabel,
  statusTone,
  subsystemLabel,
  timelineState,
} from './alertsView';

describe('load contract', () => {
  it('requests 200 rows', () => {
    // A silent change here changes how much of the inbox an operator sees,
    // and nothing else in the code would look different.
    expect(ALERTS_LIST_LIMIT).toBe(200);
  });

  it('keeps 30 digests of history', () => {
    expect(DIGEST_HISTORY_LIMIT).toBe(30);
  });
});

describe('buildAlertsFilters', () => {
  it('coerces empty selections to null, never empty string', () => {
    // '' would be sent as a real filter value and match nothing.
    expect(buildAlertsFilters({ status: 'open', severity: '', subsystem: '' }))
      .toEqual({ status: 'open', severity: null, subsystem: null, limit: 200 });
  });

  it('passes through chosen values', () => {
    expect(buildAlertsFilters({ status: 'recovered', severity: 'critical', subsystem: 'payment' }))
      .toEqual({ status: 'recovered', severity: 'critical', subsystem: 'payment', limit: 200 });
  });

  it('always carries the limit', () => {
    expect(buildAlertsFilters({ status: '', severity: '', subsystem: '' }).limit).toBe(200);
  });
});

describe('shouldLoadSection', () => {
  it('fetches only for the open section', () => {
    // digestPreview renders a full daily summary server-side; fetching it for
    // an operator who never opens the tab is work nobody asked for.
    expect(shouldLoadSection('digest', 'digest')).toBe(true);
    expect(shouldLoadSection('inbox', 'digest')).toBe(false);
    expect(shouldLoadSection('settings', 'digest')).toBe(false);

    expect(shouldLoadSection('settings', 'settings')).toBe(true);
    expect(shouldLoadSection('inbox', 'settings')).toBe(false);
    expect(shouldLoadSection('digest', 'settings')).toBe(false);
  });
});

describe('timelineState', () => {
  it('is closed unless this alert is the expanded one', () => {
    expect(timelineState({}, 'a', null)).toBe('closed');
    expect(timelineState({}, 'a', 'b')).toBe('closed');
  });

  it('is loading when expanded and never fetched', () => {
    expect(timelineState({}, 'a', 'a')).toBe('loading');
  });

  it('is loaded once a cache entry exists — including an empty one', () => {
    // A FAILED fetch caches [] on purpose, so the row renders "No events"
    // rather than spinning forever. Preserved from the original.
    expect(timelineState({ a: [] }, 'a', 'a')).toBe('loaded');
    expect(timelineState({ a: [{}] }, 'a', 'a')).toBe('loaded');
  });
});

describe('labels keep unknown values visible', () => {
  it('falls back to the raw subsystem id', () => {
    // A NEW subsystem the UI has not learned yet must stay identifiable, or
    // its alerts appear attributed to nothing.
    expect(subsystemLabel('payment', 'en')).toBe('Payment / Tap');
    expect(subsystemLabel('payment', 'ar')).toBe('الدفع / Tap');
    expect(subsystemLabel('brand_new_subsystem', 'en')).toBe('brand_new_subsystem');
  });

  it('falls back to the raw event type', () => {
    expect(eventLabel('recovered', 'en')).toBe('Recovered');
    expect(eventLabel('recovered', 'ar')).toBe('تعافى');
    expect(eventLabel('some_new_event', 'ar')).toBe('some_new_event');
  });

  it('falls back to info for an unknown severity', () => {
    // An unrecognised level must not be silently promoted to critical, and
    // must not disappear either.
    expect(severityLabel('critical', 'en')).toBe('Critical');
    expect(severityLabel('nonsense', 'en')).toBe('Info');
    expect(severityTone('nonsense')).toBe('info');
  });

  it('falls back to the raw status', () => {
    expect(statusLabel('open', 'en')).toBe('Open');
    expect(statusLabel('archived', 'en')).toBe('archived');
  });
});

describe('tone mapping', () => {
  it('maps severity', () => {
    expect(severityTone('critical')).toBe('danger');
    expect(severityTone('warning')).toBe('warning');
    expect(severityTone('info')).toBe('info');
  });

  it('treats open as WARNING, not danger', () => {
    // Severity already carries how bad the alert is. Painting every open alert
    // red makes a critical one indistinguishable from an open info-level one.
    expect(statusTone('open')).toBe('warning');
    expect(statusTone('recovered')).toBe('success');
  });

  it('never maps to ember', () => {
    for (const t of [severityTone('critical'), statusTone('open'), statusTone('recovered')]) {
      expect(t).not.toBe('ember');
    }
  });
});
