/**
 * Web Push — VAPID signing (RFC 8292) and aes128gcm payload encryption
 * (RFC 8291), with nothing else in it.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A DEPENDENCY. Every mature web-push
 * library is a Node package that reaches for `node:crypto`, `node:http` and a
 * bundler; the Deno/Edge ports are thin and unmaintained. Everything the
 * protocol needs — ECDH on P-256, HKDF-SHA256, AES-128-GCM and ECDSA P-256 —
 * is in the Web Crypto API that both Deno and Node already ship. So this is
 * ~150 lines of standard library calls instead of a supply-chain edge for a
 * feature that sends notifications to staff phones.
 *
 * NO Deno APIs APPEAR HERE, DELIBERATELY. `vitest.config.ts` runs
 * `supabase/functions/**\/*.test.ts` in Node, so keeping this module free of
 * `Deno.*` is what lets the paired suite execute in CI. Everything
 * environment-shaped (secrets, fetch, the database) lives in
 * `admin-push-dispatch/index.ts`.
 *
 * THE EVIDENCE THAT IT IS CORRECT IS THE RFC's OWN TEST VECTOR, not a
 * round-trip against itself. `webPush.test.ts` encrypts RFC 8291 §5's
 * plaintext with RFC 8291 §5's keys and salt and asserts the body matches
 * RFC 8291 §5's published ciphertext byte for byte. A self-consistent
 * encrypt/decrypt pair would pass with the HKDF info strings swapped, the
 * record size wrong, or the key and nonce derived in the wrong order; the
 * vector would not.
 */

const encoder = new TextEncoder();

/** The bytes a push service is guaranteed to accept in one request (RFC 8030 §5.1). */
export const MAX_REQUEST_BODY_BYTES = 4096;

/**
 * Fixed record size. One record is all we ever send, so this is a constant in
 * the header rather than a real chunking parameter — but it is part of the
 * derived key material's framing, so it cannot be changed casually.
 */
const RECORD_SIZE = 4096;

/** salt(16) + rs(4) + idlen(1) + as_public(65) — the aes128gcm header. */
const HEADER_BYTES = 16 + 4 + 1 + 65;
/** AES-GCM tag (16) + the final-record delimiter byte (1). */
const TRAILER_BYTES = 16 + 1;

/**
 * The largest plaintext that still fits a guaranteed-deliverable request.
 * Exceeding it is a programming error, not a runtime condition, so the encrypt
 * call throws rather than truncating a notification into nonsense.
 */
export const MAX_PLAINTEXT_BYTES = MAX_REQUEST_BODY_BYTES - HEADER_BYTES - TRAILER_BYTES;

export interface VapidKeyPair {
  /** base64url, uncompressed P-256 point, 65 bytes. */
  publicKey: string;
  /** base64url, raw P-256 scalar, 32 bytes. */
  privateKey: string;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  /** base64url, the user agent's uncompressed P-256 public key. */
  p256dh: string;
  /** base64url, the 16-byte shared authentication secret. */
  auth: string;
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded =
    normalized.length % 4 === 0 ? normalized : normalized + '='.repeat(4 - (normalized.length % 4));
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HKDF-SHA256 extract-and-expand in one call, which is what Web Crypto gives us. */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/** `"<label>" || 0x00` — the info string shape both RFC 8188 and RFC 8291 use. */
function infoString(label: string): Uint8Array {
  return concatBytes(encoder.encode(label), new Uint8Array([0]));
}

/**
 * Build the JWK for a P-256 private key from the raw scalar plus the matching
 * public point, because Web Crypto has no way to import a bare scalar.
 *
 * This is the ONLY place the two halves of a key pair are combined, which is
 * why `assertVapidKeyPair` can rely on the import itself rejecting a pair that
 * does not belong together.
 */
function privateJwk(publicKey: Uint8Array, privateKeyB64: string): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('web push: public key must be a 65-byte uncompressed P-256 point');
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(publicKey.slice(1, 33)),
    y: bytesToBase64Url(publicKey.slice(33, 65)),
    d: privateKeyB64,
    ext: true,
  };
}

/**
 * Prove the two halves of a VAPID key pair belong together, and say so in one
 * sentence when they do not.
 *
 * WHY THIS EARNS ITS PLACE. The public half lives in `app_settings` (the
 * browser needs it to subscribe) and the private half in a function secret.
 * They are configured in two different places by hand, so transposing a
 * character in one of them is an ordinary mistake — and its symptom is every
 * push being rejected by every endpoint with an opaque 401, which reads like a
 * dead feature rather than a typo.
 *
 * The check is written to fail the same way in both runtimes: Node's Web Crypto
 * rejects a mismatched JWK at import, Deno's may instead import it and produce
 * a signature that does not verify. Both paths end in the same thrown error.
 */
export async function assertVapidKeyPair(pair: VapidKeyPair): Promise<void> {
  const mismatch = new Error('web push: VAPID public and private keys do not match');
  let signingKey: CryptoKey;
  let verifyKey: CryptoKey;
  const publicBytes = base64UrlToBytes(pair.publicKey);
  try {
    signingKey = await crypto.subtle.importKey(
      'jwk',
      privateJwk(publicBytes, pair.privateKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    verifyKey = await crypto.subtle.importKey(
      'raw',
      publicBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch {
    throw mismatch;
  }
  const probe = encoder.encode('spicy-meal-vapid-probe');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, probe);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, signature, probe);
  if (!ok) throw mismatch;
}

/**
 * Generate a VAPID key pair in the format every web-push tool uses: the public
 * half as a base64url uncompressed point (what the browser passes to
 * `pushManager.subscribe`), the private half as the base64url raw scalar.
 *
 * Used by `webPush.test.ts` and by `scripts/generate-vapid-keys.mjs`, which is
 * how the two configured values are produced. It exists here rather than only
 * in the script so the format is defined in one place — the same code that
 * later has to import the result.
 */
export async function generateVapidKeys(): Promise<VapidKeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (typeof jwk.d !== 'string') throw new Error('web push: key generation produced no scalar');
  return { publicKey: bytesToBase64Url(publicKey), privateKey: jwk.d };
}

/** The `aud` claim: scheme + host (+ port) of the push endpoint, and nothing else. */
export function audienceFor(endpoint: string): string {
  return new URL(endpoint).origin;
}

export interface VapidOptions {
  endpoint: string;
  /** `mailto:` or `https:` contact for the push service operator (RFC 8292 §2.1). */
  subject: string;
  keys: VapidKeyPair;
  /** Seconds since the epoch; injected so the signature is testable. */
  nowSeconds: number;
  /** Token lifetime. RFC 8292 caps this at 24 hours; 12 is the customary value. */
  expiresInSeconds?: number;
}

/**
 * The `Authorization: vapid t=<jwt>, k=<public key>` header.
 *
 * ES256 in JOSE is the raw `r || s` pair, which is exactly what Web Crypto's
 * ECDSA sign returns — no DER unwrapping is needed, and adding any would break
 * it.
 */
export async function buildVapidAuthorization(options: VapidOptions): Promise<string> {
  const { endpoint, subject, keys, nowSeconds } = options;
  if (!/^(mailto:|https:)/.test(subject)) {
    throw new Error('web push: VAPID subject must be a mailto: or https: URL');
  }
  const expiresIn = Math.min(Math.max(options.expiresInSeconds ?? 12 * 60 * 60, 60), 24 * 60 * 60);
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: audienceFor(endpoint),
        exp: nowSeconds + expiresIn,
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk(base64UrlToBytes(keys.publicKey), keys.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(signingInput)),
  );
  return `vapid t=${signingInput}.${bytesToBase64Url(signature)}, k=${keys.publicKey}`;
}

export interface EncryptOptions {
  plaintext: Uint8Array;
  /** The subscription's `p256dh` and `auth`, base64url as the browser gives them. */
  subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>;
  /**
   * TEST SEAM. Both default to fresh randomness; RFC 8291 §5's vector can only
   * be reproduced by pinning them, and pinning them is the only way to check
   * this implementation against something other than itself.
   */
  salt?: Uint8Array;
  serverKeys?: VapidKeyPair;
}

/**
 * Encrypt one aes128gcm record (RFC 8291 §3 / RFC 8188 §2), returning the whole
 * request body: `salt(16) || rs(4) || idlen(1) || as_public(65) || ciphertext`.
 */
export async function encryptPayload(options: EncryptOptions): Promise<Uint8Array> {
  const { plaintext, subscription } = options;
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(
      `web push: payload is ${plaintext.length} bytes, over the ${MAX_PLAINTEXT_BYTES}-byte limit`,
    );
  }
  const uaPublic = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('web push: subscription p256dh is not a 65-byte uncompressed P-256 point');
  }
  if (authSecret.length !== 16) {
    throw new Error('web push: subscription auth secret must be 16 bytes');
  }

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('web push: salt must be 16 bytes');

  let serverPrivate: CryptoKey;
  let serverPublic: Uint8Array;
  if (options.serverKeys) {
    serverPublic = base64UrlToBytes(options.serverKeys.publicKey);
    serverPrivate = await crypto.subtle.importKey(
      'jwk',
      privateJwk(serverPublic, options.serverKeys.privateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
  } else {
    // A FRESH EPHEMERAL PAIR PER MESSAGE. Reusing one across messages would
    // reuse the ECDH secret, and with it the content key — and AES-GCM under a
    // repeated key and nonce is broken, not merely weaker.
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    serverPrivate = pair.privateKey;
    serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverPrivate, 256),
  );

  // RFC 8291 §3.3: the key info binds BOTH public keys into the derivation, so
  // a shared secret cannot be replayed against a different subscription.
  const keyInfo = concatBytes(encoder.encode('WebPush: info'), new Uint8Array([0]), uaPublic, serverPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const contentKey = await hkdf(salt, ikm, infoString('Content-Encoding: aes128gcm'), 16);
  const nonce = await hkdf(salt, ikm, infoString('Content-Encoding: nonce'), 12);

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // 0x02 is the last-record delimiter (RFC 8188 §2). 0x01 would announce that
  // another record follows, and the user agent would wait for one that never
  // arrives.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      concatBytes(plaintext, new Uint8Array([2])),
    ),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE, false);
  return concatBytes(salt, recordSize, new Uint8Array([serverPublic.length]), serverPublic, ciphertext);
}

export interface PushRequestOptions {
  subscription: PushSubscriptionKeys;
  payload: unknown;
  vapid: { subject: string; keys: VapidKeyPair };
  nowSeconds: number;
  /** How long the push service may hold an undelivered message, in seconds. */
  ttlSeconds?: number;
  salt?: Uint8Array;
  serverKeys?: VapidKeyPair;
}

export interface PushRequest {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Everything needed to `fetch` one notification to one subscription. */
export async function buildPushRequest(options: PushRequestOptions): Promise<PushRequest> {
  const body = await encryptPayload({
    plaintext: encoder.encode(JSON.stringify(options.payload)),
    subscription: options.subscription,
    salt: options.salt,
    serverKeys: options.serverKeys,
  });
  const authorization = await buildVapidAuthorization({
    endpoint: options.subscription.endpoint,
    subject: options.vapid.subject,
    keys: options.vapid.keys,
    nowSeconds: options.nowSeconds,
  });
  return {
    url: options.subscription.endpoint,
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(Math.min(Math.max(Math.trunc(options.ttlSeconds ?? 3600), 0), 86400)),
      Urgency: 'normal',
    },
    body,
  };
}

/**
 * Whether a push service's rejection means the subscription is permanently
 * gone, so the row should be deleted rather than retried.
 *
 * 404 and 410 ONLY (RFC 8030 §7.3 / the Web Push protocol's own guidance). A
 * 401 means our VAPID configuration is wrong, a 403 that the key does not match
 * the subscription, a 413 that the payload is too big and a 429 that we are
 * sending too fast — every one of those is OUR problem, and deleting the
 * subscriber's registration would turn a fixable misconfiguration into silent
 * permanent data loss across every admin device at once.
 */
export function isGoneStatus(status: number): boolean {
  return status === 404 || status === 410;
}
