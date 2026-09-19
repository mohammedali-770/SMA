/**
 * The decisions the admin push sender makes, separated from the Deno glue that
 * performs them.
 *
 * `admin-push-dispatch/index.ts` imports Deno-only modules, so CI can never
 * execute it. Everything here is pure, runs under vitest, and is where the
 * rules that matter actually live: who a send may reach, what the service
 * worker receives, and what a push service's response means.
 */

import { MAX_PLAINTEXT_BYTES, isGoneStatus } from './webPush.ts';

/** How a caller proved who they are. Decided in the handler, used here. */
export type CallerKind = 'service_role' | 'admin';

/**
 * Which subscriptions a caller may reach.
 *
 * AN ADMIN CAN ONLY EVER PUSH TO THEIR OWN DEVICES, and that is not a
 * configuration choice — it is why a "send a test notification" button in the
 * console is safe to have at all. Without it, any administrator at AAL2 could
 * put arbitrary text on every other administrator's lock screen, which is the
 * same class of capability as `push-dispatch`'s broadcast and deserves the same
 * suspicion. The automated closure notices come from the database through the
 * service role, which is the only path that fans out.
 */
export function scopeFor(caller: CallerKind): 'all' | 'self' {
  return caller === 'service_role' ? 'all' : 'self';
}

/**
 * A closure notice is only interesting while it is current. An hour is long
 * enough to survive a phone being face-down through a meeting and short enough
 * that a device switched on tomorrow is not told about a size that reopened
 * last night.
 */
export const DEFAULT_TTL_SECONDS = 3600;

export interface NotificationRequest {
  /** Arabic copy — the default the owner chose, and the fallback for everyone. */
  title: string;
  body: string;
  /** Optional English copy, used for a subscription registered with `lang = 'en'`. */
  titleEn: string | null;
  bodyEn: string | null;
  /** A same-origin console path. Validated again inside the service worker. */
  url: string | null;
  /** Collapses an earlier notification about the same subject, if set. */
  tag: string | null;
  ttlSeconds: number;
}

export type ParseResult = { ok: true; request: NotificationRequest } | { ok: false; reason: string };

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Validate a send request.
 *
 * REFUSING IS THE CORRECT OUTCOME FOR BAD INPUT HERE, not substituting a
 * default. A notification with an empty title reaches a staff phone looking
 * like a bug in the app; a request that never sent produces an error the caller
 * can see. The one exception is `ttl`, where a missing value has an obvious
 * right answer.
 */
export function parseNotificationRequest(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'body must be a JSON object' };
  }
  const source = raw as Record<string, unknown>;
  const title = readString(source, 'title');
  const body = readString(source, 'body');
  if (!title) return { ok: false, reason: 'title is required' };
  if (!body) return { ok: false, reason: 'body is required' };

  const ttlRaw = source.ttl;
  if (ttlRaw !== undefined && (typeof ttlRaw !== 'number' || !Number.isFinite(ttlRaw))) {
    return { ok: false, reason: 'ttl must be a number of seconds' };
  }

  const request: NotificationRequest = {
    title,
    body,
    titleEn: readString(source, 'titleEn'),
    bodyEn: readString(source, 'bodyEn'),
    url: readString(source, 'url'),
    tag: readString(source, 'tag'),
    ttlSeconds: ttlRaw === undefined ? DEFAULT_TTL_SECONDS : Math.trunc(ttlRaw),
  };

  // Measured against the encrypted-payload ceiling rather than a guess, so a
  // request that would fail at encryption time is refused with a sentence that
  // says why. Arabic is multi-byte, so the character count is not the size.
  const encoded = new TextEncoder().encode(JSON.stringify(buildPayload(request, 'ar', 0))).length;
  if (encoded > MAX_PLAINTEXT_BYTES) {
    return { ok: false, reason: `payload is ${encoded} bytes, over ${MAX_PLAINTEXT_BYTES}` };
  }
  return { ok: true, request };
}

/**
 * The JSON `public/sw.js` parses. Every key here is read by that file, and no
 * key it reads is missing.
 *
 * `dir` follows the language rather than being fixed, because the console has
 * an English mode and an RTL layout around Latin text is the kind of detail
 * that makes a notification look broken.
 */
export function buildPayload(
  request: NotificationRequest,
  lang: string,
  atMilliseconds: number,
): Record<string, unknown> {
  const english = lang === 'en' && request.titleEn !== null && request.bodyEn !== null;
  const payload: Record<string, unknown> = {
    title: english ? request.titleEn : request.title,
    body: english ? request.bodyEn : request.body,
    lang: english ? 'en' : 'ar',
    dir: english ? 'ltr' : 'rtl',
    at: atMilliseconds,
  };
  if (request.url !== null) payload.url = request.url;
  if (request.tag !== null) payload.tag = request.tag;
  return payload;
}

export type DeliveryOutcome = 'sent' | 'gone' | 'failed';

/**
 * What a push service's response means for the subscription row.
 *
 * `gone` is the only outcome that deletes anything, and `isGoneStatus` keeps it
 * to 404 and 410 — see the reasoning there. A 401 (our VAPID token) or 403 (our
 * key does not match this subscription) is a misconfiguration that would
 * otherwise delete every admin's registration on its first send.
 */
export function classifyDelivery(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return 'sent';
  if (isGoneStatus(status)) return 'gone';
  return 'failed';
}

/**
 * Failures before a subscription is considered dead.
 *
 * A push service that is having a bad afternoon returns 5xx; a browser that was
 * uninstalled returns 410 and is removed immediately by `classifyDelivery`.
 * This covers the third case — an endpoint that neither succeeds nor admits it
 * is gone — and is deliberately generous, because a wrongly deleted
 * subscription is silent and only the admin can restore it.
 */
export const MAX_CONSECUTIVE_FAILURES = 20;

export function shouldPruneAfterFailure(failureCount: number): boolean {
  return failureCount >= MAX_CONSECUTIVE_FAILURES;
}
