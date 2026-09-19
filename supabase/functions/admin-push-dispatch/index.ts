import { corsHeaders, json } from '../_shared/cors.ts';
import { decideAdminAuthorization } from '../_shared/adminAuth.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import {
  type CallerKind,
  type NotificationRequest,
  type QueuedNotification,
  buildPayload,
  classifyDelivery,
  mayDrainQueue,
  parseDispatchMode,
  parseNotificationRequest,
  requestFromQueueRow,
  scopeFor,
  shouldPruneAfterFailure,
} from '../_shared/adminPush.ts';
import { assertVapidKeyPair, buildPushRequest, type VapidKeyPair } from '../_shared/webPush.ts';

/**
 * admin-push-dispatch — web push to the staff console installed on an admin's
 * phone.
 *
 * WHAT IT IS FOR. When a branch closes a product, a size or delivery, the admin
 * should find out without opening the console. The console is a PWA on the
 * Home Screen (`public/manifest.webmanifest`), so the delivery channel is web
 * push through `public/sw.js`. This function is the sender.
 *
 * IT IS A DIFFERENT CHANNEL FROM THE CUSTOMER ONE, AND THAT SEPARATION IS THE
 * SAFETY PROPERTY RATHER THAN AN IMPLEMENTATION DETAIL. Customer push is Expo,
 * keyed on `push_devices.customer_id`, sent by `push-dispatch`, and governed by
 * CLAUDE.md §7. Nothing here touches that table, that function or that
 * provider: a predicate mistake in a staff feature must not be able to put a
 * branch closure on a customer's lock screen. Migration 20260927120000's
 * assertion 5.9 fails the apply if any of its RPCs ever references
 * `push_devices`.
 *
 * WHO MAY CALL IT, and what each caller may reach:
 *   - the SCHEDULER, `invoke_admin_push_dispatch` running under pg_cron. It
 *     proves itself with an HMAC over a Vault-held secret that this process
 *     never sees: it sends nonce + timestamp + signature and Postgres
 *     recomputes. So the value cannot appear in a function log, in request
 *     instrumentation, or in a dump of this process.
 *   - the SERVICE ROLE, for any other automation.
 *   - an ADMIN at AAL2, which is the console's "send a test notification"
 *     button. Their send reaches THEIR OWN devices only — see `scopeFor`.
 * `verify_jwt = false`, so this check is the only gate on the path; that is the
 * same shape as `push-dispatch`, whose AAL1 hole was worth fixing.
 *
 * TWO MODES. `direct` takes the copy in the request body and sends it once.
 * `queue` claims rows from `admin_push_outbox` — the closure notices the step 4
 * triggers write — sends each, and records the outcome under a fencing token.
 * An admin may not use `queue`: a drain CONSUMES rows while their scope is
 * their own devices, so it would deliver every branch's notices to one phone
 * and mark them done for everybody (`mayDrainQueue`).
 *
 * THE PRIVATE KEY IS A FUNCTION SECRET AND EXISTS NOWHERE ELSE. The public half
 * lives in `app_settings.admin_push_vapid_public_key` because the browser needs
 * it to subscribe, and is harmless there — it identifies the sender and cannot
 * sign anything. The two are configured by hand in two different places, so
 * this function refuses to send unless they are a real key pair AND the public
 * half matches the one clients subscribed with. Without that check a
 * transposed character produces an opaque 401 from every endpoint, which reads
 * like a dead feature rather than a typo.
 *
 * DEPLOYING IT SENDS NOTHING. With no VAPID secret configured it answers
 * `not_configured`; with one configured and nobody subscribed it answers
 * `no_subscriptions`. The closure trigger that gives it work is a separate
 * change, and turning any of this on is an owner action under CLAUDE.md §5.
 */

const VAPID_SUBJECT_FALLBACK = 'https://app.spicymeal.com.sa';

/** One push service should never hold up the rest; the driver retries. */
const SEND_TIMEOUT_MS = 10_000;

/** Concurrent sends. Small deliberately: the audience is a handful of phones. */
const SEND_CONCURRENCY = 6;

/** Bounded work per invocation. The driver ticks every minute. */
const CLAIM_LIMIT = 10;

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: string;
  failure_count: number;
}

function isServiceRoleCall(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  return Boolean(key) && auth === `Bearer ${key}`;
}

/**
 * A push endpoint is a CAPABILITY URL — whoever holds it can address that
 * device — so it is never logged whole. The origin says which push service
 * answered, which is the only part worth having in a log line.
 */
function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return 'unparseable';
  }
}

function readVapidKeys(): VapidKeyPair | null {
  const publicKey = Deno.env.get('ADMIN_PUSH_VAPID_PUBLIC_KEY')?.trim();
  const privateKey = Deno.env.get('ADMIN_PUSH_VAPID_PRIVATE_KEY')?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();

  // ---- who is calling -------------------------------------------------------
  //
  // In order of how often each is used: the pg_cron driver, the service role,
  // then an administrator pressing the console's control.
  const nonce = req.headers.get('x-admin-push-nonce');
  const stamp = req.headers.get('x-admin-push-timestamp');
  const signature = req.headers.get('x-admin-push-signature');

  let caller: CallerKind;
  let callerId: string | null = null;
  if (nonce !== null || stamp !== null || signature !== null) {
    // ANY ONE of the three present means a scheduler call was attempted. A
    // partial set is a denial, never a fall-through to another gate.
    const { data: ok, error } = await admin.rpc('verify_admin_push_dispatch_signature', {
      p_nonce: nonce,
      p_timestamp: stamp,
      p_signature: signature,
    });
    // A MISSING RPC IS A DENIAL, not a 500. Deploying this before the step 4
    // migration is applied is an ordering mistake, not an attack, and the
    // honest answer is the same as for a bad signature: this caller is not
    // authorized yet. Nothing calls the scheduler path until that migration
    // schedules the job, so failing closed here costs nothing.
    if (error) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    // Strict `=== true`: the RPC is fail-closed, but a truthy non-boolean must
    // never be read as authentication.
    if (ok !== true) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    caller = 'scheduler';
  } else if (isServiceRoleCall(req)) {
    caller = 'service_role';
  } else {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    const asCaller = userClient(authHeader);
    const {
      data: { user },
    } = await asCaller.auth.getUser();
    if (!user) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    const [profileRes, rpcRes] = await Promise.all([
      admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      asCaller.rpc('is_admin'),
    ]);
    // Role AND AAL2, through the same pure predicate every other admin function
    // uses. An administrator who has not completed TOTP cannot send.
    const decision = decideAdminAuthorization(
      { data: rpcRes.data, error: rpcRes.error },
      profileRes.data?.role,
    );
    if (!decision.allowed) return json({ error: decision.error, code: decision.code }, decision.status);
    caller = 'admin';
    callerId = user.id;
  }
  const scope = scopeFor(caller);

  // ---- what to send ---------------------------------------------------------
  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: 'invalid JSON body', code: 'bad_request' }, 400);
  }
  const mode = parseDispatchMode(rawBody);
  if (mode === null) return json({ error: 'unknown mode', code: 'bad_request' }, 400);
  if (mode === 'queue' && !mayDrainQueue(caller)) {
    return json({ error: 'queue mode is not available to this caller', code: 'forbidden' }, 403);
  }

  // Only a direct send carries copy. A queue drain gets its copy from the rows
  // it claims, composed in SQL when the closure happened.
  let directRequest: NotificationRequest | null = null;
  if (mode === 'direct') {
    const parsed = parseNotificationRequest(rawBody);
    if (!parsed.ok) return json({ error: parsed.reason, code: 'bad_request' }, 400);
    directRequest = parsed.request;
  }

  // ---- the keys -------------------------------------------------------------
  //
  // `not_configured` is a 200 on purpose. The database driver retries a 5xx,
  // and retrying a missing secret every minute for ever produces noise rather
  // than a fix. It is logged instead, where the reason is legible.
  const configured = readVapidKeys();
  if (!configured) {
    console.error('admin push: no VAPID key configured');
    return json({ status: 'not_configured', reason: 'no VAPID key configured' }, 200);
  }
  const keys: VapidKeyPair = configured;
  try {
    await assertVapidKeyPair(keys);
  } catch {
    console.error('admin push: VAPID public and private keys do not match');
    return json({ status: 'misconfigured', reason: 'VAPID key pair mismatch' }, 200);
  }
  const { data: settings, error: settingsError } = await admin
    .from('app_settings')
    .select('admin_push_vapid_public_key')
    .eq('id', true)
    .maybeSingle();
  if (settingsError) return json({ status: 'error', reason: 'settings read failed' }, 500);
  const advertised = (settings?.admin_push_vapid_public_key ?? '').trim();
  // EVERY EXISTING SUBSCRIPTION IS BOUND TO THE KEY IT WAS CREATED WITH. If the
  // table advertises a different one, those subscriptions were made against a
  // key we can no longer sign for, and every send would be refused 403. Saying
  // so once beats discovering it one endpoint at a time.
  if (advertised !== keys.publicKey) {
    console.error('admin push: configured VAPID key does not match app_settings', {
      advertised_present: advertised.length > 0,
    });
    return json({ status: 'misconfigured', reason: 'VAPID key does not match app_settings' }, 200);
  }
  const subject = Deno.env.get('ADMIN_PUSH_VAPID_SUBJECT')?.trim() || VAPID_SUBJECT_FALLBACK;

  // ---- who receives it ------------------------------------------------------
  let query = admin
    .from('admin_push_subscriptions')
    .select('id, endpoint, p256dh, auth, lang, failure_count');
  if (scope === 'self') {
    // `callerId` is set on exactly the branch that produces this scope, so a
    // null here would mean the two had drifted apart. Refusing is the only safe
    // reading: an unscoped query in this position fans out to every admin.
    if (callerId === null) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    query = query.eq('admin_id', callerId);
  }
  const { data: rows, error: rowsError } = await query;
  if (rowsError) return json({ status: 'error', reason: 'subscription read failed' }, 500);
  const subscriptions = (rows as SubscriptionRow[] | null) ?? [];
  if (subscriptions.length === 0) {
    return json({ status: 'no_subscriptions', sent: 0, failed: 0, pruned: 0 }, 200);
  }

  // ---- send -----------------------------------------------------------------
  const at = Date.now();
  let sent = 0;
  let failed = 0;
  let pruned = 0;

  async function deliver(row: SubscriptionRow, request: NotificationRequest): Promise<boolean> {
    let status: number;
    try {
      const push = await buildPushRequest({
        subscription: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload: buildPayload(request, row.lang, at),
        vapid: { subject, keys },
        nowSeconds: Math.floor(at / 1000),
        ttlSeconds: request.ttlSeconds,
      });
      const response = await fetch(push.url, {
        method: 'POST',
        headers: push.headers,
        body: push.body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      status = response.status;
    } catch (e) {
      // A refused connection, a DNS failure or our own timeout. Not evidence
      // the subscription is dead, so it is counted as a retryable failure and
      // never as `gone`.
      console.error('admin push: send threw', {
        origin: endpointOrigin(row.endpoint),
        error: e instanceof Error ? e.name : 'unknown',
      });
      status = 0;
    }

    const outcome = classifyDelivery(status);
    if (outcome === 'sent') {
      sent += 1;
      await admin
        .from('admin_push_subscriptions')
        .update({ last_success_at: new Date(at).toISOString(), failure_count: 0 })
        .eq('id', row.id);
      return true;
    }
    if (outcome === 'gone') {
      // The browser is uninstalled or the subscription was revoked. The row is
      // the only thing that would keep it alive, so remove it.
      pruned += 1;
      await admin.from('admin_push_subscriptions').delete().eq('id', row.id);
      return false;
    }
    failed += 1;
    const nextCount = row.failure_count + 1;
    console.error('admin push: send refused', {
      origin: endpointOrigin(row.endpoint),
      status,
      failure_count: nextCount,
    });
    if (shouldPruneAfterFailure(nextCount)) {
      pruned += 1;
      await admin.from('admin_push_subscriptions').delete().eq('id', row.id);
      return false;
    }
    await admin
      .from('admin_push_subscriptions')
      .update({ last_failure_at: new Date(at).toISOString(), failure_count: nextCount })
      .eq('id', row.id);
    return false;
  }

  /** Fan one notification out to every subscription in scope. */
  async function fanOut(request: NotificationRequest): Promise<number> {
    let delivered = 0;
    for (let i = 0; i < subscriptions.length; i += SEND_CONCURRENCY) {
      const batch = subscriptions.slice(i, i + SEND_CONCURRENCY);
      const results = await Promise.all(batch.map((row) => deliver(row, request)));
      delivered += results.filter(Boolean).length;
    }
    return delivered;
  }

  if (mode === 'direct') {
    const delivered = await fanOut(directRequest as NotificationRequest);
    return json(
      { status: 'ok', mode, scope, subscriptions: subscriptions.length, delivered, sent, failed, pruned },
      200,
    );
  }

  // ---- queue mode -----------------------------------------------------------
  //
  // CLAIMED ONLY AFTER THE SUBSCRIPTION READ, which is why the empty-audience
  // return above sits where it does. Claiming first would burn an attempt
  // against every queued notice on a deployment where nobody has subscribed,
  // and three ticks later they would all be `failed` for a reason that was
  // never theirs.
  const claimToken = crypto.randomUUID();
  const { data: claimedRows, error: claimError } = await admin.rpc('claim_admin_push_notifications', {
    p_claim_token: claimToken,
    p_limit: CLAIM_LIMIT,
  });
  if (claimError) return json({ status: 'error', reason: 'claim failed (transient)' }, 500);
  const claimed = (claimedRows as QueuedNotification[] | null) ?? [];
  if (claimed.length === 0) {
    return json({ status: 'ok', mode, claimed: 0, sent: 0, failed: 0, pruned: 0 }, 200);
  }

  let notified = 0;
  let unnotified = 0;
  for (const row of claimed) {
    const delivered = await fanOut(requestFromQueueRow(row));
    // ONE DEVICE IS ENOUGH TO CALL IT SENT. An admin with a dead second browser
    // must not cause every closure notice to be retried and then marked failed.
    const ok = delivered > 0;
    if (ok) notified += 1;
    else unnotified += 1;
    await admin.rpc('finalize_admin_push_notification', {
      p_id: row.id,
      p_claim_token: claimToken,
      p_status: ok ? 'sent' : 'failed',
      p_error_safe: ok ? null : 'no subscription accepted the notification',
    });
  }

  return json(
    {
      status: 'ok',
      mode,
      subscriptions: subscriptions.length,
      claimed: claimed.length,
      notified,
      unnotified,
      sent,
      failed,
      pruned,
    },
    200,
  );
});
