/**
 * CANONICAL SOURCE — "Ember on Cream" design tokens.
 *
 * This file is authored here and MIRRORED into each app by
 * `scripts/sync-design-system.mjs`. The repo is not an npm workspace
 * (apps/mobile has its own node_modules, its own lockfile, and Metro has no
 * watchFolders), so a real shared package would require build-system changes.
 * Instead the mirrors are generated and CI fails if they drift.
 *
 * Edit THIS file, then run `npm run design-system:sync`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ADDITIVE BY DESIGN. `apps/mobile/src/theme.ts` and the `--color-primary` /
 * `--color-secondary` custom properties in `src/index.css` remain the
 * authoritative tokens for every EXISTING screen, and are unchanged. Nothing
 * here restyles anything that already ships. Only components under
 * `design-system/ui` consume these tokens today; screens migrate in a
 * follow-up PR.
 *
 * Must stay framework-free (no React, React Native, Expo, DOM or Supabase
 * imports) — `vitest.config.ts` runs the mobile mirror under the Node
 * environment.
 */

/** Brand. Red is the only interactive colour: if it is red, it does something. */
export const color = {
  ember: '#E02D3D',
  emberDeep: '#AE0F20',
  emberGlow: '#FF6A3D',
  saffron: '#FFB800',
  brandViolet: '#422E87',
  brandVioletSoft: '#6B4BD6',
  brandInk: '#241436',

  /** Customer-app surfaces — warm, light, appetising. */
  appBg: '#FFF7EF',
  appSurface: '#FFFFFF',
  appSurface2: '#FFF0E1',
  appSurface3: '#FCE1C9',
  appLine: '#F0E3D4',

  /** Ink — the brand violet lives in the type. */
  appText: '#241436',
  appText2: '#6E6280',
  appText3: '#9C93AB',

  /** Admin console surfaces — same warmth, denser scale. */
  conBg: '#F6F2EC',
  conSurface: '#FFFFFF',
  conSurface2: '#FBF7F1',
  conLine: '#E8DFD4',
  conText: '#241436',
  conText2: '#6E6280',
  conText3: '#9C93AB',

  /** Semantic — identical meaning in both products. */
  mint: '#12A150',
  sky: '#1E7FE0',
  warn: '#DE7C00',
  danger: '#D92D20',
  amberInk: '#8A5600',
  heatOff: '#DCCDBB',

  /**
   * Semantic surface tints. A status card is its hue at low saturation over
   * cream, never a solid block of the hue — body text has to stay readable on
   * it. Each tint carries a paired border so a tinted card still has a defined
   * edge against the cream ground.
   */
  warnTint: '#FFF6E6',
  warnLine: '#F2D9A8',
  dangerTint: '#FDECEC',
  dangerLine: '#F3C6C3',
  infoTint: '#EAF3FD',
  infoLine: '#C3DCF5',
  mintTint: '#E6F6ED',
  mintLine: '#B7E3C9',

  /** On-colour foregrounds. */
  onEmber: '#FFFFFF',
  disabledBg: '#EFE6DC',
  /**
   * Disabled label. NOT the tertiary ink (#9C93AB) — measured on a rendered
   * login screen that was ~2.2:1 against `disabledBg` and effectively
   * unreadable. A disabled control still has to be legible: the user must be
   * able to read what they cannot yet press. This is ~4.9:1, which clears AA.
   */
  disabledFg: '#6E6280',
} as const;

/**
 * Font family names.
 *
 * React Native does NOT synthesise weights for custom fonts — each weight is a
 * separate registered family. These strings are therefore the exact keys
 * `apps/mobile/src/design-system/fonts.ts` registers with expo-font, and they
 * match the file names shipped inside the @expo-google-fonts packages (bundled
 * TTFs, no network fetch at runtime).
 *
 * On web the same faces are self-hosted via @fontsource; see `fontStack` below,
 * which the browser resolves by weight in the normal way.
 */
export const fontFamily = {
  /** Arabic — primary language. */
  ar: {
    regular: 'IBMPlexSansArabic_400Regular',
    semibold: 'IBMPlexSansArabic_600SemiBold',
    bold: 'IBMPlexSansArabic_700Bold',
  },
  /** Latin — secondary. Same superfamily, so AR and EN share a skeleton. */
  en: {
    regular: 'IBMPlexSans_400Regular',
    semibold: 'IBMPlexSans_600SemiBold',
    bold: 'IBMPlexSans_700Bold',
  },
  /** ALL structured numbers: money, phone, OTP, national short address, POS ref. */
  num: {
    regular: 'IBMPlexMono_400Regular',
    semibold: 'IBMPlexMono_600SemiBold',
  },
} as const;

/** Web font stacks (CSS). Weights resolve normally in the browser. */
export const fontStack = {
  ar: "'IBM Plex Sans Arabic', system-ui, sans-serif",
  en: "'IBM Plex Sans', system-ui, sans-serif",
  num: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

/** 4-point base. */
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32 } as const;

/** Containers use lg/xl. Controls use md. Chips and tab bars use pill. */
export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Type scale. `weight` values are RN-compatible strings. */
export const type = {
  display: { size: 26, lineHeight: 32, weight: '700' },
  title: { size: 20, lineHeight: 26, weight: '700' },
  heading: { size: 17, lineHeight: 23, weight: '700' },
  body: { size: 15, lineHeight: 22, weight: '400' },
  label: { size: 13, lineHeight: 18, weight: '600' },
  caption: { size: 11.5, lineHeight: 16, weight: '500' },
  button: { size: 16, lineHeight: 22, weight: '700' },
} as const;

/** Minimum touch target (px). Both platforms. */
export const hitTarget = 44;

/**
 * Four durations, two curves. Motion is spent only on arrival, commitment and
 * failure. Consumers must gate non-trivial animation behind reduce-motion.
 */
export const motion = {
  instant: 90,
  quick: 160,
  base: 240,
  slow: 420,
  /** cubic-bezier control points — anything entering. */
  easeOut: [0.2, 0, 0, 1],
  /** cubic-bezier control points — anything moving in place. */
  easeInOut: [0.4, 0, 0.2, 1],
  pressedOpacity: 0.92,
  pressedScale: 0.98,
} as const;

export type ColorToken = keyof typeof color;
export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radius;
export type TypeToken = keyof typeof type;
