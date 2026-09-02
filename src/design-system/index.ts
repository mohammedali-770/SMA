/**
 * "Ember on Cream" design system — admin console entry point.
 *
 * The console now renders entirely through this. The legacy utilities it
 * replaced are DELETED, and the hygiene guard fails the build if one reappears
 * anywhere in `src/`.
 *
 * NOTHING IMPORTS THIS BARREL (checked 2026-09-02): all 73 web consumers reach
 * into `./ui/*` and `./generated/*` directly, so read the line below as the
 * intended convention rather than a description of the code. It is kept as the
 * declared entry point and as the one place the surface is listed; do not assume
 * a symbol is unused merely because it is re-exported here.
 *
 * `generated/*` is written by `npm run design-system:sync` from the canonical
 * `design-system/` folder at the repo root. Do not hand-edit it — CI fails on
 * drift (`npm run design-system:check`).
 */
export * from './generated/tokens';
export * from './generated/money';
export * from './generated/buttonState';
export * from './generated/fieldState';

export { Button } from './ui/Button';
export { Field } from './ui/Field';
