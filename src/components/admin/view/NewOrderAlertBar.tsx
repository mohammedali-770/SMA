/**
 * The new-order alert strip — PRESENTATION ONLY.
 *
 * Ember, full-bleed, above everything: this is the one thing in the console
 * that must interrupt. It is also the one place a pulse animation earns its
 * keep, because a kitchen screen is watched from across a room.
 *
 * The pulse is gated behind `motion-safe`, so an operator who has asked their
 * OS for reduced motion gets the colour without the throb — the information is
 * in the bar, not the animation.
 */
import React from 'react';
import { Volume2 } from 'lucide-react';

import { Text } from '../../../design-system/ui/Text';

export function NewOrderAlertBar({
  message,
  dismissLabel,
  onDismiss,
  replayLabel,
  onReplay,
}: {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
  /** Omitted when sound is muted — there is nothing to replay. */
  replayLabel?: string;
  onReplay?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="assertive"
      className="z-40 flex items-center justify-between gap-3 bg-ember p-3.5 motion-safe:animate-pulse"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Volume2 className="size-5 shrink-0 text-on-ember" aria-hidden="true" />
        <Text variant="label" tone="onEmber" as="span">{message}</Text>
      </span>

      <span className="flex shrink-0 gap-2">
        {onReplay && replayLabel ? (
          <button
            type="button"
            onClick={onReplay}
            className="ds-motion min-h-8 rounded-[var(--radius-ds-sm)] bg-on-ember/20 px-3 transition-colors hover:bg-on-ember/30 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Text variant="caption" tone="onEmber" as="span">🔔 {replayLabel}</Text>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="ds-motion min-h-8 rounded-[var(--radius-ds-sm)] bg-on-ember px-3 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Text variant="caption" tone="ember" as="span">{dismissLabel}</Text>
        </button>
      </span>
    </div>
  );
}
