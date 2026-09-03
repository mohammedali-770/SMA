import { corsHeaders, json } from '../_shared/cors.ts';
import { decideAdminAuthorization } from '../_shared/adminAuth.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

/**
 * operations-alert-dispatch — the thing that finally tells a human.
 *
 * WHAT THIS EXISTS FOR
 * The alert engine has worked since 2026-07-23 and had never reached a person.
 * Every row it produced was ('in_app','recorded') and stopped in the database;
 * measured live 2026-09-03, the one critical incident on record (2026-08-10,
 * stranded orders + platform health) was seen by nobody until somebody opened
 * the console. This drains the outbox's `email` rows over the SMTP credential
 * that was already configured, and marks each one terminal.
 *
 * IT IS INERT UNTIL TWO SEPARATE THINGS ARE TRUE.
 *   1. migration 20260903120000 is applied — without it no `email` row can
 *      exist, so there is nothing to claim;
 *   2. `operations_alert_settings.external_dispatch_enabled` is true — both the
 *      producers AND this handler check it, so flipping it back off stops new
 *      rows being created and stops this function sending.
 * Deploying it changes nothing on its own. That is deliberate.
 *
 * AT MOST ONCE, NOT AT LEAST ONCE. An alert email that arrives twice trains a
 * responder to ignore alert email, which is worse than the gap it closes. Each
 * row is claimed with a per-invocation fencing token
 * (`claim_operations_alert_emails`), and every completion write is guarded by
 * that token, so a dispatcher that outlived its lease writes nothing. A claim is
 * only reclaimed after a lease longer than the platform's maximum invocation
 * wall-clock, which is what makes an expired lease provably a dead owner rather
 * than a slow one.
 *
 * CALLERS: the service role (a future scheduler) or an authenticated ADMIN
 * (role AND AAL2, through the same pure predicate every other admin function
 * uses). `verify_jwt = false`, so that check is the only gate on the path —
 * exactly the shape that made push-dispatch's AAL1 hole worth fixing.
 *
 * NO RECIPIENT ADDRESS IS STORED. `operations_alerts_dispatch_recipients()`
 * derives the list from admin profiles at send time, so removing somebody's
 * admin role stops their alert mail in the same act.
 */

/** Bounded work per invocation: alert mail should arrive promptly or not at all. */
const CLAIM_LIMIT = 20;

interface ClaimedRow {
  c_id: string;
  c_language: string;
  c_subject: string;
  c_body: string;
  c_attempts: number;
}

function isServiceRoleCall(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  return Boolean(key) && auth === `Bearer ${key}`;
}

/** Strip anything that could carry configuration detail into a stored string. */
function safeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();

  // Caller gate. Service role for automation; otherwise an admin with AAL2.
  if (!isServiceRoleCall(req)) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    const caller = userClient(authHeader);
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    const [profileRes, rpcRes] = await Promise.all([
      admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      caller.rpc('is_admin'),
    ]);
    const decision = decideAdminAuthorization(
      { data: rpcRes.data, error: rpcRes.error },
      profileRes.data?.role,
    );
    if (!decision.allowed) {
      return json({ error: decision.error, code: decision.code }, decision.status);
    }
  }

  // MASTER FLAG. Checked here as well as in the producers, so turning it off
  // stops delivery of rows that were already queued rather than only stopping
  // new ones being written.
  const { data: settings, error: settingsError } = await admin
    .from('operations_alert_settings')
    .select('external_dispatch_enabled')
    .maybeSingle();
  if (settingsError) return json({ status: 'error', reason: 'settings read failed' }, 500);
  if (!settings?.external_dispatch_enabled) {
    return json({ status: 'disabled', reason: 'external dispatch disabled' }, 200);
  }

  const cfg = await getProviderConfig(admin, 'email');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'disabled', reason: 'email provider disabled' }, 200);
  }
  const pub = cfg.publicConfig as Record<string, unknown>;
  const host = String(pub.host ?? '').trim();
  const port = Number(String(pub.port ?? '') || '587');
  const secure = pub.secure === true;
  const username = String(pub.username ?? '').trim();
  const password = String((cfg.secretConfig as Record<string, unknown>).password ?? '');
  const fromEmail = String(pub.from_email ?? '').trim();
  const fromName = String(pub.from_name ?? '').trim() || 'Spicy Meal';
  if (!host || !fromEmail || !Number.isFinite(port) || port <= 0) {
    return json({ status: 'disabled', reason: 'email provider not fully configured' }, 200);
  }

  const { data: recipientRows, error: recipientsError } = await admin
    .rpc('operations_alerts_dispatch_recipients');
  if (recipientsError) return json({ status: 'error', reason: 'recipient lookup failed' }, 500);
  const recipients = (recipientRows as string[] | null) ?? [];
  // No recipients is NOT an error, and deliberately does NOT claim anything:
  // claiming would burn attempts against rows nobody could ever have received.
  if (recipients.length === 0) {
    return json({ status: 'no_recipients', claimed: 0, sent: 0, failed: 0 }, 200);
  }

  const claimToken = crypto.randomUUID();
  const { data: claimedRows, error: claimError } = await admin
    .rpc('claim_operations_alert_emails', { p_claim_token: claimToken, p_limit: CLAIM_LIMIT });
  if (claimError) return json({ status: 'error', reason: 'claim failed (transient)' }, 500);
  const claimed = (claimedRows as ClaimedRow[] | null) ?? [];
  if (claimed.length === 0) return json({ status: 'ok', claimed: 0, sent: 0, failed: 0 }, 200);

  let sent = 0;
  let failed = 0;

  // One SMTP connection per invocation, not per message: alert bursts are
  // correlated by construction (one incident opens several conditions).
  let client: SMTPClient | null = null;
  try {
    client = new SMTPClient({
      connection: {
        hostname: host,
        port,
        tls: secure,
        auth: username ? { username, password } : undefined,
      },
    });
  } catch (e) {
    // Could not even connect: release every claim. Nothing left for SMTP, so a
    // later attempt cannot double-deliver.
    for (const row of claimed) {
      await admin.rpc('release_operations_alert_email', {
        p_id: row.c_id, p_claim_token: claimToken,
      });
    }
    return json({ status: 'error', reason: `smtp connect failed — ${safeError(e)}` }, 500);
  }

  for (const row of claimed) {
    try {
      await client.send({
        from: `${fromName} <${fromEmail}>`,
        to: recipients,
        subject: row.c_subject,
        content: row.c_body,
      });
      // The message has LEFT. Terminal either way from here — an ambiguous
      // post-send state must never be retried.
      await admin.rpc('finalize_operations_alert_email', {
        p_id: row.c_id, p_claim_token: claimToken, p_status: 'sent', p_error_safe: null,
      });
      sent += 1;
    } catch (e) {
      // A per-message failure is retryable: this one did not leave. The row goes
      // back to 'failed' with its attempt consumed, and the bounded attempt
      // budget in the claim RPC is what stops it retrying for ever.
      await admin.rpc('finalize_operations_alert_email', {
        p_id: row.c_id, p_claim_token: claimToken, p_status: 'failed', p_error_safe: safeError(e),
      });
      failed += 1;
    }
  }
  try { await client.close(); } catch { /* ignore */ }

  return json({
    status: 'ok', claimed: claimed.length, sent, failed, recipients: recipients.length,
  }, 200);
});
