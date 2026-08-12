import { color as lightColor } from '../design-system/generated/tokens';

/**
 * Runtime colour contract for the current Ember-on-Cream design system.
 *
 * The generated `color` object remains the canonical LIGHT palette. Dark mode
 * deliberately lives outside the generated file so `design-system:sync` keeps
 * working exactly as before and the Build 4 token source is not rewritten.
 * Every key is mirrored here, which lets migrated components switch palettes
 * without inventing per-screen colours.
 */
export type AppPalette = { [K in keyof typeof lightColor]: string };

export const lightPalette: AppPalette = lightColor;

export const darkPalette: AppPalette = {
  ember: '#E02D3D',
  emberDeep: '#AE0F20',
  emberGlow: '#FF7A52',
  saffron: '#FFC84A',
  brandViolet: '#B3A3F5',
  brandVioletSoft: '#9B85F0',
  brandInk: '#F4F1F8',

  appBg: '#100C1C',
  appSurface: '#1E1A2E',
  appSurface2: '#252040',
  appSurface3: '#2E2847',
  appLine: '#3A3354',

  appText: '#F4F1F8',
  appText2: '#C7C0D8',
  appText3: '#ADA4C0',

  conBg: '#100C1C',
  conSurface: '#1E1A2E',
  conSurface2: '#252040',
  conLine: '#3A3354',
  conText: '#F4F1F8',
  conText2: '#C7C0D8',
  conText3: '#ADA4C0',

  mint: '#4ADE80',
  sky: '#60A5FA',
  warn: '#FBBF24',
  danger: '#FF8B99',
  amberInk: '#FBBF24',
  heatOff: '#4A4460',

  warnTint: '#302611',
  warnLine: '#5B4820',
  dangerTint: '#2E1A1E',
  dangerLine: '#60313A',
  infoTint: '#16253A',
  infoLine: '#28496F',
  mintTint: '#13291E',
  mintLine: '#27583A',

  onEmber: '#FFFFFF',
  disabledBg: '#2F2944',
  disabledFg: '#A79FBB',
  scrim: '#08060EB8',
};
