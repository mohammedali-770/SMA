/**
 * Pure authorization/validation guards for the staff-accounts function.
 *
 * Separated from index.ts so they can be unit-tested under Vitest (Node) — the
 * handler itself imports Deno-only modules and cannot be. Everything that
 * decides "may this request touch this account" lives here, because those are
 * exactly the rules worth pinning with tests.
 */

/**
 * The ONLY roles staff-accounts may create, modify or delete.
 *
 * An allow-list, deliberately — a deny-list would silently admit any role added
 * to the enum later. This is what stops the function being an
 * administrator-minting or customer-deleting primitive.
 */
export const MANAGEABLE_ROLES = ['branch_staff', 'call_center'] as const;
export type ManageableRole = typeof MANAGEABLE_ROLES[number];

export const MIN_PASSWORD = 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isManageableRole(role: unknown): role is ManageableRole {
  return typeof role === 'string' && (MANAGEABLE_ROLES as readonly string[]).includes(role);
}

export function isValidEmail(email: unknown): boolean {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

export function isAcceptablePassword(password: unknown): boolean {
  return typeof password === 'string' && password.length >= MIN_PASSWORD;
}

/**
 * Never let an upstream GoTrue/Postgres error carry a credential back to the
 * browser. The strings this function sends are fixed, but upstream errors are
 * not ours to trust.
 */
export function sanitizeError(msg: unknown): string {
  return String(msg)
    .replace(/(password|secret|token|key)\s*[:=]?\s*\S+/gi, '$1 ***')
    .slice(0, 300);
}

/** A branch account is meaningless without a branch to be pinned to. */
export function requiresBranch(role: ManageableRole): boolean {
  return role === 'branch_staff';
}
