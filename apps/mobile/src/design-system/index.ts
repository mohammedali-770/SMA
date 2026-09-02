/**
 * "Ember on Cream" design system — mobile entry point.
 *
 * NOTHING IMPORTS THIS BARREL (checked 2026-09-02). All 69 mobile consumers
 * reach into `./ui/*` and `./generated/*` directly, which is what the note below
 * about test purity pushes them towards. It is kept as the declared entry point
 * and as the one place the surface is listed; do not assume a symbol is unused
 * merely because it is re-exported here.
 *
 * The header used to say `src/theme.ts` remained authoritative and that screens
 * would migrate in a follow-up PR. Both are stale: that file no longer exists
 * (theming is `src/theme/`), and the migration happened — see MIGRATED_SURFACES
 * in scripts/check-design-system-hygiene.mjs.
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
export { Card } from './ui/Card';
export { Field } from './ui/Field';
export { Text } from './ui/Text';
export { useDesignSystemFonts, DESIGN_SYSTEM_FONTS } from './fonts';
