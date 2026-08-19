/**
 * Platform-aware wrapper over the pure URL builders in `maps.ts`.
 *
 * Separate file because the unit suite runs under Node and cannot import
 * `react-native`; everything worth asserting lives in `maps.ts` and is tested
 * there. This module only picks which shape to use.
 */
import { Platform } from 'react-native';

import { buildDirectionsUrl, hasUsableCoordinates } from './maps';

/** The directions URL for THIS device, or null when the branch has no usable location. */
export function directionsUrl(lat: unknown, lng: unknown, label?: string): string | null {
  if (!hasUsableCoordinates(lat, lng)) return null;
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  return buildDirectionsUrl(platform, lat as number, lng as number, label);
}
