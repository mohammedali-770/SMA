/**
 * The public Supabase key the web console sends.
 *
 * Supabase retires the JWT-based `anon` key by the end of 2026 and replaces it
 * with an opaque publishable key (`sb_publishable_…`). Both are DESIGNED to be
 * public — they identify the project, and Row Level Security is the boundary —
 * so either may sit in a `VITE_*` variable (CLAUDE.md §9).
 *
 * `VITE_SUPABASE_PUBLISHABLE_KEY` wins when it is set; otherwise the legacy
 * `VITE_SUPABASE_ANON_KEY` is used exactly as before. That lets the Vercel
 * environment gain the new variable without a code change, and lets the old
 * one be removed only once the new one is live. Runbook:
 * docs/SUPABASE_API_KEYS.md.
 *
 * Callers pass the values in as DIRECT `import.meta.env.X` member expressions
 * (or `process.env.X` at build time), because Vite only replaces that exact
 * shape — reading the env object dynamically here would compile to undefined.
 */
export interface PublicKeyEnv {
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** Names quoted in "not configured" messages, so they always name both. */
export const PUBLIC_KEY_ENV_NAMES = 'VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY';

export function publicSupabaseKey(env: PublicKeyEnv): string | undefined {
  const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publishable) return publishable;
  const anon = env.VITE_SUPABASE_ANON_KEY?.trim();
  return anon || undefined;
}

/**
 * Headers for a raw PostgREST `fetch` made with the public key.
 *
 * `apikey` ONLY. Supabase's migration guide: "Send publishable and secret keys
 * on the `apikey` header only". With the legacy anon key this was measured to
 * read exactly what `apikey` + `Authorization: Bearer` read (2026-11-09: the
 * same 9 active legal documents, HTTP 200), because the gateway supplies the
 * anon role when no session JWT is sent. supabase-js clients are unaffected —
 * they manage their own headers.
 */
export function publicRestHeaders(key: string): Record<string, string> {
  return { apikey: key };
}
