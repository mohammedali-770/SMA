/**
 * Account-deletion processor — PURE decision logic (no Deno / npm / Supabase
 * imports), so it is unit-tested under Vitest (accountDeletion.test.ts) and
 * reused by the `account-delete-process` Edge Function. It NEVER touches secrets,
 * PII, or the network; it only maps observed counts/attempts to the next safe
 * queue state. Every function here is deterministic and idempotent.
 */

export type DeletionStatus =
  | 'queued'
  | 'waiting_for_active_order'
  | 'waiting_for_financial_process'
  | 'processing'
  | 'completed'
  | 'retry_scheduled'
  | 'manual_review'
  | 'failed';

/** Which category of blocker (if any) currently prevents safe deletion. */
export type BlockerKind = 'none' | 'active_order' | 'financial';

/** The processing stage a failure happened in (used only for safe internal codes). */
export type FailureStage =
  | 'claim'
  | 'blockers'
  | 'anonymize'
  | 'auth_delete'
  | 'complete'
  | 'unknown';

/**
 * Live counts the processor reads from REAL business state (never invented):
 *  - activeOrders: orders whose status is not a terminal one (delivered/cancelled)
 *  - pendingOnlineOrders: online orders still awaiting payment (payment_status pending)
 *  - pendingCheckoutSessions: checkout sessions still 'pending_payment'
 */
export interface BlockerCounts {
  activeOrders: number;
  pendingOnlineOrders: number;
  pendingCheckoutSessions: number;
}

/** Max automatic attempts before a persistently-failing request is escalated. */
export const MAX_AUTO_ATTEMPTS = 5;
/** Retry backoff (transient processing failures). */
export const RETRY_BASE_MS = 60_000; // 1 minute
export const RETRY_CAP_MS = 60 * 60_000; // 1 hour
/** How long to wait before automatically re-checking a temporary blocker. */
export const WAITING_RECHECK_MS = 6 * 60 * 60_000; // 6 hours

const n = (v: number | undefined | null): number => (Number.isFinite(v as number) && (v as number) > 0 ? (v as number) : 0);

/**
 * Classify the current blocker from live counts. Active orders take priority
 * over financial processes; both are TEMPORARY (the processor waits + rechecks).
 * An empty result ('none') means it is safe to proceed to anonymization.
 */
export function classifyBlockers(c: BlockerCounts): BlockerKind {
  if (n(c.activeOrders) > 0) return 'active_order';
  if (n(c.pendingOnlineOrders) > 0 || n(c.pendingCheckoutSessions) > 0) return 'financial';
  return 'none';
}

/** The waiting status that corresponds to a temporary blocker. */
export function statusForBlocker(kind: BlockerKind): DeletionStatus {
  switch (kind) {
    case 'active_order':
      return 'waiting_for_active_order';
    case 'financial':
      return 'waiting_for_financial_process';
    default:
      return 'processing';
  }
}

/** Exponential backoff (capped) for transient-failure retries. Deterministic. */
export function computeBackoffMs(attempt: number): number {
  const a = Math.max(1, Math.floor(attempt));
  const raw = RETRY_BASE_MS * 2 ** (a - 1);
  return Math.min(RETRY_CAP_MS, raw);
}

export interface FailureDecision {
  status: DeletionStatus;
  /** ms from now until the next attempt; null when moved to manual review. */
  nextAttemptMs: number | null;
}

/**
 * Decide what happens after a transient processing failure: schedule a bounded
 * retry, or — once the automatic attempt budget is exhausted — escalate to
 * manual review (never silently drop, never infinite-retry).
 */
export function decideAfterFailure(attemptCount: number, max: number = MAX_AUTO_ATTEMPTS): FailureDecision {
  if (Math.floor(attemptCount) >= Math.floor(max)) {
    return { status: 'manual_review', nextAttemptMs: null };
  }
  return { status: 'retry_scheduled', nextAttemptMs: computeBackoffMs(attemptCount) };
}

/** A terminal state never processed again. */
export function isTerminal(s: DeletionStatus): boolean {
  return s === 'completed' || s === 'failed';
}

/**
 * Map a processing stage to a safe, structured internal failure code. NEVER
 * contains the raw error text, PII, hostnames, or stack traces — only the stage.
 */
export function safeFailureCode(stage: FailureStage): string {
  return `deletion_${stage}_failed`;
}

// ---------------------------------------------------------------------------
// Identity binding for destructive re-verification (Issue 1).
// ---------------------------------------------------------------------------

/** Re-verification factors, derived ONLY from GoTrue-owned auth.getUser fields. */
export interface AuthOwnedFactors {
  /** E.164-ish phone to send an OTP to, or null when the AUTH user has no phone. */
  otpPhone: string | null;
  /** Email to reauthenticate against, or null when the AUTH user has no email. */
  reauthEmail: string | null;
}

/**
 * Destructive account-deletion re-verification must bind to AUTH-OWNED
 * credentials (auth.getUser().email / .phone), never to customer-editable
 * profile fields — otherwise editing a profile row could redirect the OTP or
 * change which email authorizes deletion. This returns only the auth-owned
 * values (trimmed; empty → null). Profile data is never an input here.
 */
export function authOwnedFactors(user: { email?: string | null; phone?: string | null }): AuthOwnedFactors {
  const phone = typeof user.phone === 'string' && user.phone.trim() ? user.phone.trim() : null;
  const email = typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null;
  return { otpPhone: phone, reauthEmail: email };
}

/**
 * Password reauthentication authorizes deletion ONLY when signInWithPassword
 * returned the SAME authenticated user id. A valid password for any other
 * account (or a null/absent user) must never satisfy re-verification.
 */
export function passwordReauthUserMatches(
  signInUserId: string | null | undefined,
  authUserId: string | null | undefined,
): boolean {
  return !!signInUserId && !!authUserId && signInUserId === authUserId;
}

// ---------------------------------------------------------------------------
// Fenced transition interpretation (Issue 3).
// ---------------------------------------------------------------------------

/** Outcome of processing one queued request. */
export type TransitionOutcome =
  | 'completed'
  | 'waiting'
  | 'retry'
  | 'manual_review'
  | 'lost_lease'
  | 'completion_deferred';

/**
 * A fencing-guarded status transition is only successful when its
 * `lock_token`-guarded UPDATE actually matched our row. If it matched no row the
 * lease was lost/stale (another processor owns the request) — never report the
 * intended transition as successful, and never overwrite the newer owner.
 */
export function interpretTransition(matchedRow: boolean, intended: TransitionOutcome): TransitionOutcome {
  return matchedRow ? intended : 'lost_lease';
}

// ---------------------------------------------------------------------------
// Staff accounts never leave through the customer deletion path (F-X05-001).
// ---------------------------------------------------------------------------

/**
 * The customer deletion path is re-verified by a code to the account's own phone
 * or by its own password, and a password sign-in is an AAL1 session. Staff
 * authority everywhere else needs AAL2 (`is_admin()` = role AND AAL2), and the
 * last-administrator rule lives in `admin_set_user_role`, so a staff account that
 * could erase itself through THIS path would skip both. This is an ALLOW-LIST on
 * purpose: a role added to the enum later is refused until someone decides
 * otherwise, instead of being admitted by a deny-list that forgot it.
 *
 * A profile with no row (null role) holds no staff authority anywhere in the
 * schema (`current_app_role()` is null, so every predicate is false) and is
 * treated as a customer, which keeps the path unchanged for them.
 */
export function isCustomerRoleForDeletion(role: unknown): boolean {
  return role === null || role === undefined || role === 'customer';
}

/** Safe, customer-readable reason stored when the processor holds a staff request. */
export const STAFF_DELETION_HOLD_REASON = 'staff_account_requires_admin';

export type DeletionAccountGuard =
  | { allowed: true }
  | { allowed: false; status: number; code: string; message: string };

/**
 * Decide whether the caller's account may use the customer deletion path, from
 * the result of reading its own `profiles.role` (the id comes from the verified
 * JWT, never the body). Fails CLOSED: a failed read is a refusal, never a pass.
 */
export function decideDeletionAccountGuard(lookup: { role: unknown; error: unknown }): DeletionAccountGuard {
  if (lookup.error !== null && lookup.error !== undefined) {
    return {
      allowed: false,
      status: 500,
      code: 'role_check_failed',
      message: 'We could not verify your account. Please try again.',
    };
  }
  if (!isCustomerRoleForDeletion(lookup.role)) {
    return {
      allowed: false,
      status: 403,
      code: 'staff_account',
      message: 'Staff accounts cannot be deleted from the app. Ask an administrator.',
    };
  }
  return { allowed: true };
}
