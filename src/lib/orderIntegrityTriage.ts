/**
 * Triage-control visibility for the Order Integrity panel.
 *
 * Acknowledge and Suppress call is_admin()-gated RPCs (they return 42501 for
 * anyone else), so the UI must not offer them to non-admins. Accountants keep
 * read-only access to the summary and incident list — those RPCs are is_staff()
 * gated and are never gated here by role. This is defense-in-depth in front of the
 * server-side authorization, not a replacement for it (the RPCs remain admin-only).
 */

/** Only admins may triage (acknowledge / suppress). Accountants are read-only. */
export const canTriageRole = (role: string | null | undefined): boolean => role === 'admin';

/** Acknowledge is offered only to admins, and only for an OPEN incident. */
export const showAcknowledge = (canTriage: boolean, status: string): boolean =>
  canTriage && status === 'open';

/** Suppress is offered only to admins, for an OPEN or ACKNOWLEDGED incident. */
export const showSuppress = (canTriage: boolean, status: string): boolean =>
  canTriage && (status === 'open' || status === 'acknowledged');
