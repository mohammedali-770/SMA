import { describe, expect, it } from 'vitest';
import { serializeSubscription, urlBase64ToUint8Array } from './pushSubscription';

describe('urlBase64ToUint8Array', () => {
  it('decodes an unpadded base64url key', () => {
    // "Ma-n" in base64url is 3 bytes; standard base64 would need padding.
    expect(Array.from(urlBase64ToUint8Array('Ma-n'))).toEqual([0x31, 0xaf, 0xa7]);
  });

  it('translates the base64url alphabet, not just the padding', () => {
    // '-' is '+' and '_' is '/'. Getting this wrong yields a key that looks
    // plausible and produces a subscription no push can reach.
    const dash = urlBase64ToUint8Array('-_8=');
    expect(Array.from(dash)).toEqual([0xfb, 0xff]);
  });

  it('accepts a key that already carries padding', () => {
    expect(Array.from(urlBase64ToUint8Array('QQ=='))).toEqual([0x41]);
  });

  it('ignores surrounding whitespace, which a copy-paste always adds', () => {
    expect(Array.from(urlBase64ToUint8Array('  QQ==  '))).toEqual([0x41]);
  });

  it('produces the 65 bytes a real VAPID P-256 public key has', () => {
    const key = 'B' + 'A'.repeat(86); // 87 base64url chars -> 65 bytes
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });

  it('throws on an empty key rather than returning empty bytes', () => {
    // Empty bytes would be accepted by subscribe() and fail much later.
    expect(() => urlBase64ToUint8Array('')).toThrow(/empty/i);
    expect(() => urlBase64ToUint8Array('   ')).toThrow(/empty/i);
  });

  it('throws on a key that is not base64 at all', () => {
    expect(() => urlBase64ToUint8Array('!!!!')).toThrow(/base64url/i);
  });
});

describe('serializeSubscription', () => {
  const good = {
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'PKEY', auth: 'AKEY' } }),
  };

  it('extracts the three fields the server stores', () => {
    expect(serializeSubscription(good)).toEqual({
      endpoint: 'https://push.example/abc',
      p256dh: 'PKEY',
      auth: 'AKEY',
    });
  });

  it('returns null rather than a partial record when a key is missing', () => {
    // A row missing either key can never be pushed to, so storing it would show
    // the admin a "subscribed" device that silently never notifies.
    expect(
      serializeSubscription({ toJSON: () => ({ endpoint: 'https://p/x', keys: { p256dh: 'P' } }) }),
    ).toBeNull();
    expect(
      serializeSubscription({ toJSON: () => ({ endpoint: 'https://p/x', keys: { auth: 'A' } }) }),
    ).toBeNull();
    expect(serializeSubscription({ toJSON: () => ({ endpoint: 'https://p/x', keys: null }) })).toBeNull();
  });

  it('returns null when there is no endpoint', () => {
    expect(serializeSubscription({ toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }) })).toBeNull();
    expect(
      serializeSubscription({ toJSON: () => ({ endpoint: '', keys: { p256dh: 'P', auth: 'A' } }) }),
    ).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(serializeSubscription(null)).toBeNull();
    expect(serializeSubscription(undefined)).toBeNull();
  });

  it('survives a toJSON that throws', () => {
    expect(
      serializeSubscription({
        toJSON: () => {
          throw new Error('detached');
        },
        endpoint: 'https://p/x',
      }),
    ).toBeNull();
  });

  it('rejects non-string fields rather than coercing them', () => {
    expect(
      serializeSubscription({
        toJSON: () => ({ endpoint: 42 as unknown as string, keys: { p256dh: 'P', auth: 'A' } }),
      }),
    ).toBeNull();
  });
});
