/**
 * The notification_log write for an admin broadcast, kept apart from the
 * handler so a test can run it. It imports nothing, and Vitest loads it.
 *
 * WHAT IT RECORDS (20261007120000). The verified admin who sent the broadcast
 * (`sent_by`) and the four strings that went out (`content`), beside the
 * delivery counts the row always carried. Before that migration the row said
 * only `kind: 'broadcast'` and the counts, so nothing recorded who sent an
 * unrecallable message to every opted-in customer, or what it said.
 *
 * WHY IT CANNOT FAIL THE REQUEST. This runs AFTER the broadcast has gone out.
 * If a failed log write became an error response, the admin would be told the
 * broadcast failed, and the obvious next step is to send it again, which
 * reaches every customer a second time and cannot be recalled. So this function
 * never throws and never changes the response. It returns what happened, for a
 * log line.
 *
 * WHY IT FALLS BACK. The function is deployed separately from the migration.
 * Deployed first, the insert names two columns that do not exist yet, and
 * PostgREST refuses the whole row with PGRST204 (42703 if it ever reaches
 * Postgres). Without a fallback that loses the counts row as well. On exactly
 * those two codes it writes the old row shape, so a deploy-before-apply keeps
 * today's record and loses only the new fields. Any other error is not retried:
 * a second insert after an unknown failure could write the row twice.
 *
 * The order the owner is asked to follow is still: apply the migration, then
 * deploy (docs/OWNER_ACTIONS.md).
 */

export interface BroadcastContent {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface BroadcastCounts {
  targeted: number;
  sent: number;
  failed: number;
  deactivated: number;
}

export interface InsertError {
  code?: string | null;
  message?: string | null;
}

export type NotificationLogInsert = (
  row: Record<string, unknown>,
) => PromiseLike<{ error: InsertError | null }>;

/** 'logged': the full row. 'logged_without_audit': the old shape, after a
 *  column-missing error. 'not_logged': no row. */
export type BroadcastLogOutcome = 'logged' | 'logged_without_audit' | 'not_logged';

/** The errors that mean "these columns do not exist yet", and nothing else. */
export const COLUMN_MISSING_CODES: readonly string[] = ['PGRST204', '42703'];

export function isColumnMissing(error: InsertError | null | undefined): boolean {
  return !!error && typeof error.code === 'string' && COLUMN_MISSING_CODES.includes(error.code);
}

export function broadcastLogRow(
  adminId: string,
  content: BroadcastContent,
  counts: BroadcastCounts,
): Record<string, unknown> {
  return {
    ...legacyBroadcastLogRow(counts),
    sent_by: adminId,
    content: {
      titleEn: content.titleEn,
      titleAr: content.titleAr,
      bodyEn: content.bodyEn,
      bodyAr: content.bodyAr,
    },
  };
}

/** The row as it was before 20261007120000. */
export function legacyBroadcastLogRow(counts: BroadcastCounts): Record<string, unknown> {
  return {
    kind: 'broadcast',
    targeted: counts.targeted,
    sent: counts.sent,
    failed: counts.failed,
    deactivated: counts.deactivated,
  };
}

export async function logBroadcast(
  insert: NotificationLogInsert,
  adminId: string,
  content: BroadcastContent,
  counts: BroadcastCounts,
): Promise<BroadcastLogOutcome> {
  try {
    const first = await insert(broadcastLogRow(adminId, content, counts));
    if (!first.error) return 'logged';
    if (!isColumnMissing(first.error)) return 'not_logged';
    const second = await insert(legacyBroadcastLogRow(counts));
    return second.error ? 'not_logged' : 'logged_without_audit';
  } catch {
    return 'not_logged';
  }
}
