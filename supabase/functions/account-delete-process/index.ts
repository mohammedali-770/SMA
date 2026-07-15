// account-delete-process — service-role processor for the account-deletion queue
// (verify_jwt=false; authenticated by the service-role bearer or a shared secret).
//
// Claims due requests (FOR UPDATE SKIP LOCKED via claim_due_account_deletions),
// then for each: checks REAL blockers → waits; otherwise anonymizes application
// data, deletes the Supabase Auth user LAST (GoTrue admin), and marks the request
// completed. Every stage is idempotent; transient failures retry with backoff and
// persistent failures escalate to manual_review. No PII / raw error is ever logged
// or returned — only safe internal codes and non-sensitive counts.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import {
  classifyBlockers,
  decideAfterFailure,
  safeFailureCode,
  statusForBlocker,
  WAITING_RECHECK_MS,
  type FailureStage,
} from '../_shared/accountDeletion.ts';

// A request blocked (waiting) this long since it was requested is escalated to a
// human instead of waiting forever — matches the "up to 30 days" completion SLA.
const MAX_WAIT_MS = 30 * 24 * 60 * 60_000;
const TERMINAL_ORDER_STATES = ['delivered', 'cancelled'];

type Admin = ReturnType<typeof adminClient>;

/** Only the service role (or an explicit shared secret) may run the processor. */
function authorized(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  if (key && auth === `Bearer ${key}`) return true;
  const secret = Deno.env.get('ACCOUNT_DELETION_PROCESS_SECRET');
  if (secret && req.headers.get('x-process-secret') === secret) return true;
  return false;
}

async function countOrThrow(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Transition a claimed request to a new state, guarded by its fencing token. */
async function transition(
  admin: Admin,
  id: string,
  token: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin.from('account_deletion_requests')
    .update({ ...patch, locked_until: null, lock_token: null })
    .eq('id', id)
    .eq('lock_token', token);
}

/** Delete the GoTrue user; treat an already-deleted user as success (idempotent). */
async function deleteAuthUser(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    const msg = (error.message ?? '').toLowerCase();
    if (msg.includes('not found') || (error as { status?: number }).status === 404) return; // already gone
    throw error;
  }
}

async function processOne(admin: Admin, row: Record<string, unknown>): Promise<'completed' | 'waiting' | 'retry' | 'manual_review'> {
  const id = String(row.id);
  const token = String(row.lock_token);
  const userId = row.user_id ? String(row.user_id) : null;
  const attempts = Number(row.attempt_count ?? 0);
  const requestedAt = new Date(String(row.requested_at ?? Date.now())).getTime();
  let stage: FailureStage = 'blockers';

  // The Auth user is already gone (SET NULL) → deletion effectively done.
  if (!userId) {
    await transition(admin, id, token, { status: 'completed', completed_at: new Date().toISOString() });
    return 'completed';
  }

  try {
    // ---- Stage: blocker checks (real states only) ----
    const [activeOrders, pendingOnlineOrders, pendingCheckoutSessions] = await Promise.all([
      countOrThrow(admin.from('orders').select('id', { count: 'exact', head: true })
        .eq('customer_id', userId).not('status', 'in', `(${TERMINAL_ORDER_STATES.join(',')})`)),
      countOrThrow(admin.from('orders').select('id', { count: 'exact', head: true })
        .eq('customer_id', userId).eq('payment_method', 'online').eq('payment_status', 'pending')),
      countOrThrow(admin.from('checkout_sessions').select('id', { count: 'exact', head: true })
        .eq('customer_id', userId).eq('status', 'pending_payment')),
    ]);

    const blocker = classifyBlockers({ activeOrders, pendingOnlineOrders, pendingCheckoutSessions });
    if (blocker !== 'none') {
      // Waited past the SLA while still blocked → hand to manual review.
      if (Date.now() - requestedAt > MAX_WAIT_MS) {
        await transition(admin, id, token, { status: 'manual_review', manual_review_reason: `blocked_${blocker}_over_sla` });
        return 'manual_review';
      }
      await transition(admin, id, token, {
        status: statusForBlocker(blocker),
        next_attempt_at: new Date(Date.now() + WAITING_RECHECK_MS).toISOString(),
      });
      return 'waiting';
    }

    // ---- Stage: anonymize application data (idempotent) ----
    stage = 'anonymize';
    const { data: summary, error: anonErr } = await admin.rpc('anonymize_account_data', { p_user_id: userId });
    if (anonErr) throw anonErr;

    // ---- Stage: delete the Auth user LAST (idempotent) ----
    stage = 'auth_delete';
    await deleteAuthUser(admin, userId);

    // ---- Stage: mark completed with a non-sensitive retention summary ----
    stage = 'complete';
    await transition(admin, id, token, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      retention_summary: summary ?? {},
      failure_code: null,
      failure_stage: null,
    });
    return 'completed';
  } catch (_e) {
    // Never surface raw errors: decide retry vs. manual review on a safe code.
    const decision = decideAfterFailure(attempts + 1);
    await transition(admin, id, token, {
      status: decision.status,
      attempt_count: attempts + 1,
      failure_code: safeFailureCode(stage),
      failure_stage: stage,
      next_attempt_at: decision.nextAttemptMs != null ? new Date(Date.now() + decision.nextAttemptMs).toISOString() : null,
      ...(decision.status === 'manual_review' ? { manual_review_reason: safeFailureCode(stage) } : {}),
    });
    return decision.status === 'manual_review' ? 'manual_review' : 'retry';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorized(req)) return json({ error: 'Forbidden' }, 403);

  const admin = adminClient();

  // Claim a bounded batch. Concurrent invocations skip each other's rows.
  const { data: claimed, error } = await admin.rpc('claim_due_account_deletions', {
    p_limit: 5, p_lease_seconds: 300,
  });
  if (error) return json({ error: 'claim_failed', code: safeFailureCode('claim') }, 500);

  const rows = Array.isArray(claimed) ? claimed : [];
  const tally = { processed: 0, completed: 0, waiting: 0, retry: 0, manual_review: 0 };
  for (const row of rows) {
    const outcome = await processOne(admin, row as Record<string, unknown>);
    tally.processed += 1;
    tally[outcome] += 1;
  }

  return json({ ok: true, ...tally }, 200);
});
