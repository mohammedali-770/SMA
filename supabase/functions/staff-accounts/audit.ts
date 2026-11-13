/**
 * The audit row for a staff password reset or deletion (20261007120000), kept
 * apart from the handler so a test can run it. It imports nothing.
 *
 * WHAT IT RECORDS. The verified caller (the admin the handler has already
 * authorised), the action, the target account's id and the role it held. Never
 * the password: the builder below takes no password argument, so there is
 * nothing to leak, and `record_admin_action` refuses a detail with a
 * password-, secret- or token-like key anywhere in it.
 *
 * WHEN IT IS WRITTEN, and why. AFTER the Admin API call has succeeded, and only
 * then. Writing first would record a reset or deletion that then failed.
 * Writing after means the one failure left is an audit write that fails after
 * the account really changed. In that case the handler still returns the real
 * outcome and logs a line: reporting a completed deletion as failed would send
 * the admin to retry something already done, and a failed retry of a delete
 * reads as "account not found". The row is lost in that case, and the log line
 * is the record.
 *
 * DEPLOY ORDER. Deployed before 20261007120000 is applied, the RPC does not
 * exist (PGRST202). That is the same path: the action still succeeds and the
 * log line says the audit row was not written. Apply first, then deploy.
 */

export type StaffAuditAction = 'staff_password_reset' | 'staff_account_delete';

export interface RecordAdminActionArgs {
  p_actor: string;
  p_action: StaffAuditAction;
  p_target_table: 'auth.users';
  p_target_id: string;
  p_detail: { target_role: string };
}

export type RecordAdminActionCall = (
  args: RecordAdminActionArgs,
) => PromiseLike<{ error: { code?: string | null; message?: string | null } | null }>;

export function staffAuditArgs(
  action: StaffAuditAction,
  actorId: string,
  targetId: string,
  targetRole: string,
): RecordAdminActionArgs {
  return {
    p_actor: actorId,
    p_action: action,
    p_target_table: 'auth.users',
    p_target_id: targetId,
    p_detail: { target_role: targetRole },
  };
}

/** True when the row was written. Never throws. */
export async function recordStaffAction(
  call: RecordAdminActionCall,
  args: RecordAdminActionArgs,
): Promise<boolean> {
  try {
    const { error } = await call(args);
    return !error;
  } catch {
    return false;
  }
}
