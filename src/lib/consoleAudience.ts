/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHICH SURFACE FAMILY THE SIGNED-IN IDENTITY GETS — one pure function, so the
 * decision can be asserted exhaustively instead of inferred from JSX.
 *
 * This exists because the decision was previously inlined in `App.tsx` as a
 * chain of ternaries whose LAST arm was the customer app. Anything the chain
 * did not recognise therefore became "customer", and a `customer` verdict
 * redirected the browser to `/app`. Two quite different things fell into that
 * arm:
 *
 *   1. a genuine customer account — correct, and still handled here; and
 *   2. an identity the console could not determine at all, because the
 *      `profiles` row came back empty. `bootstrap` used to paper that over
 *      with a role of `customer`, so a fault was reported as a role.
 *
 * The second is the dangerous one: an administrator whose profile read failed
 * was told they were a customer and sent away from the dashboard. So an
 * undetermined identity is answered BEFORE either console predicate and before
 * the non-staff arm — an unknown role must never resolve to a known audience,
 * in either direction.
 *
 * `dataLoading` IS modelled, and the ordering around it is the subtle part.
 * `bootstrap` sets `isAuthenticated` before it reads the profile, so there is a
 * normal window during every sign-in where the session exists and the identity
 * does not. Without `account-loading` sitting between "no identity" and
 * "unknown identity", that ordinary window would render the fault screen on the
 * way in. Fatal load errors are deliberately left out: they are a presentation
 * state inside whichever audience was chosen, and were never part of this
 * defect.
 *
 * Server-side authorization is unchanged and remains the real boundary; this
 * only chooses a UI.
 */
import { isAdminConsoleRole, isOpsConsoleRole } from './roles';

export type ConsoleAudience =
  /** Auth state has not resolved yet. */
  | 'starting'
  /** Nobody is signed in — show the sign-in form. */
  | 'sign-in'
  /** Signed in and the profile is still on its way. Transient, every sign-in. */
  | 'account-loading'
  /** Signed in, but the role could not be determined. A FAULT, not a role. */
  | 'profile-unavailable'
  /** admin / accountant — the full console, behind the staff MFA gate. */
  | 'admin'
  /** branch_staff / call_center — a branch-operations console, no MFA gate. */
  | 'ops'
  /** Signed in with an account this console does not serve (e.g. a customer). */
  | 'non-staff';

export interface ConsoleAudienceInput {
  /** Has the auth listener reported an initial session yet? */
  authReady: boolean;
  /** Is there a session at all? */
  isAuthenticated: boolean;
  /** Did the profile read come back empty, or fail? */
  profileUnavailable: boolean;
  /** Is a profile actually loaded (a non-empty id)? */
  identityKnown: boolean;
  /** Is the initial load still in flight? */
  dataLoading: boolean;
  /** The loaded profile's role, if any. */
  role: string | null | undefined;
}

export function chooseConsoleAudience(input: ConsoleAudienceInput): ConsoleAudience {
  if (!input.authReady) return 'starting';
  if (!input.isAuthenticated) return 'sign-in';

  // Before the role predicates on purpose: the role is the unknown here, so it
  // cannot be used to pick a surface, and guessing it is the original defect.
  if (input.profileUnavailable) return 'profile-unavailable';

  if (!input.identityKnown) {
    // The ordinary mid-sign-in window, not a fault — see the header.
    if (input.dataLoading) return 'account-loading';
    // Settled, signed in, and still no identity. Nothing here says `customer`,
    // so refuse to say it: without this arm an empty profile fell through to
    // the non-staff arm and the browser was sent to /app.
    return 'profile-unavailable';
  }

  if (isAdminConsoleRole(input.role)) return 'admin';
  if (isOpsConsoleRole(input.role)) return 'ops';
  return 'non-staff';
}
