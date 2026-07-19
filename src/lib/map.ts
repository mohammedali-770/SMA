/**
 * Map-provider abstraction (web).
 *
 * Provider + public token come from Vite env (VITE_*), never hardcoded and never
 * committed. Mapbox is the default; the `provider` switch keeps the app from
 * being permanently locked to one vendor. The public token is shippable (like
 * the Supabase anon key) but MUST be URL-restricted in the Mapbox dashboard.
 * When unconfigured, `isConfigured` is false and callers show a "map setup
 * required" message instead of crashing.
 */
export type MapProvider = 'mapbox' | 'google';

const rawProvider = (import.meta.env.VITE_MAP_PROVIDER as string | undefined)?.toLowerCase();
const provider: MapProvider = rawProvider === 'google' ? 'google' : 'mapbox';
const mapboxToken = (import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN as string | undefined) ?? '';
// A Mapbox *public* token starts with `pk.`. Secret tokens (`sk.`) must never be
// shipped to the browser, so we treat a non-`pk.` token as unconfigured and let
// the Map Settings panel flag it explicitly.
const tokenLooksPublic = mapboxToken.startsWith('pk.');
const googleKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';

export const mapConfig = {
  provider,
  /** Mapbox public access token (pk.…). Empty when not configured. */
  publicToken: mapboxToken,
  styleUrl: (import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined) ?? 'mapbox://styles/mapbox/streets-v12',
  /** Google Maps browser API key (referrer-restricted in Google Cloud). */
  googleKey,
  /** True only when the active provider has a usable browser key/token. */
  isConfigured: provider === 'mapbox' ? (Boolean(mapboxToken) && tokenLooksPublic) : Boolean(googleKey),
  /** A token is set but doesn't look like a public `pk.` token (misconfig hint). */
  tokenPresentButInvalid: provider === 'mapbox' && Boolean(mapboxToken) && !tokenLooksPublic,
  /** Riyadh — a sensible default center before a branch/user location is known. */
  defaultCenter: { lng: 46.6753, lat: 24.7136 },
  defaultZoom: 11,
} as const;

// ---------------------------------------------------------------------------
// Arabic / RTL label shaping (Mapbox fallback provider only — Google Maps
// shapes Arabic natively).
//
// Mapbox GL renders Arabic labels as disconnected, reversed glyphs unless the
// official RTL-text plugin is loaded. The plugin is self-hosted (vendored from
// @mapbox/mapbox-gl-rtl-text@0.4.0 into public/vendor/, served from our own
// origin) so the strict `script-src 'self'` CSP in vercel.json keeps working.
// ---------------------------------------------------------------------------
const rtlTextPluginUrl = '/vendor/mapbox-gl-rtl-text-v0.4.0.js';
// Type-only import: must never pull mapbox-gl (~1.8 MB) into the main bundle —
// callers pass their already-loaded instance in.
import type mapboxgl from 'mapbox-gl';

/**
 * Idempotently register the RTL text plugin on a loaded mapbox-gl instance.
 * Call once before creating a map. `lazy: true` defers execution until a map
 * actually renders RTL text. Safe to call from every map component — repeat
 * calls and plugin failures are swallowed (labels just fall back to unshaped
 * text rather than breaking the map).
 */
export function ensureRtlTextPlugin(gl: typeof mapboxgl): void {
  try {
    if (gl.getRTLTextPluginStatus() === 'unavailable') {
      gl.setRTLTextPlugin(rtlTextPluginUrl, () => { /* errors surface per-label only */ }, true);
    }
  } catch { /* already set or unsupported — keep the map usable */ }
}
