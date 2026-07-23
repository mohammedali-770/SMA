/**
 * Spicy Meal design tokens. Brand colors are fixed by the brief; app_settings
 * may override primary/secondary at runtime (see store), but these are the
 * safe defaults used before settings load and for static styles.
 */
export const colors = {
  purple: '#422e87',
  red: '#e02d3d',
  white: '#ffffff',

  // neutrals
  ink: '#1c1630',
  text: '#241d3a',
  muted: '#6b6580',
  border: '#ece9f2',
  surface: '#ffffff',
  bg: '#f6f5fa',
  bgAlt: '#faf9fd',

  success: '#1f9d55',
  danger: '#e02d3d',
  warning: '#c47f17',

  // Status tints (previously inlined per-screen; single source of truth here)
  successBg: '#e7f6ee',
  dangerBg: '#fdeaec',
  purpleBg: '#f1edfb',

  // states
  disabled: '#c9c4d6',
  overlay: 'rgba(28,22,48,0.45)',
};

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
