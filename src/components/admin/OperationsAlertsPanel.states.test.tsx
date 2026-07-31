// @vitest-environment jsdom
/**
 * Operations Alerts — the states the frozen suite does not reach.
 *
 * `OperationsAlertsPanel.test.tsx` predates this migration, was written against
 * the legacy panel, and passes verbatim against the migrated one. It is left
 * untouched on purpose: it is the before/after behavioural contract, and a test
 * you edited to make pass is not evidence of anything.
 *
 * What it does NOT cover, and what is here instead, are the transient and
 * failure states: in-flight loads, a timeline mid-fetch, a timeline whose fetch
 * FAILED, the closed-tab states that prove the digest and settings sections do
 * not fetch until opened, saving, a half-failed load, and the absence of a
 * polling timer.
 *
 * Every case is a function of a fixed fixture — no network, no wall clock.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { operationsAlerts } from '../../lib/operationsAlertsApi';
import { OperationsAlertsPanel } from './OperationsAlertsPanel';
import {
  alertFixture, digestFixture, eventFixture, settingsBundleFixture,
  settingsFixture, summaryFixture,
} from './view/alerts/alertsFixtures';

/** A promise that never settles — the "still fetching" state. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function stubHappyPath() {
  vi.spyOn(operationsAlerts, 'summary').mockResolvedValue(summaryFixture());
  vi.spyOn(operationsAlerts, 'list').mockResolvedValue([alertFixture()]);
  vi.spyOn(operationsAlerts, 'timeline').mockResolvedValue({
    alert: alertFixture(), events: [eventFixture()],
  });
  vi.spyOn(operationsAlerts, 'digestPreview').mockResolvedValue(digestFixture({ preview: true }));
  vi.spyOn(operationsAlerts, 'digestList').mockResolvedValue([digestFixture()]);
  vi.spyOn(operationsAlerts, 'settingsGet').mockResolvedValue(settingsBundleFixture());
  vi.spyOn(operationsAlerts, 'settingsUpdate')
    .mockResolvedValue(settingsFixture({ digest_generation_enabled: true }));
}

const toggleFor = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;

beforeEach(stubHappyPath);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('in-flight states', () => {
  it('shows the inbox as loading while the first fetch is open', () => {
    vi.spyOn(operationsAlerts, 'summary').mockReturnValue(pending());
    vi.spyOn(operationsAlerts, 'list').mockReturnValue(pending());
    render(<OperationsAlertsPanel lang="en" />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No alerts match the current filters.')).toBeNull();
  });

  it('shows the settings as loading while settingsGet is open', async () => {
    vi.spyOn(operationsAlerts, 'settingsGet').mockReturnValue(pending());
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    fireEvent.click(await screen.findByText('Settings'));
    expect(await screen.findByText('Loading…')).toBeTruthy();
  });

  it('shows the digest as building while the preview is open', async () => {
    vi.spyOn(operationsAlerts, 'digestPreview').mockReturnValue(pending());
    render(<OperationsAlertsPanel lang="en" />);
    fireEvent.click(await screen.findByText('Daily digest'));
    expect(await screen.findByText('Building preview…')).toBeTruthy();
  });
});

describe('timeline states', () => {
  const openRow = async () => {
    const code = await screen.findByText('TAP_WEBHOOK_LATENCY');
    fireEvent.click(code.closest('button') as HTMLElement);
  };

  it('closed: nothing is fetched and no events are on screen', async () => {
    const timeline = vi.spyOn(operationsAlerts, 'timeline');
    render(<OperationsAlertsPanel lang="en" />);
    await screen.findByText('TAP_WEBHOOK_LATENCY');
    expect(timeline).not.toHaveBeenCalled();
    expect(screen.queryByText('Opened')).toBeNull();
  });

  it('loading: a spinner line, not an empty timeline', async () => {
    // Rendering "No events." while the fetch is still open would tell the
    // operator the alert has no history when nobody knows yet.
    vi.spyOn(operationsAlerts, 'timeline').mockReturnValue(pending());
    render(<OperationsAlertsPanel lang="en" />);
    await openRow();
    expect(await screen.findByText('Loading timeline…')).toBeTruthy();
    expect(screen.queryByText('No events.')).toBeNull();
  });

  it('loaded but empty: says so', async () => {
    vi.spyOn(operationsAlerts, 'timeline')
      .mockResolvedValue({ alert: alertFixture(), events: [] });
    render(<OperationsAlertsPanel lang="en" />);
    await openRow();
    expect(await screen.findByText('No events.')).toBeTruthy();
  });

  it('FAILED: reads "No events." instead of spinning forever', async () => {
    // The panel caches [] on a failed fetch. Preserved from the original: a
    // permanent spinner is the one outcome an operator cannot act on.
    vi.spyOn(operationsAlerts, 'timeline').mockRejectedValue(new Error('timeline down'));
    render(<OperationsAlertsPanel lang="en" />);
    await openRow();
    expect(await screen.findByText('No events.')).toBeTruthy();
    expect(screen.queryByText('Loading timeline…')).toBeNull();
  });

  it('collapses on a second click, and reopening does not refetch', async () => {
    const timeline = vi.spyOn(operationsAlerts, 'timeline');
    render(<OperationsAlertsPanel lang="en" />);
    await openRow();
    await screen.findByText('Opened');
    await openRow();
    await waitFor(() => expect(screen.queryByText('Opened')).toBeNull());
    await openRow();
    await screen.findByText('Opened');
    expect(timeline).toHaveBeenCalledTimes(1);
  });
});

describe('sections do not fetch until opened', () => {
  it('the digest tab is inert while closed', async () => {
    // digestPreview renders a full daily summary server-side; doing that for an
    // operator who never opens the tab is work nobody asked for.
    const preview = vi.spyOn(operationsAlerts, 'digestPreview');
    const history = vi.spyOn(operationsAlerts, 'digestList');
    render(<OperationsAlertsPanel lang="en" />);
    await screen.findByText('TAP_WEBHOOK_LATENCY');
    expect(preview).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it('the settings tab is inert while closed', async () => {
    const get = vi.spyOn(operationsAlerts, 'settingsGet');
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    await screen.findByText('TAP_WEBHOOK_LATENCY');
    expect(get).not.toHaveBeenCalled();
  });

  it('opening the digest asks for exactly 30 stored digests', async () => {
    const history = vi.spyOn(operationsAlerts, 'digestList');
    render(<OperationsAlertsPanel lang="en" />);
    fireEvent.click(await screen.findByText('Daily digest'));
    await waitFor(() => expect(history).toHaveBeenCalledWith(30));
  });
});

describe('load payload and failure', () => {
  it('asks for 200 rows with unset filters as null, never as empty strings', async () => {
    const list = vi.spyOn(operationsAlerts, 'list');
    render(<OperationsAlertsPanel lang="en" />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list.mock.calls[0][0]).toEqual({
      status: 'open', severity: null, subsystem: null, limit: 200,
    });
  });

  it('a PARTIAL failure fails the whole load — no rows under a blank header', async () => {
    // list() succeeded here. Showing its rows beside an empty summary would
    // invite the operator to read the two as consistent.
    vi.spyOn(operationsAlerts, 'summary').mockRejectedValue(new Error('summary down'));
    render(<OperationsAlertsPanel lang="en" />);
    expect(await screen.findByText('summary down')).toBeTruthy();
    expect(screen.queryByText('TAP_WEBHOOK_LATENCY')).toBeNull();
  });

  it('the inverse partial failure behaves the same way', async () => {
    vi.spyOn(operationsAlerts, 'list').mockRejectedValue(new Error('list down'));
    render(<OperationsAlertsPanel lang="en" />);
    expect(await screen.findByText('list down')).toBeTruthy();
    expect(screen.queryByText('TAP_WEBHOOK_LATENCY')).toBeNull();
  });

  it('keeps an UNKNOWN subsystem and severity visible', async () => {
    // A subsystem the console has not learned yet must stay identifiable, or
    // its alerts appear attributed to nothing. An unknown severity reads as
    // Info — not silently promoted to critical, not dropped.
    vi.spyOn(operationsAlerts, 'list').mockResolvedValue([alertFixture({
      subsystem: 'brand_new_subsystem',
      severity: 'nonsense' as 'critical',
    })]);
    render(<OperationsAlertsPanel lang="en" />);
    const code = await screen.findByText('TAP_WEBHOOK_LATENCY');
    const row = code.closest('button') as HTMLElement;
    expect(row.textContent).toContain('brand_new_subsystem');
    expect(row.textContent).toContain('Info');
  });
});

describe('saving', () => {
  const openSettings = async () => {
    fireEvent.click(await screen.findByText('Settings'));
    await screen.findByLabelText('Optional-system alerts');
  };

  it('disables the OTHER controls while a save is in flight', async () => {
    vi.spyOn(operationsAlerts, 'settingsUpdate').mockReturnValue(pending());
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    await openSettings();
    expect(toggleFor('Optional-system alerts').disabled).toBe(false);
    fireEvent.click(toggleFor('Recovery notifications'));
    await waitFor(() =>
      expect(toggleFor('Optional-system alerts').disabled).toBe(true));
  });

  it('a FAILED save re-enables the controls and says why', async () => {
    // Leaving the panel permanently disabled after a rejected save would make
    // one 42501 the end of the session.
    vi.spyOn(operationsAlerts, 'settingsUpdate')
      .mockRejectedValue(new Error('permission denied'));
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    await openSettings();
    fireEvent.click(toggleFor('Recovery notifications'));
    expect(await screen.findByText('permission denied')).toBeTruthy();
    await waitFor(() =>
      expect(toggleFor('Optional-system alerts').disabled).toBe(false));
  });

  it('a settings LOAD failure is surfaced, not swallowed', async () => {
    vi.spyOn(operationsAlerts, 'settingsGet').mockRejectedValue(new Error('settings down'));
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    fireEvent.click(await screen.findByText('Settings'));
    expect(await screen.findByText('settings down')).toBeTruthy();
  });
});

describe('the absences that are the contract', () => {
  it('does not poll: ten minutes of timers produce no further fetch', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.spyOn(operationsAlerts, 'list');
      render(<OperationsAlertsPanel lang="en" />);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(list).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an expanded alert offers no acknowledge control', async () => {
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    const code = await screen.findByText('TAP_WEBHOOK_LATENCY');
    fireEvent.click(code.closest('button') as HTMLElement);
    await screen.findByText('Opened');
    expect(screen.queryByRole('button',
      { name: /acknowledge|resolve|dismiss|retry|resend/i })).toBeNull();
  });
});
