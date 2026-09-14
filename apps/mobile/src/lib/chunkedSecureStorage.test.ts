/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';

import { createChunkedSecureStorage, splitByUtf8Bytes, type KeyValueBackend } from './chunkedSecureStorage';

const KEY = 'sb-project-auth-token';

/** UTF-8 length, the unit SecureStore's 2048-byte ceiling is measured in. */
const bytes = (s: string) => new TextEncoder().encode(s).length;

interface FakeStore extends KeyValueBackend {
  data: Map<string, string>;
  writes: string[];
  failOn: Set<string>;
}

/**
 * An in-memory stand-in for the keystore that records WRITE ORDER, because the
 * commit-point guarantee — manifest last — is an ordering property and cannot
 * be observed from the final state alone.
 */
function fakeStore(): FakeStore {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const failOn = new Set<string>();
  return {
    data,
    writes,
    failOn,
    async getItem(key) {
      if (failOn.has('get')) throw new Error('keystore unavailable');
      return data.has(key) ? (data.get(key) as string) : null;
    },
    async setItem(key, value) {
      if (failOn.has('set')) throw new Error('keystore unavailable');
      writes.push(key);
      data.set(key, value);
    },
    async removeItem(key) {
      if (failOn.has('remove')) throw new Error('keystore unavailable');
      data.delete(key);
    },
  };
}

/** A Supabase session is a JSON blob; only its size and charset matter here. */
const session = (n: number, fill = 'a') => JSON.stringify({ access_token: fill.repeat(n) });

describe('splitByUtf8Bytes', () => {
  it('keeps every chunk within the byte limit and rejoins exactly', () => {
    const value = session(5000);
    const chunks = splitByUtf8Bytes(value, 1800);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => bytes(c) <= 1800)).toBe(true);
    expect(chunks.join('')).toBe(value);
  });

  it('measures BYTES, not characters — Arabic costs two each', () => {
    // 100 Arabic characters are 200 bytes, so a 100-BYTE limit must split them
    // into two chunks. A character-counting split would emit one and overflow.
    const chunks = splitByUtf8Bytes('ب'.repeat(100), 100);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => bytes(c) <= 100)).toBe(true);
    expect(chunks.join('')).toBe('ب'.repeat(100));
  });

  it('never cuts a surrogate pair in half', () => {
    // A four-byte character against a limit that is not a multiple of four is
    // where a naive slice() produces two halves that no longer rejoin.
    const value = '🌶️'.repeat(40);
    const chunks = splitByUtf8Bytes(value, 7);
    expect(chunks.join('')).toBe(value);
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(chunks.some((c) => lone.test(c))).toBe(false);
  });

  it('round-trips the empty string rather than producing no chunks', () => {
    expect(splitByUtf8Bytes('', 1800)).toEqual(['']);
  });
});

describe('createChunkedSecureStorage', () => {
  it('round-trips a session larger than one entry', async () => {
    const secure = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy: null });
    const value = session(5000);
    await store.setItem(KEY, value);
    expect(await store.getItem(KEY)).toBe(value);
    // Every stored entry, manifest included, is under the ceiling.
    expect([...secure.data.values()].every((v) => bytes(v) <= 2048)).toBe(true);
  });

  it('writes the manifest LAST, so an interrupted write cannot half-apply', async () => {
    const secure = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy: null });
    await store.setItem(KEY, session(5000));
    expect(secure.writes[secure.writes.length - 1]).toBe(KEY);
    expect(secure.writes.slice(0, -1).every((k) => k.startsWith(`${KEY}.`))).toBe(true);
  });

  it('returns null rather than a TRUNCATED session when an entry is missing', async () => {
    const secure = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy: null });
    await store.setItem(KEY, session(5000));
    secure.data.delete(`${KEY}.1`);
    // Joining what remains would hand supabase-js valid-looking JSON that is
    // half a token; an ordinary signed-out state is the honest answer.
    expect(await store.getItem(KEY)).toBeNull();
    // And the wreckage is cleared, so it cannot be read again.
    expect(secure.data.has(KEY)).toBe(false);
  });

  it('clears entries a longer previous session used', async () => {
    const secure = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy: null });
    await store.setItem(KEY, session(5000));
    const before = [...secure.data.keys()].length;
    await store.setItem(KEY, session(10));
    // Those entries hold fragments of the token that was just replaced.
    expect([...secure.data.keys()].length).toBeLessThan(before);
    expect(secure.data.has(`${KEY}.2`)).toBe(false);
    expect(await store.getItem(KEY)).toBe(session(10));
  });

  it('refuses a value that would need more entries than the limit', async () => {
    const secure = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy: null, chunkBytes: 10, maxChunks: 3 });
    await expect(store.setItem(KEY, session(500))).rejects.toThrow(/over the 3 limit/);
  });

  it('REJECTS rather than quietly writing the token to the legacy store', async () => {
    const secure = fakeStore();
    const legacy = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy });
    secure.failOn.add('set');
    await expect(store.setItem(KEY, session(10))).rejects.toThrow(/keystore unavailable/);
    // The whole point of the change is that the refresh token is not here.
    expect(legacy.data.size).toBe(0);
  });

  describe('adoption of an existing AsyncStorage session', () => {
    it('moves it into the keystore and deletes the plaintext copy', async () => {
      const secure = fakeStore();
      const legacy = fakeStore();
      const value = session(5000);
      legacy.data.set(KEY, value);
      const store = createChunkedSecureStorage({ secure, legacy });

      expect(await store.getItem(KEY)).toBe(value);
      expect(legacy.data.has(KEY)).toBe(false);
      // Second read comes from the keystore, with the legacy copy long gone.
      expect(await store.getItem(KEY)).toBe(value);
    });

    it('keeps the customer signed in when the keystore refuses, and retries later', async () => {
      const secure = fakeStore();
      const legacy = fakeStore();
      legacy.data.set(KEY, session(10));
      secure.failOn.add('set');
      const store = createChunkedSecureStorage({ secure, legacy });

      expect(await store.getItem(KEY)).toBe(session(10));
      // Deleting a working session in order to protect it helps nobody; leaving
      // it means the next launch can try the move again.
      expect(legacy.data.has(KEY)).toBe(true);
    });

    it('does not adopt anything when adoption is disabled', async () => {
      const secure = fakeStore();
      const legacy = fakeStore();
      legacy.data.set(KEY, session(10));
      const store = createChunkedSecureStorage({ secure, legacy: null });
      expect(await store.getItem(KEY)).toBeNull();
    });
  });

  it('sign-out clears the manifest, every entry AND the legacy copy', async () => {
    const secure = fakeStore();
    const legacy = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy });
    await store.setItem(KEY, session(5000));
    // A copy left here by a build that predates the keystore would otherwise be
    // adopted straight back on the next launch — signing the customer in again.
    legacy.data.set(KEY, session(10));

    await store.removeItem(KEY);
    expect(secure.data.size).toBe(0);
    expect(legacy.data.has(KEY)).toBe(false);
    expect(await store.getItem(KEY)).toBeNull();
  });

  it('treats an unreadable keystore as signed out instead of throwing on read', async () => {
    const secure = fakeStore();
    const store = createChunkedSecureStorage({ secure, legacy: null });
    await store.setItem(KEY, session(10));
    secure.failOn.add('get');
    await expect(store.getItem(KEY)).resolves.toBeNull();
  });
});
