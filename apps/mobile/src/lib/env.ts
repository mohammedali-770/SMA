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

/**
 * Map provider (public). The Mapbox public token is safe to ship but MUST be
 * restricted to this app's bundle id in the Mapbox dashboard. No secret here.
 */
export const MAP_PROVIDER = (process.env.EXPO_PUBLIC_MAP_PROVIDER ?? 'mapbox').toLowerCase();
export const MAPBOX_PUBLIC_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? '';

/**
 * Google Maps browser (JS API) key — public by design, but MUST be
 * referrer-restricted in Google Cloud. The WebView map page is loaded with
 * MAP_WEBVIEW_BASE_URL as its base URL so requests carry an allowed referrer
 * (inline WebView HTML otherwise has none and a restricted key would 403).
 */
export const GOOGLE_MAPS_BROWSER_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? '';
export const MAP_WEBVIEW_BASE_URL = process.env.EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL ?? '';

/** True only when the active map provider has the public key/token it needs. */
export const isMapConfigured = MAP_PROVIDER === 'mapbox'
  ? Boolean(MAPBOX_PUBLIC_TOKEN)
  : Boolean(GOOGLE_MAPS_BROWSER_KEY);
