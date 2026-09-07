// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OperationsAlertsPanel } from './OperationsAlertsPanel';
import {
  operationsAlerts,
  type OperationsAlert,
  type OperationsAlertsSummary,
  type OperationsAlertSettings,
  type OperationsDigest,
} from '../../lib/operationsAlertsApi';

function makeSummary(overrides: Partial<OperationsAlertsSummary> = {}): OperationsAlertsSummary {
  return {
    generated_at: '2026-07-22T10:00:00Z',
    open_critical_count: 0,
    open_warning_count: 0,
    open_total: 0,
    open_baseline_count: 0,
    recovered_last_24h: 0,
    last_evaluation: null,
    last_digest: null,
    alert_evaluation_enabled: false,
    digest_generation_enabled: false,
    external_dispatch_enabled: false,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<OperationsAlert> = {}): OperationsAlert {
  return {
    id: 'a1',
    fingerprint: 'push:failed_deliveries',
    subsystem: 'push',
    condition_code: 'failed_deliveries',
    severity: 'critical',
    status: 'open',
    generation: 1,
    baseline: false,
    first_seen_at: '2026-07-22T08:00:00Z',
    last_seen_at: '2026-07-22T09:00:00Z',
    occurrence_count: 3,
    last_notified_at: '2026-07-22T08:00:00Z',
    last_reminder_at: null,
    recovered_at: null,
    safe_evidence: { failed_count: 2 },
    ...overrides,
  };
}

function makeDigest(overrides: Partial<OperationsDigest> = {}): OperationsDigest {
  return {
    scope: 'daily',
    digest_date: '2026-07-21',
    language: 'en',
    timezone: 'Asia/Riyadh',
    period_start_utc: '2026-07-20T21:00:00Z',
    period_end_utc: '2026-07-21T21:00:00Z',
    overall_state: 'healthy',
    opened_count: 0,
    recovered_count: 0,
    unresolved_count: 0,
    critical_open_count: 0,
    warning_open_count: 0,
    content: {},
    rendered_subject: 'Daily operations digest — 2026-07-21',
    rendered_body: 'No incidents in this period.\nExternal delivery is disabled in this version.',
    preview: false,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<OperationsAlertSettings> = {}): OperationsAlertSettings {
  return {
    alert_evaluation_enabled: false,
    digest_generation_enabled: false,
    external_dispatch_enabled: false,
    timezone: 'Asia/Riyadh',
    digest_local_time: '08:00:00',
    warning_reminder_minutes: 1440,
    critical_reminder_minutes: 240,
    recovery_notifications_enabled: true,
    optional_system_alerts_enabled: false,
    system_rule_overrides: {},
    updated_at: null,
    ...overrides,
  };
}

function mockInbox(summary: OperationsAlertsSummary, alerts: OperationsAlert[]) {
  vi.spyOn(operationsAlerts, 'summary').mockResolvedValue(summary);
  vi.spyOn(operationsAlerts, 'list').mockResolvedValue(alerts);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OperationsAlertsPanel — summary + inbox', () => {
  it('renders summary counts and the alerts inbox (EN)', async () => {
    mockInbox(
      makeSummary({ open_critical_count: 1, open_warning_count: 2, open_total: 3, recovered_last_24h: 4 }),
      [makeAlert()],
    );
    render(<OperationsAlertsPanel lang="en" />);

    const criticalLabel = await screen.findByText('Open critical');
    expect(within(criticalLabel.closest('div') as HTMLElement).getByText('1')).toBeTruthy();
    const warningLabel = screen.getByText('Open warnings');
    expect(within(warningLabel.closest('div') as HTMLElement).getByText('2')).toBeTruthy();
    const recoveredLabel = screen.getByText('Recovered 24h');
    expect(within(recoveredLabel.closest('div') as HTMLElement).getByText('4')).toBeTruthy();

    // Alert row: subsystem label + condition code + severity + status badges.
    // Scope to the row (the filter <option>s repeat some of these labels).
    const code = await screen.findByText('failed_deliveries');
    const row = code.closest('button') as HTMLElement;
    expect(within(row).getByText('Push Notifications')).toBeTruthy();
    expect(within(row).getByText('Critical')).toBeTruthy();
    expect(within(row).getByText('Open')).toBeTruthy();
  });

  // The badge used to be hardcoded and this test asserted it "always" showed.
  // It is now derived, because the header answers "is production email going out
  // right now?" and hardcoding that answer survived three separate changes.
  it('shows the disabled badge when dispatch is off, plus the dormant evaluator notice', async () => {
    mockInbox(makeSummary(), []);
    render(<OperationsAlertsPanel lang="en" />);

    expect(await screen.findByText('External delivery disabled')).toBeTruthy();
    expect(
      await screen.findByText('The evaluator is not enabled yet (dormant mode). No new alerts are being produced.'),
    ).toBeTruthy();
  });

  it('shows the ON badge and drops the "no external messages" claim when dispatch is enabled', async () => {
    mockInbox(makeSummary({ external_dispatch_enabled: true }), []);
    render(<OperationsAlertsPanel lang="en" />);

    expect(await screen.findByText('External delivery ON (email)')).toBeTruthy();
    expect(screen.queryByText('External delivery disabled')).toBeNull();
    expect(
      screen.getByText('Read-only observability: no auto-remediation, no retries — but external dispatch is ON, and critical alerts are emailed.'),
    ).toBeTruthy();
  });

  it('renders a truthful empty state when no alerts match', async () => {
    mockInbox(makeSummary(), []);
    render(<OperationsAlertsPanel lang="en" />);

    expect(await screen.findByText('No alerts match the current filters.')).toBeTruthy();
  });

  it('fails visibly when the backend read fails — never a false healthy state', async () => {
    vi.spyOn(operationsAlerts, 'summary').mockRejectedValue(new Error('permission denied'));
    vi.spyOn(operationsAlerts, 'list').mockRejectedValue(new Error('permission denied'));
    render(<OperationsAlertsPanel lang="en" />);

    expect(await screen.findByText('permission denied')).toBeTruthy();
    // Counts fall back to em-dash placeholders, not zeros pretending to be healthy.
    const criticalLabel = screen.getByText('Open critical');
    expect(within(criticalLabel.closest('div') as HTMLElement).getByText('—')).toBeTruthy();
  });

  it('re-queries the list when a filter changes', async () => {
    mockInbox(makeSummary(), []);
    const list = vi.mocked(operationsAlerts.list);
    render(<OperationsAlertsPanel lang="en" />);
    await screen.findByText('No alerts match the current filters.');

    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'recovered' } });
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'recovered' }));
    });

    fireEvent.change(screen.getByLabelText('Filter severity'), { target: { value: 'critical' } });
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
    });

    fireEvent.change(screen.getByLabelText('Filter subsystem'), { target: { value: 'payment' } });
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ subsystem: 'payment' }));
    });
  });

  it('expands an alert to load its timeline lazily', async () => {
    mockInbox(makeSummary({ open_critical_count: 1, open_total: 1 }), [makeAlert()]);
    const timeline = vi.spyOn(operationsAlerts, 'timeline').mockResolvedValue({
      alert: makeAlert(),
      events: [
        {
          id: 'e1',
          event_type: 'opened',
          severity: 'critical',
          notification_suppressed: false,
          safe_evidence: {},
          created_at: '2026-07-22T08:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'reminder',
          severity: 'critical',
          notification_suppressed: true,
          safe_evidence: {},
          created_at: '2026-07-22T09:00:00Z',
        },
      ],
    });
    render(<OperationsAlertsPanel lang="en" />);

    const code = await screen.findByText('failed_deliveries');
    expect(timeline).not.toHaveBeenCalled();
    fireEvent.click(code.closest('button') as HTMLElement);

    expect(await screen.findByText('Opened')).toBeTruthy();
    expect(screen.getByText('Reminder')).toBeTruthy();
    expect(screen.getByText('(notification suppressed)')).toBeTruthy();
    expect(screen.getByText('push:failed_deliveries')).toBeTruthy();
    expect(timeline).toHaveBeenCalledWith('a1');
  });

  it('offers no operational action buttons (read-only surface)', async () => {
    mockInbox(makeSummary({ open_critical_count: 1, open_total: 1 }), [makeAlert()]);
    render(<OperationsAlertsPanel lang="en" />);
    await screen.findByText('failed_deliveries');

    for (const label of ['Acknowledge', 'Suppress', 'Retry', 'Resolve', 'Send', 'Dispatch']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.getByText('Read-only observability: no auto-remediation, no retries, no external messages.')).toBeTruthy();
  });

  it('renders Arabic labels and RTL direction', async () => {
    mockInbox(
      makeSummary({ open_critical_count: 1, open_total: 1 }),
      [makeAlert({ severity: 'warning', status: 'recovered' })],
    );
    const { container } = render(<OperationsAlertsPanel lang="ar" />);

    expect(await screen.findByText('تنبيهات العمليات والملخص اليومي')).toBeTruthy();
    expect(screen.getByText('الإرسال الخارجي معطل')).toBeTruthy();
    const code = await screen.findByText('failed_deliveries');
    const row = code.closest('button') as HTMLElement;
    expect(within(row).getByText('الإشعارات الفورية')).toBeTruthy();
    expect(within(row).getByText('تحذير')).toBeTruthy();
    expect(within(row).getByText('تعافى')).toBeTruthy();
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
  });
});

describe('OperationsAlertsPanel — daily digest', () => {
  function mockDigest(preview: OperationsDigest, history: OperationsDigest[]) {
    mockInbox(makeSummary(), []);
    vi.spyOn(operationsAlerts, 'digestPreview').mockResolvedValue(preview);
    vi.spyOn(operationsAlerts, 'digestList').mockResolvedValue(history);
  }

  it('shows the English preview and generated history', async () => {
    mockDigest(makeDigest({ preview: true }), [makeDigest(), makeDigest({ language: 'ar', rendered_body: 'لا توجد حوادث خلال هذه الفترة.' })]);
    render(<OperationsAlertsPanel lang="en" />);
    fireEvent.click(await screen.findByText('Daily digest'));

    expect(await screen.findByText('Daily operations digest — 2026-07-21')).toBeTruthy();
    expect(screen.getByText(/No incidents in this period\./)).toBeTruthy();
    expect(screen.getByText(/External delivery is disabled in this version\./)).toBeTruthy();
    // History rows: one date per language.
    expect(screen.getAllByText('2026-07-21').length).toBe(2);
  });

  it('switches the preview to Arabic and renders it RTL', async () => {
    mockDigest(makeDigest({ preview: true }), []);
    const previewSpy = vi.mocked(operationsAlerts.digestPreview);
    render(<OperationsAlertsPanel lang="en" />);
    fireEvent.click(await screen.findByText('Daily digest'));
    await screen.findByText('Daily operations digest — 2026-07-21');

    previewSpy.mockResolvedValue(makeDigest({
      preview: true,
      language: 'ar',
      rendered_subject: 'ملخص العمليات اليومي — 2026-07-21',
      rendered_body: 'لا توجد حوادث خلال هذه الفترة.',
    }));
    fireEvent.click(screen.getByText('AR'));

    const subject = await screen.findByText('ملخص العمليات اليومي — 2026-07-21');
    expect(previewSpy).toHaveBeenLastCalledWith('ar');
    expect((subject.closest('[dir]') as HTMLElement).getAttribute('dir')).toBe('rtl');
  });

  it('explains an empty history truthfully (generation dormant)', async () => {
    mockDigest(makeDigest({ preview: true }), []);
    render(<OperationsAlertsPanel lang="en" />);
    fireEvent.click(await screen.findByText('Daily digest'));

    expect(await screen.findByText('No stored digests yet — scheduled generation is not enabled in this version.')).toBeTruthy();
  });

  it('surfaces digest load failures', async () => {
    mockInbox(makeSummary(), []);
    vi.spyOn(operationsAlerts, 'digestPreview').mockRejectedValue(new Error('digest preview failed'));
    vi.spyOn(operationsAlerts, 'digestList').mockRejectedValue(new Error('digest preview failed'));
    render(<OperationsAlertsPanel lang="en" />);
    fireEvent.click(await screen.findByText('Daily digest'));

    expect(await screen.findByText('digest preview failed')).toBeTruthy();
  });
});

describe('OperationsAlertsPanel — settings', () => {
  function mockSettings(settings: OperationsAlertSettings) {
    mockInbox(makeSummary(), []);
    vi.spyOn(operationsAlerts, 'settingsGet').mockResolvedValue({
      settings,
      last_evaluation_run: null,
      last_digest_run: null,
    });
  }

  it('renders read-only settings for non-admin staff', async () => {
    mockSettings(makeSettings());
    render(<OperationsAlertsPanel lang="en" />);
    fireEvent.click(await screen.findByText('Settings'));

    expect(await screen.findByText('Read-only view — only admins can change these settings.')).toBeTruthy();
    // A disabled input is inert in a real browser (jsdom fireEvent bypasses the
    // disabled attribute, so the attribute itself is the meaningful assertion).
    for (const label of [
      'Alert evaluation enabled',
      'Digest generation enabled',
      'Recovery notifications',
      'Optional-system alerts',
    ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
    }

    const tzLabel = screen.getByText('Timezone');
    expect(within(tzLabel.closest('div') as HTMLElement).getByText('Asia/Riyadh')).toBeTruthy();
  });

  it('lets an admin toggle a whitelisted flag via the settings RPC', async () => {
    mockSettings(makeSettings());
    const update = vi.spyOn(operationsAlerts, 'settingsUpdate')
      .mockResolvedValue(makeSettings({ alert_evaluation_enabled: true }));
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    fireEvent.click(await screen.findByText('Settings'));

    const evalToggle = await screen.findByLabelText('Alert evaluation enabled') as HTMLInputElement;
    expect(evalToggle.disabled).toBe(false);
    fireEvent.click(evalToggle);

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ alert_evaluation_enabled: true });
    });
    expect(await screen.findByText('Settings saved.')).toBeTruthy();
  });

  // REGRESSION (#332). This test used to assert the opposite -- that the
  // external-dispatch toggle stays disabled even for admins -- and it PASSED
  // while pinning a control that had become the only thing preventing X3 from
  // being completed. The backend stopped refusing the flag on 2026-09-07
  // (20260903120000), the dispatcher was deployed, and pg_cron began calling it;
  // only this checkbox still said no. A test that pins a deliberate limitation
  // has to be revisited when the limitation is lifted, or it quietly becomes the
  // limitation itself.
  it('lets an admin turn external dispatch on, and sends the patch', async () => {
    mockSettings(makeSettings());
    const update = vi.spyOn(operationsAlerts, 'settingsUpdate')
      .mockResolvedValue(makeSettings({ external_dispatch_enabled: true }));
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    fireEvent.click(await screen.findByText('Settings'));
    await screen.findByText('External dispatch (email)');

    const external = screen.getByLabelText('external dispatch') as HTMLInputElement;
    expect(external.disabled).toBe(false);
    expect(external.checked).toBe(false);

    fireEvent.click(external);
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ external_dispatch_enabled: true });
    });

    // The header must follow immediately. This is why the pill reads `settings`
    // BEFORE `summary`: only `settings` is refreshed by saveSettings, so with the
    // other precedence the badge would still say "disabled" for the rest of the
    // session while real email went out.
    expect(await screen.findByText('External delivery ON (email)')).toBeTruthy();
    expect(screen.queryByText('External delivery disabled')).toBeNull();
  });

  it('reflects external dispatch already being on, and can turn it back off', async () => {
    mockSettings(makeSettings({ external_dispatch_enabled: true }));
    const update = vi.spyOn(operationsAlerts, 'settingsUpdate')
      .mockResolvedValue(makeSettings({ external_dispatch_enabled: false }));
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    fireEvent.click(await screen.findByText('Settings'));

    const external = await screen.findByLabelText('external dispatch') as HTMLInputElement;
    expect(external.checked).toBe(true);

    fireEvent.click(external);
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ external_dispatch_enabled: false });
    });
  });

  it('refuses the external-dispatch toggle to a non-admin', async () => {
    mockSettings(makeSettings());
    render(<OperationsAlertsPanel lang="en" isAdmin={false} />);
    fireEvent.click(await screen.findByText('Settings'));

    const external = await screen.findByLabelText('external dispatch') as HTMLInputElement;
    expect(external.disabled).toBe(true);
  });

  // The fixture used to be 'external dispatch cannot be enabled in this version',
  // the v1 refusal that 20260903120000 removed. The test passed either way -- it
  // only checks that a rejection reaches the operator verbatim -- but an error
  // the backend can no longer raise is a misleading thing to leave in a test.
  // MFA is the realistic refusal now: the RPC requires AAL2, so an admin who has
  // not completed TOTP is turned away here exactly as they are by RLS.
  it('shows the backend rejection message when a save fails', async () => {
    mockSettings(makeSettings());
    vi.spyOn(operationsAlerts, 'settingsUpdate')
      .mockRejectedValue(new Error('This action requires two-factor authentication.'));
    render(<OperationsAlertsPanel lang="en" isAdmin />);
    fireEvent.click(await screen.findByText('Settings'));

    const evalToggle = await screen.findByLabelText('Alert evaluation enabled');
    fireEvent.click(evalToggle);

    expect(await screen.findByText('This action requires two-factor authentication.')).toBeTruthy();
  });
});
