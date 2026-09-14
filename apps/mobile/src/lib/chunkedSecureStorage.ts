/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A storage adapter for supabase-js that keeps the GoTrue session in the
 * device keystore instead of AsyncStorage, and can move an existing session
 * across without signing anybody out.
 *
 * WHY. `supabase.auth` persists a JSON blob containing the access token AND
 * the refresh token. In AsyncStorage that blob is an ordinary row in an
 * app-private SQLite file: unreadable by other apps, but carried into
 * `adb backup`, into Android auto-backup to the customer's Drive, and into an
 * unencrypted iTunes backup. The refresh token is the long-lived credential —
 * it mints access tokens until it is revoked — so it is the one value in this
 * app that must not travel in a backup. `expo-secure-store` puts it in the
 * Android Keystore / iOS Keychain, neither of which is included in a device
 * backup by default.
 *
 * WHY THIS FILE IS PURE. Everything here is injected, so the whole thing runs
 * under Node in `chunkedSecureStorage.test.ts`. The React Native and Expo
 * wiring lives in `secureSessionStorage.ts`, which this file never imports —
 * the root vitest config requires mobile suites to be framework-free.
 *
 * THE 2048-BYTE PROBLEM IS THE REASON THIS IS NOT FOUR LINES. SecureStore
 * documents a 2048-byte ceiling per value, and a Supabase session is routinely
 * larger than that once the JWT and the user object are in it — a name in
 * Arabic pushes it further, because the limit is on BYTES and those characters
 * cost two. So the value is split across numbered entries with a manifest, and
 * the manifest is written LAST: until it lands, the old session is still the
 * one that reads back, so an interrupted write cannot leave a half-session
 * that parses.
 *
 * FAILURE IS LOUD, DELIBERATELY. If the keystore refuses a write this adapter
 * rejects rather than quietly writing to AsyncStorage instead. A silent
 * fallback would mean the control cannot be verified from the outside — the
 * token might be in the keystore, or might not, and nothing would say which.
 * The cost of being loud is a rare forced re-login; the cost of being quiet is
 * a security property that is only sometimes true.
 */

/** The three methods supabase-js calls, and the three this needs of a backend. */
export interface KeyValueBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ChunkedSecureStorageOptions {
  /** The keystore. Writes that fail here are NOT re-routed anywhere. */
  secure: KeyValueBackend;
  /**
   * The AsyncStorage the session used to live in, read once per key so an
   * already-signed-in customer is carried over instead of logged out. Pass
   * `null` to disable adoption entirely (a fresh install needs no migration).
   */
  legacy: KeyValueBackend | null;
  /** Bytes per entry. Default 1800, under SecureStore's documented 2048. */
  chunkBytes?: number;
  /**
   * Refuse to write more entries than this. A session is 2-3 entries; an order
   * of magnitude more means something is wrong, and writing it would scatter
   * credential fragments across entries this adapter would then have to track.
   */
  maxChunks?: number;
}

const DEFAULT_CHUNK_BYTES = 1800;
const DEFAULT_MAX_CHUNKS = 16;

/** UTF-8 cost of one code point — the unit SecureStore's limit is measured in. */
function utf8Cost(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Split on CODE POINT boundaries, never inside a surrogate pair.
 *
 * Splitting by `.slice()` on a fixed character count would cut an emoji or a
 * rare CJK character in half, and the two halves would concatenate back into a
 * different string than went in — a session that no longer parses, on exactly
 * the customers whose data is least like the developer's.
 */
export function splitByUtf8Bytes(value: string, limit: number): string[] {
  if (value === '') return [''];
  const chunks: string[] = [];
  let current = '';
  let used = 0;
  for (const ch of value) {
    const cost = utf8Cost(ch.codePointAt(0) as number);
    if (used + cost > limit && current !== '') {
      chunks.push(current);
      current = '';
      used = 0;
    }
    current += ch;
    used += cost;
  }
  chunks.push(current);
  return chunks;
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

/** Swallow a failure that is housekeeping rather than data. */
async function ignore(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    /* best effort: a leftover entry is never read, and cannot be repaired here */
  }
}

export function createChunkedSecureStorage(opts: ChunkedSecureStorageOptions): KeyValueBackend {
  const secure = opts.secure;
  const legacy = opts.legacy;
  const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;

  /** Chunk count for a key, or null when nothing readable is stored. */
  async function readManifest(key: string): Promise<number | null> {
    let raw: string | null = null;
    try {
      raw = await secure.getItem(key);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as { n?: unknown };
      const n = parsed && typeof parsed.n === 'number' ? parsed.n : null;
      if (n === null || !Number.isInteger(n) || n < 0 || n > maxChunks) return null;
      return n;
    } catch {
      // Not a manifest. Most likely an entry written by an older build that
      // stored the session whole; treat it as unreadable rather than guessing,
      // and let removeItem's sweep clear it.
      return null;
    }
  }

  async function sweep(key: string, from: number, upto: number): Promise<void> {
    for (let i = from; i < upto; i += 1) {
      await ignore(secure.removeItem(chunkKey(key, i)));
    }
  }

  async function setItem(key: string, value: string): Promise<void> {
    const previous = await readManifest(key);
    const chunks = splitByUtf8Bytes(value, chunkBytes);
    if (chunks.length > maxChunks) {
      throw new Error(`secure storage: "${key}" needs ${chunks.length} entries, over the ${maxChunks} limit`);
    }
    for (let i = 0; i < chunks.length; i += 1) {
      await secure.setItem(chunkKey(key, i), chunks[i]);
    }
    // THE COMMIT POINT. Everything above is invisible until this lands, which
    // is what makes a half-finished write read back as the previous session
    // rather than as a truncated one.
    await secure.setItem(key, JSON.stringify({ v: 1, n: chunks.length }));
    // Entries left over from a longer previous value hold fragments of the
    // token that was just replaced, so they are cleared rather than left.
    await sweep(key, chunks.length, previous ?? maxChunks);
  }

  async function removeItem(key: string): Promise<void> {
    const n = await readManifest(key);
    await ignore(secure.removeItem(key));
    await sweep(key, 0, n ?? maxChunks);
    // Sign-out must also drop any legacy copy, or the next launch would adopt
    // it straight back and the customer would still be signed in.
    if (legacy) await ignore(legacy.removeItem(key));
  }

  async function adopt(key: string): Promise<string | null> {
    if (!legacy) return null;
    let raw: string | null = null;
    try {
      raw = await legacy.getItem(key);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      await setItem(key, raw);
    } catch {
      // The keystore refused. Keep the customer signed in on the copy that
      // exists, and LEAVE it in place so the next launch can try again — the
      // alternative is deleting a working session to protect it.
      return raw;
    }
    await ignore(legacy.removeItem(key));
    return raw;
  }

  async function getItem(key: string): Promise<string | null> {
    const n = await readManifest(key);
    if (n === null) return adopt(key);
    if (n === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < n; i += 1) {
      let part: string | null = null;
      try {
        part = await secure.getItem(chunkKey(key, i));
      } catch {
        part = null;
      }
      if (part === null) {
        // The manifest promises an entry that is not there. Returning the rest
        // would hand supabase-js a truncated JSON blob; clearing it turns a
        // corrupt session into an ordinary signed-out one.
        await removeItem(key);
        return null;
      }
      parts.push(part);
    }
    return parts.join('');
  }

  return { getItem, setItem, removeItem };
}
