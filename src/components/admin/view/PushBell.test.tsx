// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { PushBell, pushBellLabel, type PushBellLabels } from './PushBell';
import type { AdminPushState } from '../../../lib/pwa/adminPushState';

const labels: PushBellLabels = {
  on: 'ON',
  off: 'OFF',
  busy: 'BUSY',
  denied: 'DENIED',
  notConfigured: 'NOT_CONFIGURED',
  needsInstall: 'NEEDS_INSTALL',
  needsReinstall: 'NEEDS_REINSTALL',
  unsupported: 'UNSUPPORTED',
  failed: 'FAILED',
};

afterEach(cleanup);

const ALL: AdminPushState[] = [
  'on',
  'off',
  'denied',
  'not-configured',
  'needs-install',
  'needs-reinstall',
  'unsupported',
];

describe('pushBellLabel', () => {
  it('gives every state its own sentence', () => {
    const seen = ALL.map((s) => pushBellLabel(s, false, null, labels));
    expect(new Set(seen).size).toBe(ALL.length);
    expect(seen).not.toContain(undefined);
  });

  it('shows busy ahead of everything, so a slow tap is never silent', () => {
    expect(pushBellLabel('off', true, null, labels)).toBe('BUSY');
    expect(pushBellLabel('on', true, 'boom', labels)).toBe('BUSY');
  });

  it('shows the failure ahead of the state once the work has stopped', () => {
    expect(pushBellLabel('off', false, 'boom', labels)).toBe('FAILED');
  });
});

describe('PushBell', () => {
  it('is a real button when the admin can act, and toggles', () => {
    const onToggle = vi.fn();
    render(<PushBell state="off" busy={false} error={null} onToggle={onToggle} labels={labels} />);
    const btn = screen.getByTestId('push-bell');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('marks itself pressed when alerts are on', () => {
    render(<PushBell state="on" busy={false} error={null} onToggle={vi.fn()} labels={labels} />);
    expect(screen.getByTestId('push-bell').getAttribute('aria-pressed')).toBe('true');
  });

  it('is NOT a button in any state a tap cannot fix', () => {
    // The whole point: offering a tappable bell on an iPhone in Safari, where no
    // amount of tapping can work, is how a feature gets a reputation for being
    // broken. These five render as a static chip carrying the remedy instead.
    for (const state of [
      'denied',
      'not-configured',
      'needs-install',
      'needs-reinstall',
      'unsupported',
    ] as const) {
      const { unmount } = render(
        <PushBell state={state} busy={false} error={null} onToggle={vi.fn()} labels={labels} />,
      );
      expect(screen.queryByTestId('push-bell')).toBeNull();
      const chip = screen.getByTestId('push-bell-static');
      expect(chip.tagName).not.toBe('BUTTON');
      expect(chip.getAttribute('aria-disabled')).toBe('true');
      unmount();
    }
  });

  it("carries the remedy for the admin's actual starting state", () => {
    // A Home Screen entry added before the manifest existed: the ONLY fix is to
    // remove and re-add it, and the control has to say so.
    render(<PushBell state="needs-reinstall" busy={false} error={null} onToggle={vi.fn()} labels={labels} />);
    expect(screen.getByTestId('push-bell-static').getAttribute('aria-label')).toBe('NEEDS_REINSTALL');
  });

  it('cannot be double-fired while a toggle is in flight', () => {
    const onToggle = vi.fn();
    render(<PushBell state="off" busy error={null} onToggle={onToggle} labels={labels} />);
    const btn = screen.getByTestId('push-bell');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('labels itself for a screen reader in every state', () => {
    for (const state of ALL) {
      const { unmount } = render(
        <PushBell state={state} busy={false} error={null} onToggle={vi.fn()} labels={labels} />,
      );
      const el = screen.queryByTestId('push-bell') ?? screen.getByTestId('push-bell-static');
      expect(el.getAttribute('aria-label')).toBeTruthy();
      unmount();
    }
  });
});
