/**
 * "Ember on Cream" design system — admin console entry point.
 *
 * The console now renders entirely through this. The legacy utilities it
 * replaced are DELETED, and the hygiene guard fails the build if one reappears
 * anywhere in `src/`. Import from '@/design-system' (or a relative path)
 * rather than reaching into `generated/`.
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
