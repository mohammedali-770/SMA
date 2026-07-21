import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';

/**
 * push-dispatch — Expo Push sender (COMPLETE implementation; replaces the old
 * 501 placeholder).
 *
 * Actions (POST, JSON body { action, ... }):
 *   order_status  { orderId, status }
 *       Caller: service role (internal — order-intake / lazywait-webhook) OR
 *       an authenticated ADMIN (dashboard status changes). The order's owner
 *       is looked up server-side; the push targets ONLY that customer's
 *       active devices with order_updates_enabled. IDEMPOTENT: the
 *       notification_log unique(order_id,status) insert happens FIRST — a
 *       second call for the same transition is a no-op.
 *   test          {}
 *       Caller: authenticated ADMIN. Sends a test notification to the
 *       calling admin's OWN registered devices (sign into the mobile app
 *       with the same account first).
 *   broadcast     { titleEn, titleAr, bodyEn, bodyAr }
 *       Caller: authenticated ADMIN. Immediate promotional broadcast to
 *       OPTED-IN devices only (is_active AND promos_enabled). Returns
 *       delivery counts. No scheduling / segmentation / topics / sounds.
 *
 * MASTER FLAG: integration_settings (provider_type='push') must be ENABLED
 * with provider 'expo' — otherwise every action no-ops with
 * {status:'disabled'}. Seeded DISABLED; nothing can send until the admin
 * turns it on AND EAS push credentials exist (see functions/README.md).
 *
 * PAYLOAD SAFETY: notification data carries ONLY { type, orderId } — never
 * customer, order-content, amount, or payment data; titles/bodies are fixed
 * localized status strings. Tap navigation in the app resolves through an
 * allow-list (notificationPolicy.resolveNotificationRoute).
 *
 * Expo Push API: chunks of 100; a ticket-level DeviceNotRegistered
 * immediately deactivates that device row. (Receipt polling is a documented
 * follow-up — ticket-level handling covers the dominant failure mode.)
 *
 * verify_jwt = false (service-role callers carry no user JWT; admin actions
 * re-verify the caller's JWT + role explicitly below).
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;
// Bounded retry: a TOTAL send failure may be reclaimed until this many
// attempts have been made; after that the failure is TERMINAL (exhausted).
const MAX_SEND_ATTEMPTS = 5;
// A 'processing' claim is a LEASE, not a permanent lock: if the function
// crashed/timed out mid-send, the row would otherwise stay 'processing'
// forever and the notification would never retry. The lease MUST exceed the
// platform's maximum invocation wall-clock (Supabase Edge Functions: 400s) —
// a shorter lease could "reclaim" a claim whose owner is still alive waiting
// on Expo I/O and double-send (review finding). 10 min > 400s, so an expired
// lease is provably a dead owner.
const PROCESSING_LEASE_MS = 10 * 60_000;

type OrderStatus = 'received' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

// Fixed, localized, data-free copy per status (EN/AR chosen per device.lang).
const STATUS_COPY: Record<OrderStatus, { en: { title: string; body: string }; ar: { title: string; body: string } }> = {
  received: {
    en: { title: 'Order received 🧾', body: 'We received your order and sent it to the kitchen.' },
    ar: { title: 'تم استلام طلبك 🧾', body: 'استلمنا طلبك وتم إرساله إلى المطبخ.' },
  },
  preparing: {
    en: { title: 'Preparing your order 🔥', body: 'Your order is being prepared now.' },
    ar: { title: 'جارٍ تحضير طلبك 🔥', body: 'يتم تحضير طلبك الآن.' },
  },
  ready: {
    en: { title: 'Order ready ✅', body: 'Your order is ready for pickup.' },
    ar: { title: 'طلبك جاهز ✅', body: 'طلبك جاهز للاستلام.' },
  },
  out_for_delivery: {
    en: { title: 'On the way 🛵', body: 'Your order is out for delivery.' },
    ar: { title: 'في الطريق 🛵', body: 'طلبك في الطريق إليك.' },
  },
  delivered: {
    en: { title: 'Delivered 🎉', body: 'Enjoy your meal! Thanks for ordering Spicy Meal.' },
    ar: { title: 'تم التوصيل 🎉', body: 'بالهناء والشفاء! شكراً لطلبك من سبايسي ميل.' },
  },
  cancelled: {
    en: { title: 'Order cancelled', body: 'Your order was cancelled. Contact support if this is unexpected.' },
    ar: { title: 'تم إلغاء الطلب', body: 'تم إلغاء طلبك. تواصل مع الدعم إذا كان ذلك غير متوقع.' },
  },
};

// POS confirmation-lifecycle copy (EN/AR). Body strings are the EXACT approved
// customer messages. Data-free like STATUS_COPY. These correspond to the four
// deduplicated pos_sync transitions the sync worker/reaper enqueue.
type PosSyncStatus = 'pos_retrying' | 'pos_confirmed' | 'pos_confirmation_required' | 'pos_failed';
const POS_SYNC_COPY: Record<PosSyncStatus, { en: { title: string; body: string }; ar: { title: string; body: string } }> = {
  pos_confirmed: {
    en: { title: 'Order confirmed ✅', body: 'Your order has been confirmed by the restaurant' },
    ar: { title: 'تم تأكيد الطلب ✅', body: 'تم تأكيد وصول طلبك إلى المطعم' },
  },
  pos_retrying: {
    en: {
      title: 'Confirming your order…',
      body: 'We received your order, but could not yet confirm that it reached the restaurant. We are retrying automatically. Please do not place another order.',
    },
    ar: {
      title: 'جارٍ تأكيد طلبك…',
      body: 'استلمنا طلبك، لكن لم نتمكن من تأكيد وصوله إلى المطعم حتى الآن.\nنعيد المحاولة تلقائيًا. فضلاً لا تنشئ طلبًا جديدًا.',
    },
  },
  pos_confirmation_required: {
    en: {
      title: 'Verifying your order',
      body: 'We could not verify whether your order reached the restaurant. Our team is reviewing it. Please do not place another order.',
    },
    ar: {
      title: 'جارٍ التحقق من طلبك',
      body: 'تعذر علينا التحقق من وصول طلبك إلى المطعم.\nفريقنا يراجع الطلب. فضلاً لا تنشئ طلبًا جديدًا.',
    },
  },
  pos_failed: {
    en: {
      title: 'Order not confirmed',
      body: 'We could not send your order to the restaurant, and the order was not confirmed. Our team will follow up.',
    },
    ar: {
      title: 'لم يتم تأكيد الطلب',
      body: 'تعذر إرسال طلبك إلى المطعم، ولم يتم تأكيد الطلب.\nفريقنا سيتابع الحالة.',
    },
  },
};

interface DeviceRow {
  id: string;
  expo_push_token: string;
  lang: 'en' | 'ar';
}

interface SendResult { targeted: number; sent: number; failed: number; deactivated: number }

/** Send one localized message to a set of devices via Expo Push (chunked). */
async function sendToDevices(
  admin: ReturnType<typeof adminClient>,
  devices: DeviceRow[],
  copy: { en: { title: string; body: string }; ar: { title: string; body: string } },
  data: Record<string, string>,
): Promise<SendResult> {
  const result: SendResult = { targeted: devices.length, sent: 0, failed: 0, deactivated: 0 };
  const deadTokens: string[] = [];

  for (let i = 0; i < devices.length; i += CHUNK) {
    const chunk = devices.slice(i, i + CHUNK);
    const messages = chunk.map((d) => ({
      to: d.expo_push_token,
      title: (d.lang === 'ar' ? copy.ar : copy.en).title,
      body: (d.lang === 'ar' ? copy.ar : copy.en).body,
      data,
      sound: 'default',
      channelId: 'default',
    }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      const payload = await res.json().catch(() => null) as
        { data?: { status: string; details?: { error?: string } }[] } | null;
      const tickets = payload?.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket?.status === 'ok') {
          result.sent += 1;
        } else {
          result.failed += 1;
          if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(chunk[idx].expo_push_token);
        }
      });
      // A malformed/failed batch response counts every message as failed.
      if (tickets.length === 0) result.failed += chunk.length;
    } catch {
      result.failed += chunk.length;
    }
  }

  if (deadTokens.length > 0) {
    const { error } = await admin.from('push_devices')
      .update({ is_active: false })
      .in('expo_push_token', deadTokens);
    if (!error) result.deactivated = deadTokens.length;
  }
  return result;
}

function isServiceRoleCall(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  return Boolean(key) && auth === `Bearer ${key}`;
}

async function callingAdminId(req: Request, admin: ReturnType<typeof adminClient>): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const { data: { user } } = await userClient(authHeader).auth.getUser();
  if (!user) return null;
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return profile?.role === 'admin' ? user.id : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();

  // MASTER FLAG — seeded disabled; every action no-ops until an admin enables
  // the push integration with provider 'expo'.
  const cfg = await getProviderConfig(admin, 'push');
  if (!cfg || !cfg.enabled) return json({ status: 'disabled', reason: 'push integration disabled' }, 200);
  const provider = String((cfg.publicConfig.provider as string | undefined) ?? cfg.providerName ?? '');
  if (provider !== 'expo') {
    return json({ status: 'disabled', reason: 'unsupported push provider (expected expo)' }, 200);
  }

  let body: {
    action?: string; orderId?: string; status?: string;
    titleEn?: string; titleAr?: string; bodyEn?: string; bodyAr?: string;
  };
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }

  // ---------------------------------------------------------------- order_status
  if (body.action === 'order_status') {
    const fromService = isServiceRoleCall(req);
    const adminId = fromService ? null : await callingAdminId(req, admin);
    if (!fromService && !adminId) return json({ error: 'forbidden' }, 403);

    const status = String(body.status ?? '') as OrderStatus;
    if (!(status in STATUS_COPY)) return json({ error: 'unknown status' }, 400);
    const orderId = String(body.orderId ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ error: 'invalid orderId' }, 400);
    }

    // Anti-spoof: the order must exist and actually BE in this status — a push
    // can only ever announce a status change that really happened server-side.
    const { data: order } = await admin.from('orders')
      .select('id, customer_id, status').eq('id', orderId).maybeSingle();
    if (!order) return json({ error: 'order not found' }, 404);
    if (order.status !== status) return json({ status: 'skipped', reason: 'status mismatch' }, 200);

    // CLAIM FIRST (unique(order_id,status) + send_status lifecycle):
    //  - fresh transition → INSERT 'processing' wins the claim;
    //  - conflict → inspect the existing row:
    //      sent/no_targets → terminal, idempotent no-op;
    //      processing      → another call is in flight, back off (no double send);
    //      failed          → atomically reclaim (…SET 'processing' WHERE
    //                        send_status='failed') for a controlled retry —
    //                        only TOTAL failures are retryable, so no device
    //                        can ever receive the same status twice.
    // The attempt number this invocation claims is a FENCING TOKEN: every
    // completion write below is guarded by it, so even if a zombie owner
    // outlives its lease its late write matches zero rows (review finding).
    let myAttempt = 1; // fresh insert → attempt_count default 1
    const { error: claimError } = await admin.from('notification_log')
      .insert({ kind: 'order_status', order_id: orderId, status, send_status: 'processing' });
    if (claimError) {
      const { data: existing } = await admin.from('notification_log')
        .select('id, send_status, attempt_count, updated_at')
        .eq('kind', 'order_status').eq('order_id', orderId).eq('status', status)
        .maybeSingle();
      if (!existing) return json({ status: 'retry', reason: 'claim race, call again' }, 200);
      if (existing.send_status === 'sent' || existing.send_status === 'no_targets') {
        return json({ status: 'duplicate', reason: `already ${existing.send_status}` }, 200);
      }
      if (existing.send_status === 'processing') {
        // LIVE lease → back off. EXPIRED lease (crashed/timed-out run) →
        // atomically reclaim, still bounded by the attempt budget.
        const leaseAge = Date.now() - new Date(existing.updated_at as string).getTime();
        if (!(leaseAge > PROCESSING_LEASE_MS)) {
          return json({ status: 'in_progress', reason: 'another dispatch call owns this send' }, 200);
        }
        if ((existing.attempt_count ?? 1) >= MAX_SEND_ATTEMPTS) {
          return json({ status: 'exhausted', reason: `retry attempts exhausted (${MAX_SEND_ATTEMPTS})` }, 200);
        }
        const { data: released } = await admin.from('notification_log')
          .update({ send_status: 'processing', attempt_count: (existing.attempt_count ?? 1) + 1, last_error_safe: 'stale processing lease reclaimed' })
          .eq('id', existing.id).eq('send_status', 'processing')
          .eq('attempt_count', existing.attempt_count ?? 1)
          .lt('updated_at', new Date(Date.now() - PROCESSING_LEASE_MS).toISOString())
          .select('id')
          .maybeSingle();
        if (!released) return json({ status: 'in_progress', reason: 'stale lease already reclaimed elsewhere' }, 200);
        myAttempt = (existing.attempt_count ?? 1) + 1;
      } else {
        // failed → BOUNDED reclaim: exhausted failures are terminal (review
        // finding — reclaiming must not retry forever against a dead provider).
        if ((existing.attempt_count ?? 1) >= MAX_SEND_ATTEMPTS) {
          return json({ status: 'exhausted', reason: `retry attempts exhausted (${MAX_SEND_ATTEMPTS})` }, 200);
        }
        // Atomic reclaim: the send_status + attempt_count guards make exactly
        // one racer win; the loser matches zero rows and backs off.
        const { data: reclaimed } = await admin.from('notification_log')
          .update({ send_status: 'processing', attempt_count: (existing.attempt_count ?? 1) + 1 })
          .eq('id', existing.id).eq('send_status', 'failed')
          .eq('attempt_count', existing.attempt_count ?? 1)
          .lt('attempt_count', MAX_SEND_ATTEMPTS)
          .select('id')
          .maybeSingle();
        if (!reclaimed) return json({ status: 'in_progress', reason: 'retry already claimed elsewhere' }, 200);
        myAttempt = (existing.attempt_count ?? 1) + 1;
      }
    }

    const { data: devices, error: devicesError } = await admin.from('push_devices')
      .select('id, expo_push_token, lang')
      .eq('customer_id', order.customer_id)
      .eq('is_active', true)
      .eq('order_updates_enabled', true);
    if (devicesError) {
      // A FAILED device lookup is NOT an empty audience (review finding):
      // release the claim as 'failed' (retryable via the bounded reclaim
      // path) instead of terminally recording no_targets — nobody was
      // targeted, so a later retry can still deliver the notification.
      await admin.from('notification_log')
        .update({ send_status: 'failed', last_error_safe: 'device lookup failed (transient)' })
        .eq('kind', 'order_status').eq('order_id', orderId).eq('status', status)
        .eq('send_status', 'processing').eq('attempt_count', myAttempt);
      return json({ status: 'error', send_status: 'failed', reason: 'device lookup failed (transient)' }, 500);
    }

    const targets = (devices ?? []) as DeviceRow[];
    if (targets.length === 0) {
      await admin.from('notification_log')
        .update({ send_status: 'no_targets', targeted: 0, sent: 0, failed: 0, deactivated: 0 })
        .eq('kind', 'order_status').eq('order_id', orderId).eq('status', status)
        .eq('send_status', 'processing').eq('attempt_count', myAttempt);
      return json({ status: 'ok', send_status: 'no_targets', targeted: 0, sent: 0, failed: 0, deactivated: 0 }, 200);
    }

    const result = await sendToDevices(admin, targets, STATUS_COPY[status], { type: 'order', orderId });
    // Outcome: any successful delivery → terminal 'sent' (partial failures
    // recorded but NOT retryable — already-delivered devices stay protected);
    // zero deliveries → 'failed' (safe to retry: nobody received anything).
    const sendStatus = result.sent > 0 ? 'sent' : 'failed';
    const lastError =
      sendStatus === 'failed' ? 'total send failure (transient?)'
      : result.failed > 0 ? `partial: ${result.failed}/${result.targeted} failed (not retryable)`
      : null;
    await admin.from('notification_log')
      .update({ send_status: sendStatus, last_error_safe: lastError, ...result })
      .eq('kind', 'order_status').eq('order_id', orderId).eq('status', status)
      .eq('send_status', 'processing').eq('attempt_count', myAttempt);
    return json({ status: 'ok', send_status: sendStatus, ...result }, 200);
  }

  // ------------------------------------------------------------------------ test
  if (body.action === 'test') {
    const adminId = await callingAdminId(req, admin);
    if (!adminId) return json({ error: 'forbidden' }, 403);

    const { data: devices, error: devicesError } = await admin.from('push_devices')
      .select('id, expo_push_token, lang')
      .eq('customer_id', adminId)
      .eq('is_active', true);
    if (devicesError) return json({ status: 'error', reason: 'device lookup failed (transient)' }, 500);
    if (!devices || devices.length === 0) {
      return json({
        status: 'no_devices',
        hint: 'Sign into the mobile app with this admin account and enable notifications first.',
      }, 200);
    }
    const result = await sendToDevices(admin, devices as DeviceRow[], {
      en: { title: 'Test notification ✅', body: 'Push notifications are configured correctly.' },
      ar: { title: 'إشعار تجريبي ✅', body: 'تم إعداد الإشعارات بشكل صحيح.' },
    }, { type: 'promo' });
    await admin.from('notification_log').insert({ kind: 'test', ...result });
    return json({ status: 'ok', ...result }, 200);
  }

  // ------------------------------------------------------------------- broadcast
  if (body.action === 'broadcast') {
    const adminId = await callingAdminId(req, admin);
    if (!adminId) return json({ error: 'forbidden' }, 403);

    const titleEn = String(body.titleEn ?? '').trim();
    const titleAr = String(body.titleAr ?? '').trim();
    const bodyEn = String(body.bodyEn ?? '').trim();
    const bodyAr = String(body.bodyAr ?? '').trim();
    if (!titleEn || !titleAr || !bodyEn || !bodyAr) {
      return json({ error: 'titleEn/titleAr/bodyEn/bodyAr are all required' }, 400);
    }

    // OPT-IN ONLY: active devices whose owner opted into promotions.
    const { data: devices, error: devicesError } = await admin.from('push_devices')
      .select('id, expo_push_token, lang')
      .eq('is_active', true)
      .eq('promos_enabled', true);
    if (devicesError) return json({ status: 'error', reason: 'device lookup failed (transient)' }, 500);

    const result = await sendToDevices(admin, (devices ?? []) as DeviceRow[], {
      en: { title: titleEn, body: bodyEn },
      ar: { title: titleAr, body: bodyAr },
    }, { type: 'promo' });
    await admin.from('notification_log').insert({ kind: 'broadcast', ...result });
    return json({ status: 'ok', ...result }, 200);
  }

  // ---------------------------------------------------------------- pos_sync
  // Customer-facing POS confirmation-lifecycle push. The sync worker/reaper have
  // already enqueued a deduplicated notification_log row (kind='pos_sync',
  // unique(order_id,status), send_status='pending'); this action renders + sends
  // it. Caller: service role (internal) or an authenticated admin. AT-MOST-ONCE
  // under concurrency: a token-fenced atomic claim (pending -> processing) lets
  // exactly one dispatcher send; 'processing' is never reclaimed and terminal
  // rows are no-ops, so a status reaches a device at most once even if two
  // dispatchers race. (Push stays master-flag disabled, so this path is dormant
  // in prod.)
  if (body.action === 'pos_sync') {
    const fromService = isServiceRoleCall(req);
    const adminId = fromService ? null : await callingAdminId(req, admin);
    if (!fromService && !adminId) return json({ error: 'forbidden' }, 403);

    const status = String(body.status ?? '') as PosSyncStatus;
    if (!(status in POS_SYNC_COPY)) return json({ error: 'unknown status' }, 400);
    const orderId = String(body.orderId ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ error: 'invalid orderId' }, 400);
    }

    const { data: order } = await admin.from('orders')
      .select('id, customer_id').eq('id', orderId).maybeSingle();
    if (!order) return json({ error: 'order not found' }, 404);

    // FENCED CLAIM (Finding 3): an atomic RPC flips the deduped 'pending' event
    // row to 'processing' with a per-dispatch lease token. Exactly ONE concurrent
    // caller wins ('claimed'); a 'processing' row is NOT reclaimable by anyone
    // else ('in_progress'), and terminal rows ('sent'/'no_targets'/'failed') are
    // idempotent no-ops ('duplicate'). Every later write is fenced by this token,
    // so at most one dispatcher ever reaches sendToDevices for a given event.
    const claimToken = crypto.randomUUID();
    const { data: claim, error: claimError } = await admin.rpc('claim_pos_sync_notification', {
      p_order_id: orderId, p_status: status, p_claim_token: claimToken,
    });
    if (claimError) return json({ status: 'error', reason: 'claim failed (transient)' }, 500);
    const claimResult = String(claim ?? '');
    // The dispatcher is a pure CONSUMER: it never creates events. If no lifecycle
    // producer (record_lazywait_sync / reaper) enqueued this transition, there is
    // nothing to send. A 'superseded' event no longer matches the order state.
    if (claimResult === 'no_event') return json({ status: 'no_event', reason: 'no pending pos_sync event to dispatch' }, 200);
    if (claimResult === 'superseded') return json({ status: 'superseded', reason: 'event no longer matches order state' }, 200);
    if (claimResult === 'duplicate') return json({ status: 'duplicate', reason: 'already delivered' }, 200);
    if (claimResult === 'in_progress') return json({ status: 'in_progress', reason: 'another dispatcher owns this send' }, 200);
    if (claimResult !== 'claimed') return json({ status: 'error', reason: `unexpected claim result: ${claimResult}` }, 500);

    const { data: devices, error: devicesError } = await admin.from('push_devices')
      .select('id, expo_push_token, lang')
      .eq('customer_id', order.customer_id)
      .eq('is_active', true)
      .eq('order_updates_enabled', true);
    if (devicesError) {
      // PROVEN pre-send failure (nobody was targeted): release the claim back to
      // 'pending' so a later dispatch can safely retry — this cannot double-send.
      await admin.rpc('release_pos_sync_notification', {
        p_order_id: orderId, p_status: status, p_claim_token: claimToken,
      });
      return json({ status: 'error', send_status: 'pending', reason: 'device lookup failed (transient)' }, 500);
    }

    const targets = (devices ?? []) as DeviceRow[];
    if (targets.length === 0) {
      // Terminal: finalize as no_targets under our token (owner-fenced).
      await admin.rpc('finalize_pos_sync_notification', {
        p_order_id: orderId, p_status: status, p_claim_token: claimToken,
        p_send_status: 'no_targets', p_targeted: 0, p_sent: 0, p_failed: 0, p_deactivated: 0,
      });
      return json({ status: 'ok', send_status: 'no_targets', targeted: 0, sent: 0, failed: 0, deactivated: 0 }, 200);
    }

    // FINAL token-fenced pre-send re-validation, immediately adjacent to the send.
    // The order can transition between the claim above and this point (e.g. the
    // sync worker succeeds, moving 'failed' -> 'synced' after a 'pos_retrying' was
    // claimed). The copy (POS_SYNC_COPY[status], a constant) and the device list
    // are ALREADY prepared, and NOTHING async happens between this check and the
    // send. A DB transaction cannot be held across the external Expo call, so the
    // only residual gap is the single synchronous step between this RPC committing
    // and fetch() starting — no awaited work sits in it. Only 'ready_to_send'
    // proceeds; a superseded event was atomically marked terminal by the RPC.
    const { data: preSend, error: preErr } = await admin.rpc('validate_pos_sync_notification_before_send', {
      p_order_id: orderId, p_status: status, p_claim_token: claimToken,
    });
    if (preErr) {
      // Transient validation failure BEFORE any send: release the claim back to
      // 'pending' (owner-fenced) so a later dispatch can safely retry — nothing
      // was delivered, so this cannot double-send. If the RPC actually committed
      // (e.g. a 'superseded' mark) and only the reply was lost, the release
      // matches zero rows and is a harmless no-op. Without this the 'processing'
      // row would strand (no notification_log reaper; the unique index blocks a
      // fresh 'pending' re-enqueue), silently losing a deliverable notification.
      await admin.rpc('release_pos_sync_notification', {
        p_order_id: orderId, p_status: status, p_claim_token: claimToken,
      });
      return json({ status: 'error', send_status: 'pending', reason: 'pre-send validation failed (transient)' }, 500);
    }
    const preResult = String(preSend ?? '');
    if (preResult === 'superseded') {
      return json({ status: 'superseded', reason: 'order state changed before send; not sent' }, 200);
    }
    if (preResult !== 'ready_to_send') {
      // 'lost_claim' / 'not_found' / anything unexpected -> we no longer own the
      // send (or the event is gone). Never send, never touch a foreign claim.
      return json({ status: 'no_send', reason: `pre-send validation: ${preResult}` }, 200);
    }

    const result = await sendToDevices(admin, targets, POS_SYNC_COPY[status], { type: 'order', orderId });
    // The requests have LEFT for at least some devices. Whether or not any ticket
    // succeeded, this is a post-send result and must be TERMINAL — never
    // auto-resent (an ambiguous post-send state could otherwise double-deliver).
    // 'sent' when any delivered, else 'failed' (terminal, NOT reclaimable).
    const sendStatus = result.sent > 0 ? 'sent' : 'failed';
    await admin.rpc('finalize_pos_sync_notification', {
      p_order_id: orderId, p_status: status, p_claim_token: claimToken,
      p_send_status: sendStatus,
      p_targeted: result.targeted, p_sent: result.sent, p_failed: result.failed, p_deactivated: result.deactivated,
    });
    return json({ status: 'ok', send_status: sendStatus, ...result }, 200);
  }

  return json({ error: 'unknown action' }, 400);
});
