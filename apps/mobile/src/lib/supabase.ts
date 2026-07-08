/**
 * Supabase client for React Native / Expo.
 *
 * Differences from the web client (src/lib/supabase.ts in the web app):
 *  - Session is persisted with AsyncStorage, NOT browser localStorage (which
 *    does not exist in React Native).
 *  - `detectSessionInUrl: false` — there is no URL/hash to parse on native;
 *    leaving it on throws in RN.
 *  - `react-native-url-polyfill/auto` is imported first so supabase-js's use of
 *    the WHATWG `URL` API works on Hermes.
 *  - Token auto-refresh is tied to app foreground/background via AppState.
 *
 * The security model is identical to the web app: the app holds only the anon
 * key and every request is authorized by Postgres RLS. No service-role key and
 * no provider secret ever lives here.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './env';

if (!isSupabaseConfigured) {
  // Surfaced once at startup. The app cannot load real data without these; the
  // UI shows a clear error state instead of crashing.
  console.warn(
    '[Spicy Meal] Supabase env not set (EXPO_PUBLIC_SUPABASE_URL / ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY). Copy .env.example to .env.local and fill it in.',
  );
}

export const supabase = createClient(
  SUPABASE_URL || 'http://localhost',
  SUPABASE_ANON_KEY || 'public-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// Refresh the session only while the app is in the foreground. Supabase's RN
// guide recommends this so tokens don't refresh in the background needlessly.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});

export { isSupabaseConfigured };
