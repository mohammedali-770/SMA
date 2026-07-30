/**
 * Design-system font registration for the mobile app.
 *
 * Fonts are BUNDLED, never fetched: the @expo-google-fonts packages ship the
 * TTFs inside node_modules, Metro bundles them into the binary, and expo-font
 * registers them from the local asset. There is no network request and no CDN
 * at runtime — required, because the app must render correctly offline and in
 * a Saudi network environment where fonts.googleapis.com is not guaranteed.
 *
 * The family names registered here are exactly `tokens.fontFamily.*`; React
 * Native does not synthesise weights for custom fonts, so each weight is its
 * own family.
 */
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';

import { fontFamily } from './generated/tokens';

/** Map of registered family name → bundled TTF module. */
export const DESIGN_SYSTEM_FONTS = {
  [fontFamily.ar.regular]: IBMPlexSansArabic_400Regular,
  [fontFamily.ar.semibold]: IBMPlexSansArabic_600SemiBold,
  [fontFamily.ar.bold]: IBMPlexSansArabic_700Bold,
  [fontFamily.en.regular]: IBMPlexSans_400Regular,
  [fontFamily.en.semibold]: IBMPlexSans_600SemiBold,
  [fontFamily.en.bold]: IBMPlexSans_700Bold,
  [fontFamily.num.regular]: IBMPlexMono_400Regular,
  [fontFamily.num.semibold]: IBMPlexMono_600SemiBold,
};

export interface FontsStatus {
  /**
   * True once the app may render — whether the fonts loaded OR failed.
   *
   * Failing OPEN is deliberate: a font that will not decode must never trap the
   * user behind the splash screen. React Native falls back to the system face,
   * which is a cosmetic regression, not an outage.
   */
  ready: boolean;
  /** True only when the custom faces are actually available. */
  loaded: boolean;
  error: Error | null;
}

export function useDesignSystemFonts(): FontsStatus {
  const [loaded, error] = useFonts(DESIGN_SYSTEM_FONTS);
  return { ready: loaded || Boolean(error), loaded, error: error ?? null };
}
