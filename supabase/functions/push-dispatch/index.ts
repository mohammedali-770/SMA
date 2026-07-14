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

    // IDEMPOTENCY FIRST: unique(order_id,status) — a duplicate call stops here.
    const { error: logError } = await admin.from('notification_log')
      .insert({ kind: 'order_status', order_id: orderId, status });
    if (logError) return json({ status: 'duplicate', reason: 'already sent for this status' }, 200);

    const { data: devices } = await admin.from('push_devices')
      .select('id, expo_push_token, lang')
      .eq('customer_id', order.customer_id)
      .eq('is_active', true)
      .eq('order_updates_enabled', true);

    const result = await sendToDevices(admin, (devices ?? []) as DeviceRow[], STATUS_COPY[status],
      { type: 'order', orderId });
    await admin.from('notification_log').update(result)
      .eq('order_id', orderId).eq('status', status).eq('kind', 'order_status');
    return json({ status: 'ok', ...result }, 200);
  }

  // ------------------------------------------------------------------------ test
  if (body.action === 'test') {
    const adminId = await callingAdminId(req, admin);
    if (!adminId) return json({ error: 'forbidden' }, 403);

    const { data: devices } = await admin.from('push_devices')
      .select('id, expo_push_token, lang')
      .eq('customer_id', adminId)
      .eq('is_active', true);
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
    const { data: devices } = await admin.from('push_devices')
      .select('id, expo_push_token, lang')
      .eq('is_active', true)
      .eq('promos_enabled', true);

    const result = await sendToDevices(admin, (devices ?? []) as DeviceRow[], {
      en: { title: titleEn, body: bodyEn },
      ar: { title: titleAr, body: bodyAr },
    }, { type: 'promo' });
    await admin.from('notification_log').insert({ kind: 'broadcast', ...result });
    return json({ status: 'ok', ...result }, 200);
  }

  return json({ error: 'unknown action' }, 400);
});
