/**
 * Spicy Meal design tokens. Brand colors are fixed by the brief; app_settings
 * may override primary/secondary at runtime (see store), but these are the
 * safe defaults used before settings load and for static styles.
 *
 * Two palettes with identical KEYS, so a screen's StyleSheet is written once and
 * resolved per theme (see makeStyles). Three keys carry a role split that only
 * matters in dark mode, and that light mode makes invisible by giving both
 * members the same value:
 *
 *   purple  — a FILL that carries white text.       accent — the same brand
 *   red     — a FILL that carries white text.       colour used as TEXT or an
 *   white   — a LABEL on a coloured fill.           icon on a surface.
 *                                                   surface — a panel.
 *
 * One token cannot do both jobs on a dark ground: a purple light enough to read
 * as text on #1e1a2e cannot carry white text, and vice versa. In light mode
 * accent === purple and surface === white, so every existing screen renders
 * byte-identically; only dark mode pulls them apart.
 */
export const lightColors = {
  purple: '#422e87',
  red: '#e02d3d',
  white: '#ffffff',
  // Same value as `purple`/`red` here on purpose — see the note above.
  accent: '#422e87',
  accentAlt: '#e02d3d',

  // neutrals
  ink: '#1c1630',
  text: '#241d3a',
  muted: '#6b6580',
  border: '#ece9f2',
  surface: '#ffffff',
  bg: '#f6f5fa',
  bgAlt: '#faf9fd',

  // Semantic status colours, used for TEXT and icons on `surface` or on the
  // tints below. These are deliberately darker than they look like they should
  // be: measured against WCAG 2.1, the previous values failed AA for body text
  // — success 3.13:1 and warning 2.99:1 on their own tints, against a 4.5:1
  // requirement. Each value here is the smallest darkening that clears 4.5:1 on
  // BOTH grounds it appears on (its tint and a white card).
  //
  // `danger` is intentionally NOT the same as `red`. The brand red stays #e02d3d
  // for fills — a destructive button, the logo tag — where it carries white text
  // at 4.55:1. Error TEXT needs its own darker value to clear 4.5:1 on the pink
  // tint. Use `danger` for error text and icons; use `red` only for brand fills.
  // Verified by apps/mobile/src/theme.contrast.test.ts.
  success: '#197f45',
  danger: '#ce2938',
  warning: '#9b6412',

  // Status tints (previously inlined per-screen; single source of truth here)
  successBg: '#e7f6ee',
  dangerBg: '#fdeaec',
  purpleBg: '#f1edfb',

  // states
  disabled: '#c9c4d6',
  overlay: 'rgba(28,22,48,0.45)',
};

/**
 * Dark mode. Values are the design system's DARK MODE row
 * (design/01-design-system), with the three role splits resolved:
 *
 *  - `purple`/`red` are the FILL variants, chosen dark enough that white text on
 *    them still clears AA. The design system's #9b85f0 is the TEXT variant and
 *    lands in `accent`, where it belongs.
 *  - `white` stays real white: it labels those fills. Panels use `surface`.
 *
 * Every pairing here is asserted in theme/contrast.test.ts.
 */
export const darkColors: Palette = {
  purple: '#5a44ad',
  red: '#c22636',
  white: '#ffffff',
  accent: '#b3a3f5',
  accentAlt: '#ff8b99',

  // neutrals
  ink: '#f0edf6',
  text: '#e4e0ee',
  muted: '#a79fbb',
  border: '#2e2847',
  surface: '#1e1a2e',
  bg: '#100c1c',
  bgAlt: '#252040',

  // Semantic status colours, used for TEXT and icons. On a dark ground these
  // move the other way from light mode: they get LIGHTER, not darker, and each
  // value is the smallest lightening that clears 4.5:1 on both its own tint and
  // a `surface` card.
  success: '#4ade80',
  danger: '#ff8b99',
  warning: '#fbbf24',

  successBg: '#1a2e1f',
  dangerBg: '#2e1a1e',
  purpleBg: '#262046',

  disabled: '#4a4460',
  overlay: 'rgba(16,12,28,0.72)',
};

/** The shape both palettes share. */
export type Palette = typeof lightColors;

/**
 * The light palette, kept as the default export name so the ~40 modules that
 * import `colors` keep compiling. Anything rendered through makeStyles /
 * useThemeColors resolves the ACTIVE palette instead; this is the value used by
 * module-scope constants and by code that runs before a provider exists.
 */
export const colors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const font = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
};

export const shadow = {
  card: {
    shadowColor: '#2a2350',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  // Subtle lift for pressable tiles / sticky bars. Same hue family as `card`.
  sm: {
    shadowColor: '#2a2350',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // Raised sheets, popovers, floating CTAs.
  lg: {
    shadowColor: '#2a2350',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};

/**
 * Typography scale - pairs each size with a line-height and weight so text has
 * consistent vertical rhythm instead of every screen re-deriving it. Weights
 * are `as const` to satisfy React Native's `fontWeight` union. The raw `font`
 * size scale above is kept for existing call sites.
 */
export const typography = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
  title:   { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body:    { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  label:   { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  button:  { fontSize: 17, lineHeight: 22, fontWeight: '700' },
} as const;

/**
 * Motion tokens. Durations sit in the 150-320ms band (perceptible but snappy);
 * screens should gate any non-trivial animation behind the device's
 * reduce-motion setting (AccessibilityInfo.isReduceMotionEnabled).
 */
export const motion = {
  duration: { fast: 150, base: 220, slow: 320 },
  // Pressed-state feedback: a small opacity + scale dip reads as tactile
  // without moving layout. Consumed by shared pressables.
  pressedOpacity: 0.9,
  pressedScale: 0.97,
} as const;
