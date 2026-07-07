import { createClient } from '@supabase/supabase-js';

// Read from Vite env. The anon (public) key is safe in the client — RLS is the
// real security boundary. The service_role key must NEVER appear here.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True only when both Supabase env vars are present. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Surfaced once at startup; the app falls back to its bundled demo data.
  console.warn(
    '[Spicy Meal] Supabase env not set (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
    'Running against bundled demo data only.'
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
