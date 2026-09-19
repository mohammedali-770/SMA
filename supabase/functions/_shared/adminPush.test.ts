import { describe, expect, it } from 'vitest';

import { MAX_PLAINTEXT_BYTES } from './webPush';
import {
  DEFAULT_TTL_SECONDS,
  MAX_CONSECUTIVE_FAILURES,
  buildPayload,
  classifyDelivery,
  mayDrainQueue,
  parseDispatchMode,
  parseNotificationRequest,
  requestFromQueueRow,
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

  it.each(['service_role', 'scheduler'] as const)('lets %s fan out', (caller) => {
    expect(scopeFor(caller)).toBe('all');
  });
});

describe('parseDispatchMode', () => {
  it('defaults to a direct send when no mode is given', () => {
    expect(parseDispatchMode({ title: 'a', body: 'b' })).toBe('direct');
  });

  it.each([
    ['direct', 'direct'],
    ['queue', 'queue'],
  ])('accepts %s', (mode, expected) => {
    expect(parseDispatchMode({ mode })).toBe(expected);
  });

  /*
   * A mode it does not recognise is a REFUSAL, not a fall-back to direct. A
   * typo like `mode: "queued"` silently becoming a direct send would answer
   * `ok` to a scheduler tick while draining nothing, and the queue would fill
   * until every row expired — a failure that reports success.
   */
  it.each([['queued'], ['QUEUE'], [''], [null], [1], [{}]])('refuses %s', (mode) => {
    expect(parseDispatchMode({ mode })).toBeNull();
  });

  it.each([[null], ['queue'], [7], [['queue']]])('refuses %s as a body', (raw) => {
    expect(parseDispatchMode(raw)).toBeNull();
  });
});

describe('mayDrainQueue', () => {
  /*
   * THE REASON AN ADMIN MAY NOT is not that they are untrusted. A drain
   * CONSUMES rows — claimed, sent, finalized — while an admin's scope is their
   * own devices. So an admin draining the queue would deliver every branch's
   * closure notices to one phone and mark them done for everybody else.
   */
  it('refuses an admin', () => {
    expect(mayDrainQueue('admin')).toBe(false);
  });

  it.each(['service_role', 'scheduler'] as const)('allows %s', (caller) => {
    expect(mayDrainQueue(caller)).toBe(true);
  });
});

describe('requestFromQueueRow', () => {
  const row = {
    id: 7,
    title_ar: 'إغلاق حجم — الرياض',
    body_ar: 'تم إغلاق حجم «كبير».',
    title_en: 'Size closed — Riyadh',
    body_en: '"Large" was closed.',
    url: '/',
    tag: 'variant:abc',
  };

  it('maps Arabic to the default copy and English to the override', () => {
    expect(requestFromQueueRow(row)).toEqual({
      title: row.title_ar,
      body: row.body_ar,
      titleEn: row.title_en,
      bodyEn: row.body_en,
      url: '/',
      tag: 'variant:abc',
      ttlSeconds: DEFAULT_TTL_SECONDS,
    });
  });

  it('produces a payload the service worker can read', () => {
    const payload = buildPayload(requestFromQueueRow(row), 'ar', 0);
    expect(payload.title).toBe(row.title_ar);
    expect(payload.lang).toBe('ar');
    expect(payload.dir).toBe('rtl');
  });

  it('keeps a null url and tag null rather than inventing a target', () => {
    const request = requestFromQueueRow({ ...row, url: null, tag: null });
    expect(request.url).toBeNull();
    expect(request.tag).toBeNull();
    expect('url' in buildPayload(request, 'ar', 0)).toBe(false);
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
