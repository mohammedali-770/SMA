/**
 * Account-deletion — PURE, framework-free helpers (no React Native / Expo /
 * Supabase), so they are unit-tested under Node (accountDeletion.test.ts) and
 * reused by the Delete Account screen. The screen NEVER shows a raw server
 * status or backend error to the customer; it maps everything through here to a
 * safe localized key.
 */
import type { StringKey } from '../../i18n/strings';

/** Company support contacts (fixed company facts, shown when help is needed). */
export const SUPPORT_EMAIL = 'info@spicymeal.com.sa';
export const SUPPORT_PHONE = '920031495';

export type DeletionStatus =
  | 'queued'
  | 'waiting_for_active_order'
  | 'waiting_for_financial_process'
  | 'processing'
  | 'completed'
  | 'retry_scheduled'
  | 'manual_review'
  | 'failed';

/** Statuses that mean an in-flight request already exists (block a new one). */
export const ACTIVE_DELETION_STATUSES: readonly DeletionStatus[] = [
  'queued',
  'waiting_for_active_order',
  'waiting_for_financial_process',
  'processing',
  'retry_scheduled',
  'manual_review',
];

export function isActiveDeletionStatus(status: string | null | undefined): boolean {
  return !!status && (ACTIVE_DELETION_STATUSES as readonly string[]).includes(status);
}

/**
 * Map a raw server status to a SAFE localized message key. Internal statuses
 * like `waiting_for_financial_process` are never shown to the customer verbatim.
 */
export function deletionStatusMessageKey(status: string | null | undefined): StringKey {
  switch (status) {
    case 'waiting_for_active_order':
      return 'delWaitingOrder';
    case 'waiting_for_financial_process':
      return 'delWaitingFinancial';
    case 'manual_review':
      return 'delManualReview';
    case 'completed':
      return 'delCompleted';
    case 'queued':
    case 'processing':
    case 'retry_scheduled':
    default:
      return 'delReceived';
  }
}

/**
 * Best-effort check for a network/offline failure so the UI can show a friendly
 * "you appear to be offline" state instead of a raw technical error. Never shows
 * the message itself — only decides which safe localized string to render.
 */
export function isLikelyOffline(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (!msg) return false;
  return /network|fetch failed|failed to fetch|offline|unable to resolve host|unknownhostexception|connection|timed out|timeout|enotfound|econnrefused|net::err/.test(msg);
}

export type ReverifyMethod = 'otp' | 'reauth';

/**
 * Whether the destructive submit may proceed: the consequences must be
 * acknowledged AND a valid re-verification factor must be present (a 6-digit
 * OTP, or a non-empty password for the reauth fallback).
 */
export function canSubmitDeletion(input: {
  acknowledged: boolean;
  method: ReverifyMethod | null;
  code: string;
  password: string;
}): boolean {
  if (!input.acknowledged || !input.method) return false;
  if (input.method === 'otp') return /^\d{6}$/.test(input.code.trim());
  return input.password.length > 0;
}
