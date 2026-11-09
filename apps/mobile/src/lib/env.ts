/**
 * Public runtime config for the Expo app.
 *
 * Expo inlines any `EXPO_PUBLIC_*` variable into the JS bundle at build time,
 * so these are readable on-device via `process.env`. Only NON-secret values
 * belong here: the Supabase URL and the public key (publishable, or the legacy
 * anon key). RLS is the security boundary — the public key is meant to be
 * shipped. The service_role / secret key and all provider secrets
 * (payment/SMS/push/Lazywait) must NEVER appear in the app.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/**
 * The public Supabase key: the new publishable key (`sb_publishable_…`) once
 * EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set, else the legacy anon JWT, which
 * Supabase retires by the end of 2026 (docs/SUPABASE_API_KEYS.md). Both are
 * public by design; RLS is the boundary.
 *
 * Each is read as a DIRECT `process.env.EXPO_PUBLIC_*` member expression — the
 * only shape Expo inlines into the bundle — and joined with `||`, not `??`, so
 * an empty publishable value falls through to the legacy key instead of
 * shipping an app with no key at all.
 */
export const SUPABASE_PUBLIC_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/** True only when both public Supabase env vars are present. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY);

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
