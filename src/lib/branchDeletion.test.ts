import { describe, expect, it } from 'vitest';
import {
  BranchHasDependenciesError,
  FK_VIOLATION_CODE,
  branchDeletionBlockedMessage,
  branchHasBlockingDependencies,
  isBranchDependencyError,
} from './branchDeletion';

describe('branchHasBlockingDependencies', () => {
  it('is false only for a pristine branch (no orders, no checkout sessions)', () => {
    expect(branchHasBlockingDependencies({ orders: 0, checkoutSessions: 0 })).toBe(false);
  });

  it('is true when orders and/or checkout sessions exist', () => {
    expect(branchHasBlockingDependencies({ orders: 1, checkoutSessions: 0 })).toBe(true);
    expect(branchHasBlockingDependencies({ orders: 0, checkoutSessions: 3 })).toBe(true);
    expect(branchHasBlockingDependencies({ orders: 2, checkoutSessions: 5 })).toBe(true);
  });
});

describe('isBranchDependencyError', () => {
  it('recognises our typed dependency error', () => {
    expect(isBranchDependencyError(new BranchHasDependenciesError({ orders: 4, checkoutSessions: 0 }))).toBe(true);
  });

  it('recognises a raw Postgres foreign-key violation (23503)', () => {
    expect(isBranchDependencyError({ code: FK_VIOLATION_CODE, message: 'violates foreign key constraint' })).toBe(true);
    expect(isBranchDependencyError({ code: '23503' })).toBe(true);
  });

  it('does NOT mask unrelated errors', () => {
    expect(isBranchDependencyError({ code: '42501', message: 'permission denied' })).toBe(false); // RLS
    expect(isBranchDependencyError(new Error('network down'))).toBe(false);
    expect(isBranchDependencyError(null)).toBe(false);
    expect(isBranchDependencyError(undefined)).toBe(false);
    expect(isBranchDependencyError('23503')).toBe(false);
  });
});

describe('BranchHasDependenciesError', () => {
  it('is an Error subclass carrying a stable code and the counts', () => {
    const err = new BranchHasDependenciesError({ orders: 7, checkoutSessions: 2 });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('BRANCH_HAS_DEPENDENCIES');
    expect(err.counts).toEqual({ orders: 7, checkoutSessions: 2 });
  });
});

describe('branchDeletionBlockedMessage', () => {
  it('English guidance steers the admin to deactivation instead of the raw FK string', () => {
    const msg = branchDeletionBlockedMessage(false);
    expect(msg).toContain('existing orders');
    expect(msg).toContain('can’t be deleted');
    expect(msg).toContain('Deactivate');
    expect(msg).toContain('Close Branch');
    expect(msg).not.toMatch(/foreign key|constraint|23503/i);
  });

  it('Arabic guidance steers the admin to deactivation', () => {
    const msg = branchDeletionBlockedMessage(true);
    expect(msg).toContain('أوقِف');
    expect(msg).toContain('إغلاق الفرع');
    expect(msg).not.toMatch(/foreign key|constraint|23503/i);
  });
});
