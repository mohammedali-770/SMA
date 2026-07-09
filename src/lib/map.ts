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

export const mapConfig = {
  provider,
  /** Mapbox public access token (pk.…). Empty when not configured. */
  publicToken: mapboxToken,
  styleUrl: (import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined) ?? 'mapbox://styles/mapbox/streets-v12',
  /** True only when the active provider has the token it needs to render. */
  isConfigured: provider === 'mapbox' ? Boolean(mapboxToken) : false,
  /** Riyadh — a sensible default center before a branch/user location is known. */
  defaultCenter: { lng: 46.6753, lat: 24.7136 },
  defaultZoom: 11,
} as const;
