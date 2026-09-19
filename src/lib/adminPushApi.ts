/**
 * Admin web-push subscriptions — the console's side of
 * `public.admin_push_subscriptions` (migration 20260927120000).
 *
 * THIS IS NOT THE CUSTOMER PUSH CHANNEL AND MUST NEVER BECOME IT. Customer
 * order notifications go through Expo and `push_devices`, keyed by
 * `customer_id`. This module touches a different table through different RPCs,
 * and that separation is what guarantees a bug here cannot put a branch closure
 * on a customer's lock screen. If a future change makes this file reach for
 * `push_devices`, the guarantee is gone.
 *
 * There is deliberately NO client grant on `admin_push_subscriptions` — RLS is
 * enabled with zero policies — so this module cannot bypass the three
 * `is_admin()`-gated RPCs even by accident.
 */
import { supabase } from './supabase';

export interface AdminPushServerState {
  /** A VAPID public key is configured, so subscribing is possible at all. */
  configured: boolean;
  vapidPublicKey: string | null;
  /** The endpoint passed in belongs to the calling admin. */
  subscribed: boolean;
  /** How many devices this admin has subscribed, across all browsers. */
  deviceCount: number;
}

const UNCONFIGURED: AdminPushServerState = {
  configured: false,
  vapidPublicKey: null,
  subscribed: false,
  deviceCount: 0,
};

/**
 * Reads the caller's push state. FAILS SOFT to "not configured".
 *
 * Deliberate: this runs on every console load, and the header must render even
 * when the migration has not been applied yet (the RPC does not exist → an
 * error). Throwing here would take the console down for a notifications
 * feature, which is the wrong trade — the same reasoning as the availability
 * reads in `opsApi`.
 */
export async function fetchAdminPushState(endpoint: string | null): Promise<AdminPushServerState> {
  const { data, error } = await supabase.rpc('admin_push_state', {
    p_endpoint: endpoint,
  });
  if (error || !data) return UNCONFIGURED;

  const row = data as {
    configured?: boolean;
    vapid_public_key?: string | null;
    subscribed?: boolean;
    device_count?: number;
  };
  return {
    configured: Boolean(row.configured),
    vapidPublicKey: row.vapid_public_key ?? null,
    subscribed: Boolean(row.subscribed),
    deviceCount: Number(row.device_count ?? 0),
  };
}

/**
 * Stores a subscription. Unlike the read, this THROWS on failure: the admin
 * pressed a button and is owed a truthful answer about whether it worked.
 */
export async function saveAdminPushSubscription(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: 'en' | 'ar';
  userAgent?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('save_admin_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
    p_lang: sub.lang,
    p_user_agent: sub.userAgent ?? null,
  });
  if (error) throw error;
}

export async function deleteAdminPushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.rpc('delete_admin_push_subscription', {
    p_endpoint: endpoint,
  });
  if (error) throw error;
}
