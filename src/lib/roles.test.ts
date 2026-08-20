import { describe, expect, it } from 'vitest';
import {
  isAdminConsoleRole,
  isOpsConsoleRole,
  isStaffSideRole,
  type UserRole,
} from './roles';

/**
 * These predicates ARE the surface-routing decision in src/App.tsx, and the
 * MFA gate wraps exactly one of the buckets. A mistake here does not produce a
 * type error — it silently sends the wrong people to the wrong console — so the
 * invariants are pinned explicitly.
 */
const ALL_ROLES: UserRole[] = [
  'customer',
  'admin',
  'accountant',
  'branch_staff',
  'call_center',
];

describe('role surface routing', () => {
  it('routes admin and accountant to the admin console', () => {
    expect(isAdminConsoleRole('admin')).toBe(true);
    expect(isAdminConsoleRole('accountant')).toBe(true);
  });

  it('does NOT route the branch-operations roles into the admin console', () => {
    // Regression guard for the original `role !== 'customer'` check: it would
    // have put both of these behind the TOTP gate and the admin data bootstrap.
    expect(isAdminConsoleRole('branch_staff')).toBe(false);
    expect(isAdminConsoleRole('call_center')).toBe(false);
  });

  it('routes only the branch-operations roles to the ops console', () => {
    expect(isOpsConsoleRole('branch_staff')).toBe(true);
    expect(isOpsConsoleRole('call_center')).toBe(true);
    expect(isOpsConsoleRole('admin')).toBe(false);
    expect(isOpsConsoleRole('accountant')).toBe(false);
    expect(isOpsConsoleRole('customer')).toBe(false);
  });

  it('never places a role in both buckets', () => {
    for (const role of ALL_ROLES) {
      expect(isAdminConsoleRole(role) && isOpsConsoleRole(role)).toBe(false);
    }
  });

  it('treats every non-customer role as staff-side, and customer as not', () => {
    for (const role of ALL_ROLES) {
      expect(isStaffSideRole(role)).toBe(role !== 'customer');
    }
  });

  it('treats unknown, null and undefined roles as no console at all', () => {
    // A role added to the database enum but not yet to this module must fall
    // through to the customer redirect rather than into a staff surface.
    for (const value of [null, undefined, '', 'superuser', 'CUSTOMER', 'Admin']) {
      expect(isAdminConsoleRole(value)).toBe(false);
      expect(isOpsConsoleRole(value)).toBe(false);
      expect(isStaffSideRole(value)).toBe(false);
    }
  });
});
