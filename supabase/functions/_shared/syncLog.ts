/**
 * Turning a failed write into an honest `integration_sync_logs` row.
 *
 * WHY THIS EXISTS. `lazywait-webhook` recorded `status: 'success'` on every
 * inbound POS callback, unconditionally, while discarding the result of the
 * `orders` update it had just attempted (`.then(() => {}, () => {})`). A POS
 * status change could therefore be dropped and leave behind a log row asserting
 * it had landed — the worst shape a log can take, because it is the row an
 * operator reads when they are trying to work out what happened.
 *
 * The decision lives here, as a pure function, so it can actually be tested: the
 * handler itself calls `Deno.serve` and imports Deno-only modules, so Vitest can
 * never execute its control flow (see `lazywaitBaseUrlWiring.test.ts` for the
 * same constraint stated at length).
 *
 * ON WHAT GOES IN `error`. `integration_sync_logs` is readable by any staff
 * member through `integration_sync_logs_staff_read`, so this is a staff-visible
 * surface, not a private debug channel. A Postgres error message can quote the
 * offending row, so the text is bounded and the structured `code` — which never
 * carries data — is put first, where a truncation cannot eat it.
 */

/** The shape supabase-js returns in `{ error }`; only these fields are read. */
export interface WriteError {
  message?: string | null;
  code?: string | null;
}

/** `integration_sync_logs.status` is constrained to exactly these three. */
export type SyncLogStatus = 'success' | 'failed' | 'skipped';

/** Bounded so one pathological message cannot dominate the table. */
export const SYNC_LOG_ERROR_MAX = 300;

export interface SyncLogOutcome {
  status: SyncLogStatus;
  error: string | null;
}

/**
 * `undefined`/`null` means the write succeeded — supabase-js returns `{ error:
 * null }` rather than throwing, which is precisely the trap the old code fell
 * into by never destructuring it at all.
 */
export function syncLogOutcome(writeError: WriteError | null | undefined): SyncLogOutcome {
  if (!writeError) return { status: 'success', error: null };

  const code = typeof writeError.code === 'string' ? writeError.code.trim() : '';
  const message = typeof writeError.message === 'string' ? writeError.message.trim() : '';

  // Code first: it is the part that is safe by construction, and putting it
  // ahead of the message means truncation can only ever cost detail, not
  // identity.
  const parts = [code ? `[${code}]` : '', message].filter(Boolean);
  const joined = parts.join(' ') || 'write failed (no error detail supplied)';

  return {
    status: 'failed',
    error: joined.length > SYNC_LOG_ERROR_MAX ? `${joined.slice(0, SYNC_LOG_ERROR_MAX - 1)}…` : joined,
  };
}
