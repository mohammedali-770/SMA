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

/** What a console build needs to reach Supabase at all. */
export interface SupabaseBuildEnv extends PublicKeyEnv {
  VITE_SUPABASE_URL?: string;
}

/**
 * The variable names a console build is missing, empty when it has what it
 * needs. A key is satisfied by EITHER public key, exactly as at run time, so the
 * two missing keys are reported as one entry naming both.
 *
 * Read by `vite.config.ts`, which fails a Vercel PRODUCTION build on a
 * non-empty answer. Without that, a production build with no Supabase settings
 * succeeded, and the console it produced sent every request to
 * `http://localhost`.
 */
export function missingSupabaseBuildEnv(env: SupabaseBuildEnv): string[] {
  const missing: string[] = [];
  if (!env.VITE_SUPABASE_URL?.trim()) missing.push('VITE_SUPABASE_URL');
  if (!publicSupabaseKey(env)) missing.push(PUBLIC_KEY_ENV_NAMES);
  return missing;
}

/**
 * Refuses a Vercel PRODUCTION build that has no Supabase settings.
 *
 * Without them the console still built, and every request it made went to a
 * placeholder host: a console nobody could sign in to, which a successful
 * build would put in place of the one that worked. A failed build is the
 * better outcome, because Vercel then keeps serving the previous deployment. Previews only warn — a preview without the
 * settings is a misconfiguration worth seeing, not one worth blocking — and a
 * build outside Vercel (CI, local) sets no VERCEL_ENV and is unaffected.
 *
 * `vite.config.ts` passes `loadEnv(mode, cwd, 'VITE_')`, the same source Vite
 * inlines into the bundle, so a value from an `.env.*` file counts as well as
 * one in the process env.
 */
export function supabaseBuildGuard(
  vercelEnv: string | undefined,
  env: Record<string, string | undefined>,
): { action: 'ok' } | { action: 'warn' | 'fail'; message: string } {
  const missing = missingSupabaseBuildEnv({
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
  });
  if (missing.length === 0 || (vercelEnv !== 'production' && vercelEnv !== 'preview')) return { action: 'ok' };
  const message =
    `[supabase-env] ${vercelEnv} build is missing ${missing.join(' and ')}. ` +
    'The console would send every request to a placeholder host.';
  return vercelEnv === 'production' ? { action: 'fail', message } : { action: 'warn', message };
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
