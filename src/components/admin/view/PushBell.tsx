/**
 * The closure-alerts control in the console header — PRESENTATION ONLY.
 *
 * It renders one of seven states and decides none of them. The important design
 * point is that only two of the seven are a BUTTON: the other five are
 * conditions the admin cannot fix by clicking, so they render as a static,
 * non-interactive chip carrying the sentence that says what to actually do.
 * Offering a tappable bell to someone on an iPhone in Safari — where no amount
 * of tapping can ever work — is how a feature earns a reputation for being
 * broken.
 */
import React from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';

import { isActionable, type AdminPushState } from '../../../lib/pwa/adminPushState';

export interface PushBellLabels {
  on: string;
  off: string;
  busy: string;
  denied: string;
  notConfigured: string;
  needsInstall: string;
  needsReinstall: string;
  unsupported: string;
  failed: string;
}

export function pushBellLabel(
  state: AdminPushState,
  busy: boolean,
  error: string | null,
  l: PushBellLabels,
): string {
  if (busy) return l.busy;
  if (error) return l.failed;
  switch (state) {
    case 'on':
      return l.on;
    case 'off':
      return l.off;
    case 'denied':
      return l.denied;
    case 'not-configured':
      return l.notConfigured;
    case 'needs-install':
      return l.needsInstall;
    case 'needs-reinstall':
      return l.needsReinstall;
    case 'unsupported':
      return l.unsupported;
  }
}

export function PushBell({
  state,
  busy,
  error,
  onToggle,
  labels,
}: {
  state: AdminPushState;
  busy: boolean;
  error: string | null;
  onToggle: () => void;
  labels: PushBellLabels;
}) {
  const label = pushBellLabel(state, busy, error, labels);
  const shell = [
    'ds-motion inline-flex size-11 items-center justify-center rounded-[var(--radius-ds-md)]',
    'border transition-colors duration-150',
  ].join(' ');

  if (!isActionable(state)) {
    // Not a button: nothing here responds to a click. The title carries the
    // remedy, and aria-disabled keeps it out of the tab order's promises.
    return (
      <span
        className={`${shell} border-con-line bg-con-surface-2 text-con-text-3`}
        title={label}
        aria-label={label}
        aria-disabled="true"
        data-testid="push-bell-static"
        data-state={state}
      >
        <BellOff className="size-4" aria-hidden="true" />
      </span>
    );
  }

  const on = state === 'on';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      title={label}
      aria-label={label}
      aria-pressed={on}
      data-testid="push-bell"
      data-state={state}
      className={[
        shell,
        'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60',
        on ? 'border-mint-line bg-mint-tint text-mint' : 'border-con-line bg-con-surface-2 text-con-text-2',
      ].join(' ')}
    >
      {on ? (
        <BellRing className="size-4" aria-hidden="true" />
      ) : (
        <Bell className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
