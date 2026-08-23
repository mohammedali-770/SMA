import { describe, expect, it } from 'vitest';

import { decideAdminAuthorization } from './adminAuth';

/**
 * The handlers cannot be tested here — they import Deno-only modules — so this
 * predicate is the whole of the AAL2 fix that CI can actually execute. Each case
 * names the mutation it kills.
 */
describe('decideAdminAuthorization', () => {
  it('admits an administrator whose session satisfies AAL2', () => {
    const d = decideAdminAuthorization({ data: true, error: null }, 'admin');
    expect(d.allowed).toBe(true);
    expect(d.status).toBe(200);
  });

  // THE CASE THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. Before this fix the
  // handlers checked only the role, so this exact input was authorized.
  // Mutation killed: dropping the is_admin() call and judging on role alone.
  it('REFUSES an administrator who has not completed two-factor', () => {
    const d = decideAdminAuthorization({ data: false, error: null }, 'admin');
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
    expect(d.code).toBe('mfa_required');
  });

  // Mutation killed: `if (rpc.data)` instead of `rpc.data !== true`.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['an empty object', {}],
    ['an array', ['aal2']],
  ])('refuses when is_admin() returned %s rather than boolean true', (_label, data) => {
    const d = decideAdminAuthorization({ data, error: null }, 'admin');
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
  });

  // Mutation killed: treating a failed authorization check as a denial (403) or,
  // far worse, as an approval. A transient failure is neither.
  it('returns 500, not 403, when the authorization check itself failed', () => {
    const d = decideAdminAuthorization(
      { data: null, error: { message: 'network' } }, 'admin',
    );
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(500);
    expect(d.code).toBe('authorization_check_failed');
    // Telling someone to complete MFA when their network blipped sends them to
    // the wrong remedy — the same class of mistake as mislabelling an expired
    // session as an MFA failure.
    expect(d.error).not.toMatch(/two-factor/i);
  });

  // Mutation killed: checking AAL before role, which would tell a non-admin to
  // go and set up two-factor authentication.
  it.each([
    ['customer', 'customer'],
    ['accountant', 'accountant'],
    ['branch_staff', 'branch_staff'],
    ['call_center', 'call_center'],
    ['a missing profile', undefined],
    ['a null role', null],
  ])('refuses %s with plain forbidden, even when the RPC says true', (_label, role) => {
    const d = decideAdminAuthorization({ data: true, error: null }, role);
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
    expect(d.code).toBe('forbidden');
  });

  // THE INPUT THAT DISTINGUISHES CHECK ORDER. With role checked first a
  // non-admin gets plain 'forbidden'; with AAL checked first they are told to go
  // and set up two-factor authentication for an account that would never be
  // allowed anyway. Every other combination returns the same answer either way,
  // which is why an earlier version of this suite let the reordering through.
  it.each([
    ['customer', 'customer'],
    ['branch_staff', 'branch_staff'],
    ['no profile', undefined],
  ])('tells %s they are forbidden, not that they need two-factor', (_l, role) => {
    const d = decideAdminAuthorization({ data: false, error: null }, role);
    expect(d.code).toBe('forbidden');
    expect(d.error).not.toMatch(/two-factor/i);
  });

  // An RPC error outranks everything: we do not know who the caller is.
  it('prefers the 500 when the caller is also not an admin', () => {
    const d = decideAdminAuthorization({ data: null, error: new Error('x') }, 'customer');
    expect(d.status).toBe(500);
  });

  it('never returns allowed with a non-200 status, or vice versa', () => {
    const inputs: Array<[unknown, unknown, unknown]> = [
      [true, null, 'admin'], [false, null, 'admin'], [true, null, 'customer'],
      [null, new Error('x'), 'admin'], [undefined, undefined, undefined],
    ];
    for (const [data, error, role] of inputs) {
      const d = decideAdminAuthorization({ data, error }, role);
      expect(d.allowed).toBe(d.status === 200);
    }
  });

  it('always gives a denial a message a person can act on', () => {
    for (const d of [
      decideAdminAuthorization({ data: false, error: null }, 'admin'),
      decideAdminAuthorization({ data: true, error: null }, 'customer'),
      decideAdminAuthorization({ data: null, error: new Error('x') }, 'admin'),
    ]) {
      expect(d.error.length).toBeGreaterThan(0);
      expect(d.code.length).toBeGreaterThan(0);
    }
  });
});
