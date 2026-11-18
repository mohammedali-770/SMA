/**
 * The public Supabase key the web console sends: the publishable key
 * (`sb_publishable_…`), and nothing else.
 *
 * Supabase retired the JWT-based `anon` key. Until step 9 of
 * docs/SUPABASE_API_KEYS.md §3 this module fell back to `VITE_SUPABASE_ANON_KEY`
 * when no publishable key was set; that fallback is gone, because the legacy
 * keys have been deactivated and a build still carrying one would ship a key
 * the gateway refuses. The publishable key is DESIGNED to be public — it
 * identifies the project, and Row Level Security is the boundary — so it may sit
 * in a `VITE_*` variable (CLAUDE.md §9).
 *
 * A value that is not a publishable key — empty, a legacy JWT left behind in
 * the variable, or a `sb_secret_…` key pasted by mistake — is treated as
 * missing, so the console reports itself unconfigured (and a Vercel production
 * build refuses to build) rather than shipping it.
 *
 * Callers pass the value in as a DIRECT `import.meta.env.X` member expression
 * (or `process.env.X` at build time), because Vite only replaces that exact
 * shape — reading the env object dynamically here would compile to undefined.
 */
export interface PublicKeyEnv {
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

/** The name quoted in "not configured" messages. */
export const PUBLIC_KEY_ENV_NAMES = 'VITE_SUPABASE_PUBLISHABLE_KEY';

export function publicSupabaseKey(env: PublicKeyEnv): string | undefined {
  const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return publishable && /^sb_publishable_/.test(publishable) ? publishable : undefined;
}

/** What a console build needs to reach Supabase at all. */
export interface SupabaseBuildEnv extends PublicKeyEnv {
  VITE_SUPABASE_URL?: string;
}

/**
 * The variable names a console build is missing, empty when it has what it
 * needs. The key is judged exactly as at run time, so a variable holding
 * something other than a publishable key counts as missing.
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
 * on the `apikey` header only". The gateway supplies the anon role when no
 * session JWT is sent (measured 2026-11-09 with the legacy key, and with the
 * publishable key on 2026-11-18 — docs/SUPABASE_API_KEYS.md §3). supabase-js
 * clients are unaffected — they manage their own headers.
 */
export function publicRestHeaders(key: string): Record<string, string> {
  return { apikey: key };
}
