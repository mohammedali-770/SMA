import { describe, expect, it } from 'vitest';
import {
  MIN_OPS_PASSWORD,
  branchesWithoutOperator,
  validateNewOpsAccount,
} from './staffAccounts';

const draft = (over: Partial<Parameters<typeof validateNewOpsAccount>[0]> = {}) => ({
  email: 'cashier@1sttaste.com',
  password: 'a'.repeat(MIN_OPS_PASSWORD),
  role: 'branch_staff' as const,
  branchId: 'b1',
  ...over,
});

describe('validateNewOpsAccount', () => {
  it('accepts a complete branch draft', () => {
    expect(validateNewOpsAccount(draft(), false)).toBeNull();
  });

  it('rejects a malformed email', () => {
    expect(validateNewOpsAccount(draft({ email: 'cashier' }), false)).toMatch(/valid email/i);
  });

  it('rejects a short password', () => {
    const short = draft({ password: 'a'.repeat(MIN_OPS_PASSWORD - 1) });
    expect(validateNewOpsAccount(short, false)).toMatch(/at least/i);
  });

  it('refuses a branch account with no branch', () => {
    // A branch operator with no assignment can sign in and see nothing, which
    // reads to the user as a broken login rather than a misconfiguration.
    expect(validateNewOpsAccount(draft({ branchId: '  ' }), false)).toMatch(/select a branch/i);
  });

  it('does not require a branch for a call-centre account', () => {
    expect(validateNewOpsAccount(draft({ role: 'call_center', branchId: '' }), false)).toBeNull();
  });

  it('returns Arabic copy when the console is in Arabic', () => {
    const msg = validateNewOpsAccount(draft({ email: 'nope' }), true);
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/[a-z]/i);
  });
});

describe('branchesWithoutOperator', () => {
  const branches = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];

  it('lists every branch when there are no accounts', () => {
    expect(branchesWithoutOperator(branches, [])).toEqual(branches);
  });

  it('excludes branches that have a pinned operator', () => {
    const out = branchesWithoutOperator(branches, [
      { role: 'branch_staff', branchId: 'b2' },
    ]);
    expect(out.map((b) => b.id)).toEqual(['b1', 'b3']);
  });

  it('does not count call-centre accounts as staffing a branch', () => {
    // A call-centre account is not pinned anywhere and gives no branch someone
    // who can close its items, so it must not silence the warning.
    const out = branchesWithoutOperator(branches, [
      { role: 'call_center', branchId: null },
      { role: 'call_center', branchId: 'b1' },
    ]);
    expect(out.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('does not count a branch account that lost its assignment', () => {
    const out = branchesWithoutOperator(branches, [
      { role: 'branch_staff', branchId: null },
    ]);
    expect(out.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });
});
