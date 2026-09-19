/**
 * Turning a VAPID key into the bytes `pushManager.subscribe` wants, and a
 * PushSubscription into the three fields the server stores.
 *
 * Both are small, both are fiddly, and both fail in ways that are invisible
 * until a push does not arrive — so they live here, pure and tested, rather than
 * inline in a component.
 */

export interface SerializedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * VAPID public keys are distributed base64URL and unpadded; `atob` wants
 * standard base64 with padding. Getting this wrong yields a key that looks fine
 * and produces a subscription no push can ever be delivered to.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const trimmed = (base64String || '').trim();
  if (!trimmed) throw new Error('empty VAPID key');

  const padding = '='.repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, '+').replace(/_/g, '/');

  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error('VAPID key is not valid base64url');
  }

  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Shape we accept — deliberately narrower than the DOM type so this is testable. */
export interface SubscriptionLike {
  toJSON?: () => { endpoint?: string | null; keys?: { p256dh?: string | null; auth?: string | null } | null };
  endpoint?: string | null;
}

/**
 * Returns null rather than a partial record. A subscription missing either key
 * cannot be pushed to, so storing it would create a row that fails forever and
 * counts against the admin as a "subscribed" device that never notifies.
 */
export function serializeSubscription(
  sub: SubscriptionLike | null | undefined,
): SerializedSubscription | null {
  if (!sub) return null;

  let json: ReturnType<NonNullable<SubscriptionLike['toJSON']>> | undefined;
  try {
    json = sub.toJSON?.();
  } catch {
    json = undefined;
  }

  const endpoint = json?.endpoint ?? sub.endpoint ?? null;
  const p256dh = json?.keys?.p256dh ?? null;
  const auth = json?.keys?.auth ?? null;

  if (typeof endpoint !== 'string' || !endpoint) return null;
  if (typeof p256dh !== 'string' || !p256dh) return null;
  if (typeof auth !== 'string' || !auth) return null;

  return { endpoint, p256dh, auth };
}
