/**
 * RFC-4122-ish v4 UUID generator. Prefers a native crypto RNG when present
 * (Hermes may expose crypto.randomUUID / getRandomValues) and falls back to
 * Math.random. Used only for the place_order idempotency key — its job is to
 * dedupe a retried checkout, not to be a security token, so the fallback is
 * acceptable.
 */
export function uuidv4(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.randomUUID) {
    try {
      return g.crypto.randomUUID();
    } catch {
      // fall through to manual generation
    }
  }
  const bytes = new Uint8Array(16);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' + hex.slice(4, 6).join('') +
    '-' + hex.slice(6, 8).join('') +
    '-' + hex.slice(8, 10).join('') +
    '-' + hex.slice(10, 16).join('')
  );
}
