/**
 * "Ember on Cream" design system — mobile entry point.
 *
 * ADDITIVE. `src/theme.ts` remains authoritative for every shipped screen and
 * is unchanged; nothing here restyles anything today. Screens migrate in a
 * follow-up PR.
 *
 * `generated/*` is written by `npm run design-system:sync` from the canonical
 * `design-system/` folder at the repo root. Do not hand-edit it — CI fails on
 * drift (`npm run design-system:check`).
 *
 * NOTE: this barrel pulls in React Native components. `vitest.config.ts`
 * requires mobile test files to be framework-free, so tests must import the
 * pure modules from `generated/` directly, never from here.
 */
export * from './generated/tokens';
export * from './generated/money';
export * from './generated/buttonState';
export * from './generated/fieldState';

export { Button } from './ui/Button';
export { Field } from './ui/Field';
export { useDesignSystemFonts, DESIGN_SYSTEM_FONTS } from './fonts';
