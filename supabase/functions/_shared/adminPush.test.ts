import { describe, expect, it } from 'vitest';

import { MAX_PLAINTEXT_BYTES } from './webPush';
import {
  DEFAULT_TTL_SECONDS,
  MAX_CONSECUTIVE_FAILURES,
  buildPayload,
  classifyDelivery,
  parseNotificationRequest,
  parseTargetEndpoint,
  refusePushEndpoint,
  scopeFor,
  shouldPruneAfterFailure,
} from './adminPush';

function parsed(raw: unknown) {
  const result = parseNotificationRequest(raw);
  if (!result.ok) throw new Error(`expected a valid request, got: ${result.reason}`);
  return result.request;
}

describe('scopeFor', () => {
  /*
   * THE SAFETY PROPERTY OF THE WHOLE FUNCTION. The console's test button sends
   * as an authenticated admin; if that reached every subscription, any
   * administrator at AAL2 could put arbitrary text on every other
   * administrator's lock screen. Only the database, through the service role,
   * fans out.
   */
  it('lets an admin reach only their own devices', () => {
    expect(scopeFor('admin')).toBe('self');
  });

  it('lets the service role fan out', () => {
    expect(scopeFor('service_role')).toBe('all');
  });
});

describe('parseNotificationRequest', () => {
  it.each([
    ['null', null],
    ['a string', 'title'],
    ['a number', 7],
    ['an array', [{ title: 'a', body: 'b' }]],
  ])('refuses %s as a body', (_label, raw) => {
    expect(parseNotificationRequest(raw)).toEqual({ ok: false, reason: 'body must be a JSON object' });
  });

  it.each([
    ['no title', { body: 'b' }, 'title is required'],
    ['an empty title', { title: '   ', body: 'b' }, 'title is required'],
    ['a non-string title', { title: 5, body: 'b' }, 'title is required'],
    ['no body', { title: 'a' }, 'body is required'],
    ['an empty body', { title: 'a', body: '' }, 'body is required'],
  ])('refuses %s', (_label, raw, reason) => {
    expect(parseNotificationRequest(raw)).toEqual({ ok: false, reason });
  });

  it('trims the copy it keeps', () => {
    const request = parsed({ title: '  مغلق  ', body: '  حجم  ' });
    expect(request.title).toBe('مغلق');
    expect(request.body).toBe('حجم');
  });

  it('defaults the optional fields to null rather than empty strings', () => {
    const request = parsed({ title: 'a', body: 'b' });
    expect(request).toMatchObject({ titleEn: null, bodyEn: null, url: null, tag: null });
    expect(request.ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
  });

  it('keeps the optional fields when they are given', () => {
    const request = parsed({
      title: 'a',
      body: 'b',
      titleEn: 'A',
      bodyEn: 'B',
      url: '/?tab=items',
      tag: 'variant:42',
      ttl: 90,
    });
    expect(request).toEqual({
      title: 'a',
      body: 'b',
      titleEn: 'A',
      bodyEn: 'B',
      url: '/?tab=items',
      tag: 'variant:42',
      ttlSeconds: 90,
    });
  });

  it.each([
    ['a string', '90'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('refuses a ttl given as %s', (_label, ttl) => {
    expect(parseNotificationRequest({ title: 'a', body: 'b', ttl })).toEqual({
      ok: false,
      reason: 'ttl must be a number of seconds',
    });
  });

  /*
   * The size limit is measured against the ENCODED payload, not the request, so
   * a refusal here is exactly the set of inputs that would otherwise throw
   * inside `encryptPayload` after the VAPID token had already been signed.
   */
  it('refuses copy that could not be encrypted into one record', () => {
    const result = parseNotificationRequest({ title: 'a', body: 'x'.repeat(MAX_PLAINTEXT_BYTES) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/over \d+$/);
  });

  it('counts Arabic copy in UTF-8 bytes rather than characters', () => {
    // Each of these characters is two bytes encoded, so a character-count check
    // would admit roughly twice what actually fits.
    const half = 'ب'.repeat(Math.floor(MAX_PLAINTEXT_BYTES / 2));
    expect(half.length).toBeLessThan(MAX_PLAINTEXT_BYTES);
    expect(parseNotificationRequest({ title: 'a', body: half }).ok).toBe(false);
  });

  it('accepts copy that fits', () => {
    expect(parseNotificationRequest({ title: 'a', body: 'x'.repeat(3000) }).ok).toBe(true);
  });

  /*
   * THE VARIANT THAT IS NOT MEASURED IS THE ONE THAT THROWS. A bilingual
   * request may carry a longer ENGLISH body that only an English-registered
   * device ever sees; sizing on Arabic alone lets it through, and
   * `encryptPayload` then throws for those devices only — which reads as a
   * flaky push service. Review caught it on #398.
   */
  it('refuses when only the English variant is over the limit', () => {
    const result = parseNotificationRequest({
      title: 'a',
      body: 'b',
      titleEn: 'A',
      bodyEn: 'x'.repeat(MAX_PLAINTEXT_BYTES),
    });
    expect(result.ok).toBe(false);
  });

  /*
   * `at` is a 13-digit epoch at delivery and was measured as `0` — one
   * character — so a request within twelve bytes of the ceiling passed here and
   * threw at encryption time.
   */
  it('leaves room for the runtime timestamp rather than a zero', () => {
    const sizeAtZero = (body: string) =>
      new TextEncoder().encode(
        JSON.stringify(
          buildPayload(
            { title: 'a', body, titleEn: null, bodyEn: null, url: null, tag: null, ttlSeconds: 60 },
            'ar',
            0,
          ),
        ),
      ).length;

    // The LARGEST body that fits exactly when `at` is a single character.
    const body = 'x'.repeat(MAX_PLAINTEXT_BYTES - sizeAtZero(''));
    // Self-check: this really is at the ceiling for at=0, so a checker that
    // measured there would admit it. Without this line the case could pass by
    // being over the limit for an unrelated reason.
    expect(sizeAtZero(body)).toBe(MAX_PLAINTEXT_BYTES);

    // And it must still be refused, because at delivery `at` is twelve
    // characters wider than the zero the first version measured.
    expect(parseNotificationRequest({ title: 'a', body }).ok).toBe(false);
  });
});

describe('buildPayload', () => {
  const arabicOnly = parsed({ title: 'مغلق', body: 'حجم مغلق', url: '/?tab=items', tag: 'v:1' });
  const bilingual = parsed({
    title: 'مغلق',
    body: 'حجم مغلق',
    titleEn: 'Closed',
    bodyEn: 'A size was closed',
  });

  it('carries every key the service worker reads', () => {
    const payload = buildPayload(arabicOnly, 'ar', 1_700_000_000_000);
    expect(payload).toEqual({
      title: 'مغلق',
      body: 'حجم مغلق',
      lang: 'ar',
      dir: 'rtl',
      at: 1_700_000_000_000,
      url: '/?tab=items',
      tag: 'v:1',
    });
  });

  it('omits url and tag rather than sending nulls the worker would reject', () => {
    // `public/sw.js` type-checks both, so a null is equivalent to absent — but
    // absent is smaller, and the payload has a hard byte ceiling.
    const payload = buildPayload(parsed({ title: 'a', body: 'b' }), 'ar', 0);
    expect('url' in payload).toBe(false);
    expect('tag' in payload).toBe(false);
  });

  it('uses the English copy for a device registered in English', () => {
    expect(buildPayload(bilingual, 'en', 0)).toMatchObject({
      title: 'Closed',
      body: 'A size was closed',
      lang: 'en',
      dir: 'ltr',
    });
  });

  it('uses Arabic for a device registered in Arabic even when English exists', () => {
    expect(buildPayload(bilingual, 'ar', 0)).toMatchObject({ title: 'مغلق', lang: 'ar', dir: 'rtl' });
  });

  /*
   * Falling back to Arabic rather than dropping the notification: the owner
   * chose Arabic, so a sender that supplies only Arabic is the normal case, and
   * an English-registered console still needs to be told a size closed.
   */
  it('falls back to Arabic when only Arabic copy was supplied', () => {
    expect(buildPayload(arabicOnly, 'en', 0)).toMatchObject({ title: 'مغلق', lang: 'ar', dir: 'rtl' });
  });

  it('falls back when only one half of the English copy was supplied', () => {
    const halfEnglish = parsed({ title: 'مغلق', body: 'حجم', titleEn: 'Closed' });
    expect(buildPayload(halfEnglish, 'en', 0)).toMatchObject({ title: 'مغلق', lang: 'ar' });
  });

  it.each([['ar'], ['en'], ['fr'], ['']])('never emits a null title for lang %s', (lang) => {
    expect(typeof buildPayload(arabicOnly, lang, 0).title).toBe('string');
  });
});

describe('refusePushEndpoint', () => {
  /*
   * WHAT THIS CONTAINS. `save_admin_push_subscription` checks only that the
   * endpoint is non-empty, so the stored value is whatever the caller sent —
   * and an admin at AAL2 is all it takes to store one. Without this check, one
   * row edit turns the sender into a connector to any address the Edge runtime
   * can reach. Same reasoning and same host rules as `smtpTarget.ts`. Review
   * caught the absence on #398.
   */
  it.each([
    ['the real Apple endpoint', 'https://web.push.apple.com/abc123'],
    ['the real FCM endpoint', 'https://fcm.googleapis.com/fcm/send/xyz'],
    ['Mozilla with a port', 'https://updates.push.services.mozilla.com:443/wpush/v2/x'],
  ])('admits %s', (_label, endpoint) => {
    expect(refusePushEndpoint(endpoint)).toBeNull();
  });

  it.each([
    ['the cloud metadata endpoint', 'https://169.254.169.254/latest/meta-data/'],
    ['loopback by name', 'https://localhost/push'],
    ['loopback by address', 'https://127.0.0.1/push'],
    ['loopback in decimal', 'https://2130706433/push'],
    ['loopback in hex', 'https://0x7f000001/push'],
    ['a short-form IPv4', 'https://127.1/push'],
    ['IPv6 loopback', 'https://[::1]/push'],
    ['private space', 'https://10.0.0.5/push'],
    ['a container name', 'https://redis/push'],
    ['an internal suffix', 'https://push.internal/x'],
    ['an mDNS name', 'https://printer.local/x'],
  ])('refuses %s', (_label, endpoint) => {
    expect(refusePushEndpoint(endpoint)).not.toBeNull();
  });

  it('refuses plain HTTP and other schemes', () => {
    expect(refusePushEndpoint('http://web.push.apple.com/x')).toBe('endpoint_not_https');
    expect(refusePushEndpoint('file:///etc/passwd')).toBe('endpoint_not_https');
    expect(refusePushEndpoint('gopher://example.com/x')).toBe('endpoint_not_https');
  });

  it('refuses an endpoint carrying credentials this process would transmit', () => {
    expect(refusePushEndpoint('https://user:pass@web.push.apple.com/x')).toBe('endpoint_has_credentials');
  });

  it('refuses something that is not a URL at all', () => {
    expect(refusePushEndpoint('web.push.apple.com/x')).toBe('endpoint_not_a_url');
    expect(refusePushEndpoint('')).toBe('endpoint_not_a_url');
  });

  it('honours an optional operator allowlist, and only narrows', () => {
    const apple = 'https://web.push.apple.com/x';
    expect(refusePushEndpoint(apple, null)).toBeNull();
    expect(refusePushEndpoint(apple, '')).toBeNull();
    expect(refusePushEndpoint(apple, 'push.apple.com')).toBeNull();
    expect(refusePushEndpoint(apple, 'fcm.googleapis.com')).toBe('endpoint_not_allowed');
  });

  it('is not fooled by a trailing dot on the hostname', () => {
    // `web.push.apple.com.` is the fully-qualified spelling of the same name.
    expect(refusePushEndpoint('https://web.push.apple.com./x', 'fcm.googleapis.com')).toBe(
      'endpoint_not_allowed',
    );
  });
});

describe('parseTargetEndpoint', () => {
  it('returns the endpoint when one is named', () => {
    expect(parseTargetEndpoint({ endpoint: ' https://a.example/x ' })).toBe('https://a.example/x');
  });

  it.each([[{}], [{ endpoint: '' }], [{ endpoint: 7 }], [null], ['x'], [['a']]])(
    'returns null for %s',
    (raw) => {
      expect(parseTargetEndpoint(raw)).toBeNull();
    },
  );
});

describe('classifyDelivery', () => {
  it.each([200, 201, 202, 204])('treats %i as sent', (status) => {
    expect(classifyDelivery(status)).toBe('sent');
  });

  it.each([404, 410])('treats %i as a dead subscription', (status) => {
    expect(classifyDelivery(status)).toBe('gone');
  });

  /*
   * 401 and 403 are OUR misconfiguration — a wrong VAPID token, or a key that
   * does not match the subscription. Classifying either as `gone` would delete
   * every admin registration on the first send after a mistyped key.
   */
  it.each([400, 401, 403, 413, 429, 500, 502, 503])('treats %i as a retryable failure', (status) => {
    expect(classifyDelivery(status)).toBe('failed');
  });
});

describe('shouldPruneAfterFailure', () => {
  it('keeps a subscription below the threshold', () => {
    expect(shouldPruneAfterFailure(MAX_CONSECUTIVE_FAILURES - 1)).toBe(false);
  });

  it('prunes at the threshold', () => {
    expect(shouldPruneAfterFailure(MAX_CONSECUTIVE_FAILURES)).toBe(true);
  });

  it('is generous enough to survive an afternoon of 5xx', () => {
    // At one closure notice every few minutes, a threshold in single figures
    // would delete live subscriptions during a push-service outage.
    expect(MAX_CONSECUTIVE_FAILURES).toBeGreaterThanOrEqual(10);
  });
});
