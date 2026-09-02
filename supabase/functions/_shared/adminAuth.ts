/**
 * The admin authorization decision for Edge Functions, as a PURE function.
 *
 * THE BUG THIS EXISTS FOR
 * Four admin Edge Functions authorized callers like this:
 *
 *     const { data: profile } = await admin.from('profiles').select('role')…
 *     if (!profile || profile.role !== 'admin') return json({ error: 'forbidden' }, 403);
 *
 * — staff-accounts, email-test-config and whatsapp-test-config. A fourth,
 * push-dispatch, spelled the same test as a ternary
 * (`profile?.role === 'admin' ? user.id : null`) and so survived a lexical sweep
 * for `role !== 'admin'`; it is fixed too, and is the one that mattered most —
 * `verify_jwt = false` makes that check its only gate, and its broadcast cannot
 * be recalled.
 *
 * `payment-test-config` was fixed too, on 2026-08-24, under the narrow exception
 * recorded in CLAUDE.md §6 — it is not a read-only diagnostics endpoint, since
 * its `verify_order` action reaches `validateAndConfirmTapCharge` and can drive
 * payment-state writes on real orders. It calls `decideAdminAuthorization` at
 * index.ts:73 like every other admin function. NO admin Edge Function keeps the
 * defect today. (This paragraph said the opposite until 2026-09-02, pointing
 * readers at a hole that had been closed for nine days.)
 *
 * It was NOT universal: lazywait-catalog/index.ts:36-39 has asked is_admin()
 * since 20260807, and is the precedent this file follows.
 *
 * That checks the ROLE and not the MFA assurance level. Everywhere in SQL,
 * admin authority additionally requires AAL2:
 *
 *     public.is_admin() = current_app_role() = 'admin' AND public.jwt_has_aal2()
 *     public.jwt_has_aal2() = aal_claim_satisfies_staff_mfa(auth.jwt() ->> 'aal')
 *     public.aal_claim_satisfies_staff_mfa(p_aal) = coalesce(p_aal = 'aal2', false)
 *
 * (20260810142000_staff_mfa_aal2.sql). So an administrator signed in with email
 * and password but WITHOUT completing TOTP passed the function's own gate while
 * being refused by every RLS policy and admin RPC. Anything a function did with
 * the SERVICE-ROLE client — which bypasses RLS — therefore ran at AAL1.
 *
 * WHY WE ASK POSTGRES INSTEAD OF READING THE CLAIM HERE
 * The obvious fix is to base64-decode the JWT and compare `aal` in TypeScript.
 * That would be a SECOND implementation of the predicate, in a second language,
 * with nothing in CI comparing the two — so the next auth migration silently
 * diverges. Instead the caller-scoped client calls `public.is_admin()`, which is
 * already granted to `authenticated` (20260810143000:92, pinned by
 * anon_role_helper_exposure_test.sql:25-28) and already evaluates AAL2 through
 * exactly the SQL the rest of the schema uses. PostgREST populates
 * `request.jwt.claims` only after verifying the signature, so a forged token
 * cannot reach the comparison — a property the decode-it-here approach does not
 * have. `lazywait-catalog/index.ts:36-39` has run this pattern in production
 * since 20260807.
 *
 * WHY THIS FUNCTION IS PURE
 * The handlers import Deno-only modules and cannot be loaded by Vitest, so a
 * decision made inline in a handler is untestable. Keeping the decision here
 * means the case that would have caught the original bug — role 'admin', RPC
 * false — is an actual assertion rather than a comment.
 */

/** The shape of a supabase-js `.rpc()` result, narrowed to what we judge on. */
export interface AdminRpcOutcome {
  /** `is_admin()` returns a non-null boolean, but treat anything as possible. */
  data: unknown;
  /** Non-null on transport/permission failure. */
  error: unknown;
}

export interface AuthorizationDecision {
  allowed: boolean;
  /** HTTP status to return when `allowed` is false. */
  status: number;
  /**
   * Human-readable sentence. This is NOT decoration: staffAccountsApi.ts
   * surfaces `error` verbatim into the admin's error banner and drops every
   * other field, so this string is literally what a person reads.
   */
  error: string;
  /** Machine code for logs and future clients. Not currently surfaced by the UI. */
  code: string;
}

const ALLOWED: AuthorizationDecision = {
  allowed: true, status: 200, error: '', code: 'ok',
};

/**
 * Decide whether a caller may act as an administrator.
 *
 * Fails CLOSED on every path: the single `allowed: true` is guarded by three
 * conjunctions, and every other branch denies. A null/undefined/absent RPC
 * result, a string 'true', a 1, or a thrown-and-captured error all deny.
 *
 * Order is deliberate and affects only the MESSAGE, never the outcome:
 *   1. RPC error   -> 500. Transient; telling someone to do MFA would be wrong.
 *   2. not admin   -> 403 forbidden. MFA is irrelevant to a non-admin.
 *   3. RPC not true-> 403 mfa_required. Admin by role, but no AAL2.
 */
export function decideAdminAuthorization(
  rpc: AdminRpcOutcome,
  profileRole: unknown,
): AuthorizationDecision {
  if (rpc.error !== null && rpc.error !== undefined) {
    return {
      allowed: false,
      status: 500,
      error: 'Could not verify your administrator session. Please try again.',
      code: 'authorization_check_failed',
    };
  }

  if (profileRole !== 'admin') {
    return { allowed: false, status: 403, error: 'forbidden', code: 'forbidden' };
  }

  // Strict `=== true`: `is_admin()` is `coalesce(..., false)` so it never returns
  // null, but a truthy non-boolean must never be read as approval.
  if (rpc.data !== true) {
    return {
      allowed: false,
      status: 403,
      error:
        'This action requires two-factor authentication. Open the admin console, '
        + 'complete the two-factor step, then try again.',
      code: 'mfa_required',
    };
  }

  return ALLOWED;
}
