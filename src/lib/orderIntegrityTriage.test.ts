import { describe, it, expect } from 'vitest';
import { canTriageRole, showAcknowledge, showSuppress } from './orderIntegrityTriage';

describe('canTriageRole (admin-only triage)', () => {
  it('admin can triage', () => {
    expect(canTriageRole('admin')).toBe(true);
  });
  it('accountant cannot triage (read-only)', () => {
    expect(canTriageRole('accountant')).toBe(false);
  });
  it('customer / unknown / missing cannot triage', () => {
    expect(canTriageRole('customer')).toBe(false);
    expect(canTriageRole(null)).toBe(false);
    expect(canTriageRole(undefined)).toBe(false);
    expect(canTriageRole('')).toBe(false);
  });
});

describe('triage control visibility', () => {
  it('admin SEES Acknowledge (open) and Suppress (open/acknowledged)', () => {
    const canTriage = canTriageRole('admin');
    expect(showAcknowledge(canTriage, 'open')).toBe(true);
    expect(showSuppress(canTriage, 'open')).toBe(true);
    expect(showSuppress(canTriage, 'acknowledged')).toBe(true);
  });

  it('admin does NOT get Acknowledge on a non-open incident', () => {
    const canTriage = canTriageRole('admin');
    expect(showAcknowledge(canTriage, 'acknowledged')).toBe(false);
    expect(showAcknowledge(canTriage, 'suppressed')).toBe(false);
    expect(showAcknowledge(canTriage, 'resolved')).toBe(false);
    // suppress is not offered on suppressed/resolved either
    expect(showSuppress(canTriage, 'suppressed')).toBe(false);
    expect(showSuppress(canTriage, 'resolved')).toBe(false);
  });

  it('accountant does NOT see Acknowledge or Suppress for ANY status', () => {
    const canTriage = canTriageRole('accountant');
    for (const status of ['open', 'acknowledged', 'suppressed', 'resolved']) {
      expect(showAcknowledge(canTriage, status)).toBe(false);
      expect(showSuppress(canTriage, status)).toBe(false);
    }
  });
});

describe('accountant retains read-only access', () => {
  // Read access (summary + incident list) is gated ONLY server-side by is_staff()
  // and is never gated in the UI by role — the panel loads data unconditionally.
  // These helpers govern the *triage controls* only, so a false canTriage removes
  // the action buttons without affecting the read path.
  it('triage gating is independent of read access', () => {
    const accountant = canTriageRole('accountant');
    // No read-gating helper exists: the only role-driven UI decision is triage,
    // and for an accountant it resolves to "no triage controls", nothing more.
    expect(accountant).toBe(false);
    expect(showAcknowledge(accountant, 'open') || showSuppress(accountant, 'open')).toBe(false);
  });
});
