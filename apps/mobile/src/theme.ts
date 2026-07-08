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
};
