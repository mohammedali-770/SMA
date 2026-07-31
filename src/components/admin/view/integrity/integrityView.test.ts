/**
 * Order Integrity — derived-value tests.
 *
 * Every function here was an inline expression inside the panel before the
 * migration, checkable only by looking at a rendered table. These lock the
 * behaviour that was lifted, especially the boundaries: an off-by-one in
 * `ageLabel` or a dropped `status !== 'resolved'` would be invisible in review
 * and wrong in production.
 *
 * `now` is injected so the clock is not a source of flake.
 */
import { describe, expect, it } from 'vitest';

import {
  ageLabel,
  clampSuppressHours,
  deriveAffectedBranches,
  isSuppressReasonValid,
  severityTone,
  shortId,
  stateTone,
  statusTone,
  suppressUntilIso,
} from './integrityView';

/** 2026-01-01T00:00:00Z */
const NOW = 1767225600000;
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('ageLabel', () => {
  it('renders an em dash for a missing timestamp', () => {
    expect(ageLabel(null, NOW)).toBe('—');
    expect(ageLabel(undefined, NOW)).toBe('—');
  });

  it('uses seconds below one minute', () => {
    expect(ageLabel(ago(0), NOW)).toBe('0s');
    expect(ageLabel(ago(59), NOW)).toBe('59s');
  });

  it('switches unit exactly at each boundary', () => {
    expect(ageLabel(ago(60), NOW)).toBe('1m');
    expect(ageLabel(ago(3599), NOW)).toBe('59m');
    expect(ageLabel(ago(3600), NOW)).toBe('1h');
    expect(ageLabel(ago(86399), NOW)).toBe('23h');
    expect(ageLabel(ago(86400), NOW)).toBe('1d');
  });

  it('clamps a future timestamp to zero rather than showing a negative age', () => {
    // Client and server clocks disagree; "-3s ago" is never useful.
    expect(ageLabel(new Date(NOW + 5000).toISOString(), NOW)).toBe('0s');
  });
});

describe('deriveAffectedBranches', () => {
  it('excludes resolved incidents', () => {
    expect(deriveAffectedBranches([
      { status: 'resolved', branch_id: 'br-1' },
      { status: 'open', branch_id: 'br-2' },
    ])).toEqual(['br-2']);
  });

  it('excludes incidents with no branch', () => {
    expect(deriveAffectedBranches([
      { status: 'open', branch_id: null },
      { status: 'open' },
      { status: 'open', branch_id: 'br-1' },
    ])).toEqual(['br-1']);
  });

  it('de-duplicates and preserves first-seen order', () => {
    expect(deriveAffectedBranches([
      { status: 'open', branch_id: 'br-b' },
      { status: 'acknowledged', branch_id: 'br-a' },
      { status: 'suppressed', branch_id: 'br-b' },
    ])).toEqual(['br-b', 'br-a']);
  });

  it('counts acknowledged and suppressed as still affected', () => {
    // Acknowledging or suppressing does not fix anything — the branch still has
    // an open defect and must stay on the list.
    expect(deriveAffectedBranches([
      { status: 'acknowledged', branch_id: 'br-1' },
      { status: 'suppressed', branch_id: 'br-2' },
    ])).toEqual(['br-1', 'br-2']);
  });

  it('returns an empty list for no incidents', () => {
    expect(deriveAffectedBranches([])).toEqual([]);
  });
});

describe('suppressUntilIso', () => {
  it('adds exactly the requested hours', () => {
    expect(suppressUntilIso(24, NOW)).toBe(new Date(NOW + 24 * 3600_000).toISOString());
    expect(suppressUntilIso(1, NOW)).toBe(new Date(NOW + 3600_000).toISOString());
  });

  it('produces an ISO instant the RPC can parse', () => {
    expect(suppressUntilIso(6, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('isSuppressReasonValid', () => {
  it('refuses empty and whitespace-only reasons', () => {
    // Suppressing a payment-integrity defect is a decision someone has to be
    // able to answer for later.
    expect(isSuppressReasonValid('')).toBe(false);
    expect(isSuppressReasonValid('   ')).toBe(false);
    expect(isSuppressReasonValid('\t\n ')).toBe(false);
  });

  it('accepts a reason with content', () => {
    expect(isSuppressReasonValid('known POS outage')).toBe(true);
    expect(isSuppressReasonValid('  padded  ')).toBe(true);
  });
});

describe('clampSuppressHours', () => {
  it('floors at one hour', () => {
    expect(clampSuppressHours(0)).toBe(1);
    expect(clampSuppressHours(-5)).toBe(1);
  });

  it('passes through valid values', () => {
    expect(clampSuppressHours(24)).toBe(24);
    expect(clampSuppressHours(1)).toBe(1);
  });
});

describe('tone mapping', () => {
  it('maps overall state', () => {
    expect(stateTone('healthy')).toBe('success');
    expect(stateTone('degraded')).toBe('warning');
    expect(stateTone('failing')).toBe('danger');
    expect(stateTone('configuration_error')).toBe('danger');
    expect(stateTone('something_new')).toBe('neutral');
    expect(stateTone(null)).toBe('neutral');
  });

  it('maps severity', () => {
    expect(severityTone('critical')).toBe('danger');
    expect(severityTone('warning')).toBe('warning');
  });

  it('maps status, with acknowledged as INFO not success', () => {
    // Someone has seen it. Nothing is fixed. Colouring it green would say the
    // opposite.
    expect(statusTone('open')).toBe('danger');
    expect(statusTone('acknowledged')).toBe('info');
    expect(statusTone('resolved')).toBe('success');
    expect(statusTone('suppressed')).toBe('neutral');
    expect(statusTone('unknown')).toBe('neutral');
  });

  it('never maps a state to ember', () => {
    // Ember is the interactive colour; a status pill must not borrow it.
    const tones = [
      stateTone('healthy'), stateTone('failing'),
      severityTone('critical'), statusTone('open'), statusTone('suppressed'),
    ];
    for (const t of tones) expect(t).not.toBe('ember');
  });
});

describe('shortId', () => {
  it('truncates to eight characters with an ellipsis', () => {
    expect(shortId('0123456789abcdef')).toBe('01234567…');
  });

  it('renders an em dash when absent', () => {
    expect(shortId(null)).toBe('—');
    expect(shortId(undefined)).toBe('—');
  });
});
