/**
 * Public runtime config for the Expo app.
 *
 * Expo inlines any `EXPO_PUBLIC_*` variable into the JS bundle at build time,
 * so these are readable on-device via `process.env`. Only NON-secret values
 * belong here: the Supabase URL and the anon (public) key. RLS is the security
 * boundary — the anon key is meant to be shipped. The service_role key and all
 * provider secrets (payment/SMS/push/Lazywait) must NEVER appear in the app.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True only when both public Supabase env vars are present. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
