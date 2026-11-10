import { createClient } from '@supabase/supabase-js';

import { PUBLIC_KEY_ENV_NAMES, publicSupabaseKey } from './supabaseKey';

// Read from Vite env. The public key — the publishable key once configured,
// else the legacy anon key (supabaseKey.ts) — is safe in the client: RLS is the
// real security boundary. A secret / service_role key must NEVER appear here.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = publicSupabaseKey({
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

/** True only when both Supabase env vars are present. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Surfaced once at startup; the app falls back to its bundled demo data.
  console.warn(
    `[Spicy Meal] Supabase env not set (VITE_SUPABASE_URL / ${PUBLIC_KEY_ENV_NAMES}). ` +
    'Running against bundled demo data only.'
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
