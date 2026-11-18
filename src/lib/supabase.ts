import { createClient } from '@supabase/supabase-js';

import { PUBLIC_KEY_ENV_NAMES, publicSupabaseKey } from './supabaseKey';

// Read from Vite env. The publishable key (supabaseKey.ts) is safe in the
// client: RLS is the real security boundary. A secret key must NEVER appear here.
const url = import.meta.env.VITE_SUPABASE_URL;
const publicKey = publicSupabaseKey({
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

/** True only when both Supabase env vars are present. */
export const isSupabaseConfigured = Boolean(url && publicKey);

if (!isSupabaseConfigured) {
  // Surfaced once at startup. There is NO demo-data fallback — that prototype
  // mode was removed long ago, and this message used to claim it still existed.
  // Every request goes to a placeholder host and fails, so sign-in cannot work.
  // A Vercel production build refuses to build in this state (vite.config.ts).
  console.warn(
    `[Spicy Meal] Supabase env not set (VITE_SUPABASE_URL / ${PUBLIC_KEY_ENV_NAMES}). ` +
    'Every request will fail: set them and rebuild.'
  );
}

export const supabase = createClient(url ?? 'http://localhost', publicKey ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
