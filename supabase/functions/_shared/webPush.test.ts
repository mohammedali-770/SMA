import { describe, expect, it } from 'vitest';

import {
  MAX_PLAINTEXT_BYTES,
  assertVapidKeyPair,
  audienceFor,
  base64UrlToBytes,
  buildPushRequest,
  buildVapidAuthorization,
  bytesToBase64Url,
  encryptPayload,
  generateVapidKeys,
  isGoneStatus,
} from './webPush';

/**
 * RFC 8291 §5, "Encryption Example", verbatim.
 *
 * THIS IS THE WHOLE POINT OF THE SUITE. A round-trip test — encrypt, decrypt,
 * compare — passes just as happily with the two HKDF info strings swapped, the
 * record size wrong, the key and nonce derived in the wrong order, or the
 * last-record delimiter set to 0x01. None of those would ever display a
 * notification on a real phone, and all of them are self-consistent. Matching
 * the RFC's published ciphertext byte for byte is the only cheap check that
 * distinguishes "my implementation agrees with itself" from "my implementation
 * agrees with the browsers".
 *
 * These key values are published in the RFC. They are a test vector, not a
 * credential, and nothing in this repository uses them for anything else.
 */
const RFC8291 = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLoc' +
    'InmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLV' +
    'WGNWQexSgSxsj_Qulcy4a-fN',
} as const;

const RFC_SUBSCRIPTION = { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret };
const RFC_SERVER_KEYS = { publicKey: RFC8291.asPublic, privateKey: RFC8291.asPrivate };

describe('base64url', () => {
  it.each([0, 1, 2, 3, 16, 31, 32, 65])('round-trips %i bytes', (length) => {
    const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) % 256);
    expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it('decodes unpadded base64url containing - and _', () => {
    // 0xFB 0xEF 0xFF is `++//` in standard base64 — the two characters the URL
    // alphabet replaces, which is what this decoder has to get right.
    expect(Array.from(base64UrlToBytes('--__'))).toEqual([251, 239, 255]);
  });

  it('emits no padding characters', () => {
    expect(bytesToBase64Url(new Uint8Array([1]))).not.toContain('=');
  });
});

describe('encryptPayload against the RFC 8291 test vector', () => {
  it('reproduces the published body byte for byte', async () => {
    const body = await encryptPayload({
      plaintext: new TextEncoder().encode(RFC8291.plaintext),
      subscription: RFC_SUBSCRIPTION,
      salt: base64UrlToBytes(RFC8291.salt),
      serverKeys: RFC_SERVER_KEYS,
    });
    expect(bytesToBase64Url(body)).toBe(RFC8291.body);
  });

  // Each of these kills a specific way of getting the framing wrong.
  it('frames the header as salt(16) || rs(4) || idlen(1) || as_public(65)', async () => {
    const body = await encryptPayload({
      plaintext: new TextEncoder().encode(RFC8291.plaintext),
      subscription: RFC_SUBSCRIPTION,
      salt: base64UrlToBytes(RFC8291.salt),
      serverKeys: RFC_SERVER_KEYS,
    });
    expect(Array.from(body.slice(0, 16))).toEqual(Array.from(base64UrlToBytes(RFC8291.salt)));
    // Record size, big-endian. Little-endian would be 00 10 00 00.
    expect(Array.from(body.slice(16, 20))).toEqual([0x00, 0x00, 0x10, 0x00]);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(0x04);
    expect(bytesToBase64Url(body.slice(21, 86))).toBe(RFC8291.asPublic);
    // plaintext + delimiter + GCM tag.
    expect(body.length).toBe(86 + RFC8291.plaintext.length + 1 + 16);
  });

  it('produces a different body every time when nothing is pinned', async () => {
    const once = await encryptPayload({
      plaintext: new TextEncoder().encode('hello'),
      subscription: RFC_SUBSCRIPTION,
    });
    const twice = await encryptPayload({
      plaintext: new TextEncoder().encode('hello'),
      subscription: RFC_SUBSCRIPTION,
    });
    // A fresh salt AND a fresh ephemeral key pair. Equality here would mean the
    // content key and nonce repeat, which is how AES-GCM stops being secure.
    expect(bytesToBase64Url(once)).not.toBe(bytesToBase64Url(twice));
    expect(bytesToBase64Url(once.slice(0, 16))).not.toBe(bytesToBase64Url(twice.slice(0, 16)));
    expect(bytesToBase64Url(once.slice(21, 86))).not.toBe(bytesToBase64Url(twice.slice(21, 86)));
  });
});

describe('encryptPayload refuses input it cannot encrypt correctly', () => {
  const plaintext = new TextEncoder().encode('x');

  it('rejects a p256dh that is not a 65-byte uncompressed point', async () => {
    await expect(
      encryptPayload({
        plaintext,
        subscription: { p256dh: bytesToBase64Url(new Uint8Array(64)), auth: RFC8291.authSecret },
      }),
    ).rejects.toThrow(/uncompressed P-256 point/);
  });

  it('rejects a compressed point of the right length', async () => {
    const compressed = base64UrlToBytes(RFC8291.uaPublic).slice();
    compressed[0] = 0x02;
    await expect(
      encryptPayload({
        plaintext,
        subscription: { p256dh: bytesToBase64Url(compressed), auth: RFC8291.authSecret },
      }),
    ).rejects.toThrow(/uncompressed P-256 point/);
  });

  it('rejects an auth secret that is not 16 bytes', async () => {
    await expect(
      encryptPayload({
        plaintext,
        subscription: { p256dh: RFC8291.uaPublic, auth: bytesToBase64Url(new Uint8Array(12)) },
      }),
    ).rejects.toThrow(/16 bytes/);
  });

  it('rejects a salt that is not 16 bytes', async () => {
    await expect(
      encryptPayload({ plaintext, subscription: RFC_SUBSCRIPTION, salt: new Uint8Array(8) }),
    ).rejects.toThrow(/salt must be 16 bytes/);
  });

  // The boundary, both sides. Truncating instead of throwing would ship a
  // notification whose JSON is cut in half, which the worker cannot parse.
  it('accepts exactly the maximum plaintext and rejects one byte more', async () => {
    await expect(
      encryptPayload({
        plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES),
        subscription: RFC_SUBSCRIPTION,
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
    await expect(
      encryptPayload({
        plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES + 1),
        subscription: RFC_SUBSCRIPTION,
      }),
    ).rejects.toThrow(/over the .* limit/);
  });

  it('keeps a maximum-size body inside the guaranteed 4096 bytes', async () => {
    const body = await encryptPayload({
      plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES),
      subscription: RFC_SUBSCRIPTION,
    });
    expect(body.length).toBe(4096);
  });
});

describe('assertVapidKeyPair', () => {
  it('accepts a pair whose halves belong together', async () => {
    await expect(assertVapidKeyPair(RFC_SERVER_KEYS)).resolves.toBeUndefined();
  });

  it('accepts a freshly generated pair', async () => {
    await expect(assertVapidKeyPair(await generateVapidKeys())).resolves.toBeUndefined();
  });

  /*
   * THE CASE THIS FUNCTION EXISTS FOR: the public half is configured in
   * `app_settings` and the private half in a function secret, so they are typed
   * into two different places and can disagree. Without this check the symptom
   * is every push being refused with an opaque 401.
   *
   * Node's Web Crypto rejects the crossed JWK at import; another runtime may
   * accept it and fail at verification instead. The assertion is on the single
   * message both paths produce, so this test is meaningful in either.
   */
  it('rejects a public key that belongs to a different private key', async () => {
    const other = await generateVapidKeys();
    await expect(
      assertVapidKeyPair({ publicKey: RFC8291.asPublic, privateKey: other.privateKey }),
    ).rejects.toThrow(/do not match/);
  });

  /*
   * A SURVIVING MUTANT, RECORDED RATHER THAN HIDDEN. Replacing the final
   * `if (!ok) throw mismatch;` with a no-op survives this suite under Node,
   * because Node's Web Crypto rejects the crossed JWK at import and the
   * verification is never reached. That line is insurance for a runtime whose
   * import is more permissive — Deno's, which this function actually runs on
   * and which cannot be executed here. It is kept deliberately, and the fact
   * that Node cannot exercise it is a limitation of the test environment, not
   * evidence the line is dead.
   */
  it('rejects a public key of the wrong length', async () => {
    await expect(
      assertVapidKeyPair({
        publicKey: bytesToBase64Url(new Uint8Array(32)),
        privateKey: RFC8291.asPrivate,
      }),
    ).rejects.toThrow(/do not match/);
  });
});

describe('buildVapidAuthorization', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123?x=1';
  const subject = 'https://app.spicymeal.com.sa';

  async function header(overrides: Partial<Parameters<typeof buildVapidAuthorization>[0]> = {}) {
    return buildVapidAuthorization({
      endpoint,
      subject,
      keys: RFC_SERVER_KEYS,
      nowSeconds: 1_700_000_000,
      ...overrides,
    });
  }

  function claims(value: string): Record<string, unknown> {
    const jwt = /vapid t=([^,]+), k=(.+)$/.exec(value);
    if (!jwt) throw new Error(`unexpected header shape: ${value}`);
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(jwt[1].split('.')[1])));
  }

  it('advertises the public key in the k parameter', async () => {
    expect(await header()).toContain(`, k=${RFC8291.asPublic}`);
  });

  it('scopes the audience to the endpoint origin and nothing else', async () => {
    // Not the path, and not the query — a token scoped to the full URL is
    // rejected by every push service.
    expect(claims(await header()).aud).toBe('https://fcm.googleapis.com');
  });

  it('carries the subject verbatim and an expiry in the future', async () => {
    const parsed = claims(await header());
    expect(parsed.sub).toBe(subject);
    expect(parsed.exp).toBe(1_700_000_000 + 12 * 60 * 60);
  });

  it('clamps the expiry to the 24 hours RFC 8292 allows', async () => {
    expect(claims(await header({ expiresInSeconds: 60 * 60 * 24 * 7 })).exp).toBe(
      1_700_000_000 + 24 * 60 * 60,
    );
  });

  it('declares ES256 in the JOSE header', async () => {
    const value = await header();
    const encoded = /vapid t=([^,]+),/.exec(value)?.[1].split('.')[0] ?? '';
    expect(JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)))).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
  });

  /*
   * The only assertion here that a push service actually makes. ES256 in JOSE
   * is the raw 64-byte r||s pair; wrapping it in DER, or signing the wrong
   * bytes, produces a header that looks perfectly well-formed and is refused by
   * every endpoint.
   */
  it('signs the header.payload input verifiably with the advertised key', async () => {
    const value = await header();
    const token = /vapid t=([^,]+),/.exec(value)?.[1] ?? '';
    const [h, p, s] = token.split('.');
    const signature = base64UrlToBytes(s);
    expect(signature.length).toBe(64);
    const key = await crypto.subtle.importKey(
      'raw',
      base64UrlToBytes(RFC8291.asPublic),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it('refuses a subject that is neither mailto: nor https:', async () => {
    await expect(header({ subject: 'app.spicymeal.com.sa' })).rejects.toThrow(/mailto: or https:/);
    await expect(header({ subject: 'http://app.spicymeal.com.sa' })).rejects.toThrow(/mailto: or https:/);
  });

  it('accepts a mailto: subject', async () => {
    expect(claims(await header({ subject: 'mailto:ops@example.com' })).sub).toBe('mailto:ops@example.com');
  });
});

describe('audienceFor', () => {
  it.each([
    ['https://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com'],
    ['https://web.push.apple.com/abc/def', 'https://web.push.apple.com'],
    ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://updates.push.services.mozilla.com'],
    ['https://example.com:8443/push/1', 'https://example.com:8443'],
  ])('reduces %s to %s', (endpoint, expected) => {
    expect(audienceFor(endpoint)).toBe(expected);
  });
});

describe('buildPushRequest', () => {
  const subscription = {
    endpoint: 'https://web.push.apple.com/abc',
    p256dh: RFC8291.uaPublic,
    auth: RFC8291.authSecret,
  };
  const vapid = { subject: 'https://app.spicymeal.com.sa', keys: RFC_SERVER_KEYS };

  it('serialises the payload as the JSON the service worker parses', async () => {
    const request = await buildPushRequest({
      subscription,
      payload: { title: 'مغلق', body: 'حجم مغلق', url: '/?tab=items' },
      vapid,
      nowSeconds: 1_700_000_000,
      salt: base64UrlToBytes(RFC8291.salt),
      serverKeys: RFC_SERVER_KEYS,
    });
    expect(request.url).toBe(subscription.endpoint);
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(request.headers['Content-Type']).toBe('application/octet-stream');
    expect(request.headers.Authorization.startsWith('vapid t=')).toBe(true);
    // Arabic copy is multi-byte; the body must grow by the UTF-8 length, not
    // the character count.
    const json = JSON.stringify({ title: 'مغلق', body: 'حجم مغلق', url: '/?tab=items' });
    expect(request.body.length).toBe(86 + new TextEncoder().encode(json).length + 1 + 16);
  });

  it.each([
    [undefined, '3600'],
    [0, '0'],
    [120, '120'],
    [-5, '0'],
    [999_999, '86400'],
    [10.9, '10'],
  ])('clamps a TTL of %s to %s', async (ttlSeconds, expected) => {
    const request = await buildPushRequest({
      subscription,
      payload: {},
      vapid,
      nowSeconds: 1,
      ttlSeconds: ttlSeconds as number | undefined,
    });
    expect(request.headers.TTL).toBe(expected);
  });
});

describe('isGoneStatus', () => {
  it.each([404, 410])('treats %i as permanently gone', (status) => {
    expect(isGoneStatus(status)).toBe(true);
  });

  /*
   * Every one of these is OUR misconfiguration, not a dead subscription.
   * Deleting on 401 or 403 would wipe every admin registration the first time a
   * VAPID key was mistyped, and the admins would have to notice and re-enable
   * it themselves.
   */
  it.each([200, 201, 400, 401, 403, 413, 429, 500, 502, 503])('keeps the subscription on %i', (status) => {
    expect(isGoneStatus(status)).toBe(false);
  });
});
