import { describe, expect, it } from 'vitest';

import {
  authOwnedFactors,
  classifyBlockers,
  computeBackoffMs,
  decideAfterFailure,
  decideDeletionAccountGuard,
  interpretTransition,
  isCustomerRoleForDeletion,
  isTerminal,
  MAX_AUTO_ATTEMPTS,
  passwordReauthUserMatches,
  RETRY_CAP_MS,
  safeFailureCode,
  STAFF_DELETION_HOLD_REASON,
  statusForBlocker,
  type BlockerCounts,
} from './accountDeletion';

const NO_BLOCKERS: BlockerCounts = { activeOrders: 0, pendingOnlineOrders: 0, pendingCheckoutSessions: 0 };

describe('classifyBlockers — only real, prioritized states', () => {
  it('returns none when nothing is in flight (safe to delete)', () => {
    expect(classifyBlockers(NO_BLOCKERS)).toBe('none');
  });

  it('active order takes priority (waiting_for_active_order)', () => {
    expect(classifyBlockers({ ...NO_BLOCKERS, activeOrders: 1 })).toBe('active_order');
    // even if a financial process is also present, the active order wins
    expect(classifyBlockers({ activeOrders: 2, pendingOnlineOrders: 1, pendingCheckoutSessions: 3 })).toBe('active_order');
  });

  it('pending online order OR pending checkout session → financial', () => {
    expect(classifyBlockers({ ...NO_BLOCKERS, pendingOnlineOrders: 1 })).toBe('financial');
    expect(classifyBlockers({ ...NO_BLOCKERS, pendingCheckoutSessions: 1 })).toBe('financial');
  });

  it('ignores negative / NaN noise defensively', () => {
    expect(classifyBlockers({ activeOrders: -3, pendingOnlineOrders: Number.NaN as unknown as number, pendingCheckoutSessions: 0 })).toBe('none');
  });

  it('is deterministic / idempotent for the same input', () => {
    const input = { activeOrders: 0, pendingOnlineOrders: 1, pendingCheckoutSessions: 0 };
    expect(classifyBlockers(input)).toBe(classifyBlockers(input));
  });
});

describe('statusForBlocker', () => {
  it('maps each blocker to its waiting status; none → processing', () => {
    expect(statusForBlocker('active_order')).toBe('waiting_for_active_order');
    expect(statusForBlocker('financial')).toBe('waiting_for_financial_process');
    expect(statusForBlocker('none')).toBe('processing');
  });
});

describe('computeBackoffMs — bounded exponential backoff', () => {
  it('grows with attempt and is capped', () => {
    expect(computeBackoffMs(1)).toBe(60_000);
    expect(computeBackoffMs(2)).toBe(120_000);
    expect(computeBackoffMs(3)).toBe(240_000);
    expect(computeBackoffMs(50)).toBe(RETRY_CAP_MS);
  });
  it('never returns below the base for attempt <= 1', () => {
    expect(computeBackoffMs(0)).toBe(60_000);
    expect(computeBackoffMs(-5)).toBe(60_000);
  });
});

describe('decideAfterFailure — retry then escalate, never infinite / never silent', () => {
  it('schedules a bounded retry while under the attempt budget', () => {
    const d = decideAfterFailure(1);
    expect(d.status).toBe('retry_scheduled');
    expect(d.nextAttemptMs).toBe(60_000);
  });
  it('escalates to manual review at the attempt cap', () => {
    const d = decideAfterFailure(MAX_AUTO_ATTEMPTS);
    expect(d.status).toBe('manual_review');
    expect(d.nextAttemptMs).toBeNull();
  });
  it('escalates beyond the cap too (persistent failure)', () => {
    expect(decideAfterFailure(MAX_AUTO_ATTEMPTS + 3).status).toBe('manual_review');
  });
});

describe('authOwnedFactors — re-verification binds ONLY to auth.getUser fields', () => {
  it('derives OTP phone + reauth email from the AUTH user, not profile data', () => {
    // The function accepts ONLY the auth user object — profile fields are not an
    // input, so an edited profile email/phone structurally cannot change these.
    const f = authOwnedFactors({ email: 'auth@example.com', phone: '+966500000000' });
    expect(f.otpPhone).toBe('+966500000000');
    expect(f.reauthEmail).toBe('auth@example.com');
  });
  it('missing Auth phone hides OTP (otpPhone null)', () => {
    expect(authOwnedFactors({ email: 'a@b.com', phone: null }).otpPhone).toBeNull();
    expect(authOwnedFactors({ email: 'a@b.com' }).otpPhone).toBeNull();
    expect(authOwnedFactors({ email: 'a@b.com', phone: '  ' }).otpPhone).toBeNull();
  });
  it('missing Auth email disables password fallback (reauthEmail null)', () => {
    expect(authOwnedFactors({ email: null, phone: '+966500000000' }).reauthEmail).toBeNull();
    expect(authOwnedFactors({ phone: '+966500000000' }).reauthEmail).toBeNull();
    expect(authOwnedFactors({ email: '', phone: '+966500000000' }).reauthEmail).toBeNull();
  });
});

describe('passwordReauthUserMatches — a valid password for another account never authorizes', () => {
  const me = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';
  it('authorizes ONLY when signInWithPassword returned the SAME authenticated id', () => {
    expect(passwordReauthUserMatches(me, me)).toBe(true);
  });
  it('rejects a different Auth user id (valid password for another account)', () => {
    expect(passwordReauthUserMatches(other, me)).toBe(false);
  });
  it('rejects when no user id is returned', () => {
    expect(passwordReauthUserMatches(null, me)).toBe(false);
    expect(passwordReauthUserMatches(undefined, me)).toBe(false);
    expect(passwordReauthUserMatches('', me)).toBe(false);
  });
});

describe('interpretTransition — a fenced transition that matched no row is never "success"', () => {
  it('returns the intended outcome only when the fencing token matched our row', () => {
    expect(interpretTransition(true, 'completed')).toBe('completed');
    expect(interpretTransition(true, 'waiting')).toBe('waiting');
    expect(interpretTransition(true, 'manual_review')).toBe('manual_review');
  });
  it('reports lost_lease (never the intended state) when no row matched', () => {
    expect(interpretTransition(false, 'completed')).toBe('lost_lease');
    expect(interpretTransition(false, 'waiting')).toBe('lost_lease');
    expect(interpretTransition(false, 'manual_review')).toBe('lost_lease');
  });
});

describe('safeFailureCode / isTerminal', () => {
  it('produces a structured code that never leaks details', () => {
    expect(safeFailureCode('anonymize')).toBe('deletion_anonymize_failed');
    expect(safeFailureCode('auth_delete')).toBe('deletion_auth_delete_failed');
  });
  it('marks only completed/failed as terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('manual_review')).toBe(false);
    expect(isTerminal('processing')).toBe(false);
  });
});

describe('staff accounts never use the customer deletion path (F-X05-001)', () => {
  const STAFF_ROLES = ['admin', 'accountant', 'branch_staff', 'call_center'];

  it('refuses every staff role with 403 staff_account', () => {
    for (const role of STAFF_ROLES) {
      const g = decideDeletionAccountGuard({ role, error: null });
      expect(g).toMatchObject({ allowed: false, status: 403, code: 'staff_account' });
    }
  });

  it('is an allow-list: an unknown or future role is refused, not admitted', () => {
    for (const role of ['owner', 'ADMIN', '', 'customer ', 7, {}, true]) {
      expect(decideDeletionAccountGuard({ role, error: null }).allowed).toBe(false);
    }
  });

  it('leaves customers unchanged, including a user with no profile row', () => {
    expect(decideDeletionAccountGuard({ role: 'customer', error: null })).toEqual({ allowed: true });
    expect(decideDeletionAccountGuard({ role: null, error: null })).toEqual({ allowed: true });
    expect(decideDeletionAccountGuard({ role: undefined, error: null })).toEqual({ allowed: true });
  });

  it('fails CLOSED when the role read failed, whatever the role says', () => {
    for (const role of ['customer', 'admin', null, undefined]) {
      const g = decideDeletionAccountGuard({ role, error: { message: 'boom' } });
      expect(g).toMatchObject({ allowed: false, status: 500, code: 'role_check_failed' });
    }
  });

  it('never puts a raw error or role into the response message', () => {
    const g = decideDeletionAccountGuard({ role: 'admin', error: null });
    if (g.allowed) throw new Error('expected a refusal');
    expect(g.message).not.toMatch(/\b(admin|accountant|branch_staff|call_center)\b/i);
  });

  it('the processor predicate agrees with the request guard', () => {
    for (const role of STAFF_ROLES) expect(isCustomerRoleForDeletion(role)).toBe(false);
    for (const role of ['customer', null, undefined]) expect(isCustomerRoleForDeletion(role)).toBe(true);
  });

  it('holds with a safe, PII-free reason', () => {
    expect(STAFF_DELETION_HOLD_REASON).toBe('staff_account_requires_admin');
  });
});
