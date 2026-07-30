/**
 * "Ember on Cream" design system — admin console entry point.
 *
 * ADDITIVE. Existing panels keep their current tokens and `.glass-*` classes;
 * nothing here restyles a shipped screen. Import from '@/design-system' (or a
 * relative path) rather than reaching into `generated/`.
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
