import { describe, expect, it } from 'vitest';
import {
  MANAGEABLE_ROLES,
  MIN_PASSWORD,
  isAcceptablePassword,
  isManageableRole,
  isValidEmail,
  requiresBranch,
  sanitizeError,
} from './guards';

describe('staff-accounts manageable-role allow-list', () => {
  it('admits exactly the two branch-operations roles', () => {
    expect([...MANAGEABLE_ROLES]).toEqual(['branch_staff', 'call_center']);
    expect(isManageableRole('branch_staff')).toBe(true);
    expect(isManageableRole('call_center')).toBe(true);
  });

  it('refuses the privileged and customer roles', () => {
    // This is the guard that stops staff-accounts being an admin-minting or
    // customer-deleting primitive. If it ever returns true here, the function
    // can create an administrator or delete a customer.
    expect(isManageableRole('admin')).toBe(false);
    expect(isManageableRole('accountant')).toBe(false);
    expect(isManageableRole('customer')).toBe(false);
  });

  it('refuses anything that is not one of the listed strings', () => {
    for (const value of [null, undefined, '', 'BRANCH_STAFF', 'branch_staff ', 0, {}, []]) {
      expect(isManageableRole(value)).toBe(false);
    }
  });

  it('requires a branch for branch accounts but not for call centre', () => {
    expect(requiresBranch('branch_staff')).toBe(true);
    expect(requiresBranch('call_center')).toBe(false);
  });
});

describe('staff-accounts input validation', () => {
  it('accepts ordinary addresses and rejects malformed ones', () => {
    expect(isValidEmail('cashier@1sttaste.com')).toBe(true);
    expect(isValidEmail('  cashier@1sttaste.com  ')).toBe(true);
    for (const bad of ['', 'cashier', 'cashier@', '@1sttaste.com', 'a b@c.com', null, 42]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });

  it('enforces the minimum password length', () => {
    expect(MIN_PASSWORD).toBe(12);
    expect(isAcceptablePassword('a'.repeat(MIN_PASSWORD))).toBe(true);
    expect(isAcceptablePassword('a'.repeat(MIN_PASSWORD - 1))).toBe(false);
    expect(isAcceptablePassword(null)).toBe(false);
    expect(isAcceptablePassword(12345678901234)).toBe(false);
  });
});

describe('staff-accounts error sanitization', () => {
  it('redacts credential-shaped fragments from upstream errors', () => {
    expect(sanitizeError('failed: password=hunter2hunter2')).not.toContain('hunter2');
    expect(sanitizeError('token: abc.def.ghi')).not.toContain('abc.def.ghi');
    expect(sanitizeError('bad secret sk_live_1234')).not.toContain('sk_live_1234');
  });

  it('keeps the message useful and bounded', () => {
    expect(sanitizeError('Account not found.')).toBe('Account not found.');
    expect(sanitizeError('x'.repeat(1000))).toHaveLength(300);
  });

  it('never throws on non-string input', () => {
    expect(() => sanitizeError(undefined)).not.toThrow();
    expect(() => sanitizeError({ a: 1 })).not.toThrow();
  });
});
