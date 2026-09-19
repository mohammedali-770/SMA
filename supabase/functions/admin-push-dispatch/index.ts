import { corsHeaders, json } from '../_shared/cors.ts';
import { decideAdminAuthorization } from '../_shared/adminAuth.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import {
  type CallerKind,
  buildPayload,
  classifyDelivery,
  parseNotificationRequest,
  parseTargetEndpoint,
  refusePushEndpoint,
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
 *   - the SERVICE ROLE, which is how the database's closure driver sends. This
 *     is the only caller that fans out to every subscription.
 *   - an ADMIN at AAL2, which is the console's "send a test notification"
 *     button. Their send reaches THEIR OWN devices only — see `scopeFor`.
 * `verify_jwt = false`, so this check is the only gate on the path; that is the
 * same shape as `push-dispatch`, whose AAL1 hole was worth fixing.
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

/**
 * OPTIONAL pin for the push endpoints this deployment will POST to,
 * comma-separated. Unset — which is how every deployment stands today — means
 * "any public hostname", so setting it narrows the guard in
 * `refusePushEndpoint` and never widens it. Same shape as `SMTP_ALLOWED_HOSTS`.
 */
const ADMIN_PUSH_ALLOWED_HOSTS = Deno.env.get('ADMIN_PUSH_ALLOWED_HOSTS') ?? null;

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
  let caller: CallerKind;
  let callerId: string | null = null;
  if (isServiceRoleCall(req)) {
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
  const parsed = parseNotificationRequest(rawBody);
  if (!parsed.ok) return json({ error: parsed.reason, code: 'bad_request' }, 400);
  const request = parsed.request;
  // OPTIONAL: narrow the send to ONE of the caller's devices. The console uses
  // it so its confirmation reaches the browser that was just enabled rather
  // than every device that admin owns — otherwise a notification arriving on an
  // older phone looks like proof that the NEW subscription works. Review caught
  // that on #398. It only ever narrows: the scope filter below still applies.
  const targetEndpoint = parseTargetEndpoint(rawBody);

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
  // ANDed with the scope filter, never instead of it, so naming somebody else's
  // endpoint narrows a caller's own set to nothing rather than reaching it.
  if (targetEndpoint !== null) query = query.eq('endpoint', targetEndpoint);
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

  async function deliver(row: SubscriptionRow): Promise<void> {
    // VALIDATED BEFORE ANYTHING IS SENT. The endpoint is whatever was stored,
    // and storing one needs only an admin at AAL2 — so this is containment for
    // a compromised admin session or a leaked service key, the same reasoning
    // as `smtpTarget.ts`. A refusal is terminal for the row: no host check is
    // going to pass on a later tick, so retrying would only repeat it.
    const refusal = refusePushEndpoint(row.endpoint, ADMIN_PUSH_ALLOWED_HOSTS);
    if (refusal !== null) {
      failed += 1;
      console.error('admin push: endpoint refused', {
        origin: endpointOrigin(row.endpoint),
        reason: refusal,
      });
      await admin
        .from('admin_push_subscriptions')
        .update({
          last_failure_at: new Date(at).toISOString(),
          failure_count: row.failure_count + 1,
        })
        .eq('id', row.id);
      return;
    }

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
        // A CHECKED HOST MUST NOT BE ABLE TO HAND THE REQUEST ON. Following a
        // 3xx would re-point this POST at an address `refusePushEndpoint` never
        // saw, which is the whole guard undone by one Location header. Manual
        // redirects surface as a 3xx status, which `classifyDelivery` reads as
        // a retryable failure rather than a dead subscription.
        redirect: 'manual',
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
      return;
    }
    if (outcome === 'gone') {
      // The browser is uninstalled or the subscription was revoked. The row is
      // the only thing that would keep it alive, so remove it.
      pruned += 1;
      await admin.from('admin_push_subscriptions').delete().eq('id', row.id);
      return;
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
      return;
    }
    await admin
      .from('admin_push_subscriptions')
      .update({ last_failure_at: new Date(at).toISOString(), failure_count: nextCount })
      .eq('id', row.id);
  }

  for (let i = 0; i < subscriptions.length; i += SEND_CONCURRENCY) {
    await Promise.all(subscriptions.slice(i, i + SEND_CONCURRENCY).map(deliver));
  }

  return json({ status: 'ok', scope, subscriptions: subscriptions.length, sent, failed, pruned }, 200);
});
