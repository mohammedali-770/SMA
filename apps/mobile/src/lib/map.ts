/**
 * Map-provider abstraction (mobile). Mirrors the web app's src/lib/map.ts.
 *
 * Values come from EXPO_PUBLIC_* env, inlined at build time — never hardcoded,
 * never committed. Mapbox is the default. The public token is shippable but MUST
 * be restricted to the app's bundle id / URL in the Mapbox dashboard. When
 * unconfigured, `isMapConfigured` is false and the picker shows a setup message.
 */
import { MAP_PROVIDER, MAPBOX_PUBLIC_TOKEN } from './env';

export type MapProvider = 'mapbox' | 'google';

const provider: MapProvider = MAP_PROVIDER === 'google' ? 'google' : 'mapbox';

export const mapConfig = {
  provider,
  publicToken: MAPBOX_PUBLIC_TOKEN,
  styleUrl: process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL ?? 'mapbox://styles/mapbox/streets-v12',
  isConfigured: provider === 'mapbox' ? Boolean(MAPBOX_PUBLIC_TOKEN) : false,
  defaultCenter: { lng: 46.6753, lat: 24.7136 }, // Riyadh
  defaultZoom: 11,
} as const;
