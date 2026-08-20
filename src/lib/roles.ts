/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The application role vocabulary, and the ONE place that decides which surface
 * each role gets.
 *
 * `customer`/`admin`/`accountant` are the original roles. `branch_staff` and
 * `call_center` are the branch-operations roles added for the operations
 * consoles (see supabase/migrations/20260820100000_ops_roles_enum.sql).
 *
 * These predicates exist because the routing question used to be answered
 * inline as `role !== 'customer'`, which silently means "everyone who is not a
 * customer gets the full admin console behind the TOTP gate". That was correct
 * while there were only three roles and is actively wrong now: a cashier would
 * be locked out behind an authenticator app they do not have, and would trigger
 * the admin data bootstrap they have no permission to read.
 *
 * Server-side authorization is unchanged and remains the real boundary — these
 * helpers only decide which UI to render.
 */
export type UserRole =
  | 'customer'
  | 'admin'
  | 'accountant'
  | 'branch_staff'
  | 'call_center';

/** Roles that get the full admin console — and therefore the staff MFA gate. */
export function isAdminConsoleRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'accountant';
}

/**
 * Roles that get a branch-operations console. Deliberately NOT behind the MFA
 * gate: these accounts work from shared shop-floor hardware and are narrow by
 * construction server-side (owner decision 2026-08-20).
 */
export function isOpsConsoleRole(role: string | null | undefined): boolean {
  return role === 'branch_staff' || role === 'call_center';
}

/** Any signed-in staff-side role, i.e. anyone who is not a customer. */
export function isStaffSideRole(role: string | null | undefined): boolean {
  return isAdminConsoleRole(role) || isOpsConsoleRole(role);
}
