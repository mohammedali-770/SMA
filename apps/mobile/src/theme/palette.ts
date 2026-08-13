import { color as lightColor } from '../design-system/generated/tokens';

/**
 * Runtime colour contract for the current Ember-on-Cream design system.
 * The generated `color` object remains the canonical LIGHT palette. Dark mode
 * uses a low-glare warm-charcoal palette: neutral surfaces, softer dividers and
 * readable text/status tones without the previous purple cast.
 */
export type AppPalette = { [K in keyof typeof lightColor]: string };

export const lightPalette: AppPalette = lightColor;

export const darkPalette: AppPalette = {
  ember: '#D63245',
  emberDeep: '#A92435',
  emberGlow: '#ED7480',
  saffron: '#E6B84A',
  brandViolet: '#B8AEC4',
  brandVioletSoft: '#9E93AA',
  brandInk: '#F7F3F1',

  appBg: '#151318',
  appSurface: '#201D23',
  appSurface2: '#29252C',
  appSurface3: '#332E36',
  appLine: '#48414A',

  appText: '#F7F3F1',
  appText2: '#D5CECB',
  appText3: '#AAA2A1',

  conBg: '#151318',
  conSurface: '#201D23',
  conSurface2: '#29252C',
  conLine: '#48414A',
  conText: '#F7F3F1',
  conText2: '#D5CECB',
  conText3: '#AAA2A1',

  mint: '#79C99E',
  sky: '#7FAFD8',
  warn: '#D9AD4A',
  danger: '#E57B86',
  amberInk: '#E4B957',
  heatOff: '#625B64',

  warnTint: '#30291B',
  warnLine: '#665535',
  dangerTint: '#352124',
  dangerLine: '#6A3B41',
  infoTint: '#1E2932',
  infoLine: '#40596D',
  mintTint: '#1D2D26',
  mintLine: '#3E6250',

  onEmber: '#FFFFFF',
  disabledBg: '#343035',
  disabledFg: '#9C959C',
  scrim: '#0C0A0ECC',
};
