/**
 * Confirmation tone → design-system colours, in ONE place.
 *
 * The receipt hero and the My Orders chip previously each carried their own
 * tone map, and they had already drifted: `danger` resolved to `colors.danger`
 * in one and `colors.red` in the other. Two maps for one concept is how a
 * "failed" order ends up a different red depending on which screen you are on.
 *
 * Tones deliberately do NOT include ember. Ember is the interactive colour — an
 * order state is something that happened to you, not something you can press.
 */
import { color } from '../../../design-system/generated/tokens';
import type { ConfirmationTone } from '../orderConfirmation';
import type { ChipTone } from '../../../design-system/ui/Chip';

export const TONE_COLOR: Record<ConfirmationTone, { bg: string; line: string; fg: string }> = {
  info: { bg: color.infoTint, line: color.infoLine, fg: color.sky },
  success: { bg: color.mintTint, line: color.mintLine, fg: color.mint },
  warning: { bg: color.warnTint, line: color.warnLine, fg: color.amberInk },
  danger: { bg: color.dangerTint, line: color.dangerLine, fg: color.danger },
};

/** The matching StatusPill tone, so a chip and a hero never disagree. */
export const TONE_CHIP: Record<ConfirmationTone, ChipTone> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};
