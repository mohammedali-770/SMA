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
