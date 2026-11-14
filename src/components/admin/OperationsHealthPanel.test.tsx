// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { OperationsHealthPanel } from './OperationsHealthPanel';
import {
  operationsHealth,
  unavailableOperationsHealthSummary,
  type OperationsHealthState,
  type OperationsHealthSummary,
} from '../../lib/operationsHealthApi';

function summaryWithPush(
  details: Record<string, unknown>,
  state: OperationsHealthState = 'degraded',
): OperationsHealthSummary {
  const base = unavailableOperationsHealthSummary('2026-07-22T00:00:00.000Z');
  return {
    ...base,
    overall_state: 'degraded',
    systems: base.systems.map((s) =>
      s.id === 'push'
        ? {
            ...s,
            state,
            source: 'configuration_and_send_ledger',
            details: { enabled: true, configured: true, active_devices: 0, ...details },
          }
        : s,
    ),
  };
}

function pushCard(lang: 'en' | 'ar') {
  return screen.getByLabelText(lang === 'ar' ? 'الإشعارات الفورية' : 'Push Notifications');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OperationsHealthPanel — push failure metrics', () => {
  it('shows failed deliveries and failed send events as separate labelled values (EN)', async () => {
    vi.spyOn(operationsHealth, 'summary').mockResolvedValue(
      summaryWithPush({ failed_deliveries_24h: 2, failed_send_events_24h: 1, failed_sends_24h: 2 }),
    );
    render(<OperationsHealthPanel lang="en" />);

    const deliveriesLabel = await screen.findByText('Failed deliveries 24h');
    const eventsLabel = screen.getByText('Failed send events 24h');
    expect(within(deliveriesLabel.closest('div') as HTMLElement).getByText('2')).toBeTruthy();
    expect(within(eventsLabel.closest('div') as HTMLElement).getByText('1')).toBeTruthy();
  });

  it('surfaces a zero-delivery lifecycle failure without a misleading single "0"', async () => {
    vi.spyOn(operationsHealth, 'summary').mockResolvedValue(
      summaryWithPush({ failed_deliveries_24h: 0, failed_send_events_24h: 1 }, 'degraded'),
    );
    render(<OperationsHealthPanel lang="en" />);

    const eventsLabel = await screen.findByText('Failed send events 24h');
    expect(within(eventsLabel.closest('div') as HTMLElement).getByText('1')).toBeTruthy();
    // Backend state is authoritative: the card stays Degraded even with 0 deliveries.
    expect(within(pushCard('en')).getByText('Degraded')).toBeTruthy();
  });

  it('falls back to the failed_sends_24h alias when the new fields are missing', async () => {
    vi.spyOn(operationsHealth, 'summary').mockResolvedValue(
      summaryWithPush({ failed_sends_24h: 3 }, 'degraded'),
    );
    render(<OperationsHealthPanel lang="en" />);

    const deliveriesLabel = await screen.findByText('Failed deliveries 24h');
    const eventsLabel = screen.getByText('Failed send events 24h');
    expect(within(deliveriesLabel.closest('div') as HTMLElement).getByText('3')).toBeTruthy();
    // Missing event field renders a safe 0 (not a crash).
    expect(within(eventsLabel.closest('div') as HTMLElement).getByText('0')).toBeTruthy();
  });

  it('normalizes negative / non-finite / malformed metric values without crashing', async () => {
    vi.spyOn(operationsHealth, 'summary').mockResolvedValue(
      summaryWithPush({
        failed_deliveries_24h: -5,
        failed_send_events_24h: Number.NaN,
        failed_sends_24h: 'x' as unknown as number,
      }),
    );
    render(<OperationsHealthPanel lang="en" />);

    const deliveriesLabel = await screen.findByText('Failed deliveries 24h');
    const eventsLabel = screen.getByText('Failed send events 24h');
    expect(within(deliveriesLabel.closest('div') as HTMLElement).getByText('0')).toBeTruthy();
    expect(within(eventsLabel.closest('div') as HTMLElement).getByText('0')).toBeTruthy();
  });

  it('renders Arabic RTL labels for both metrics', async () => {
    vi.spyOn(operationsHealth, 'summary').mockResolvedValue(
      summaryWithPush({ failed_deliveries_24h: 2, failed_send_events_24h: 1 }),
    );
    const { container } = render(<OperationsHealthPanel lang="ar" />);

    expect(await screen.findByText('إخفاقات التسليم 24س')).toBeTruthy();
    expect(screen.getByText('إخفاقات الإرسال 24س')).toBeTruthy();
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
  });
});

describe('OperationsHealthPanel — stale payment wording follows the server (PG-25)', () => {
  // The console ships on merge, before 20261013120000 is applied. The
  // settled-only wording may appear only when the snapshot proves that count.
  function summaryWithStale(paymentDetails: Record<string, unknown>): OperationsHealthSummary {
    const base = unavailableOperationsHealthSummary('2026-07-22T00:00:00.000Z');
    return {
      ...base,
      overall_state: 'degraded',
      systems: base.systems.map((s) =>
        s.id === 'payment'
          ? { ...s, state: 'degraded', source: 'configuration_and_ledger', details: { stale_initiated_24h: 1, ...paymentDetails } }
          : s,
      ),
      attention: [{ code: 'STALE_PAYMENT_INITIATIONS', subsystem: 'payment', severity: 'warning', count: 1, oldest_at: null }],
    };
  }

  it('keeps the old wording for a server without the migration', async () => {
    vi.spyOn(operationsHealth, 'summary').mockResolvedValue(summaryWithStale({}));
    render(<OperationsHealthPanel lang="en" />);
    expect(await screen.findByText('Payment attempts remained initiated for more than 30 minutes.')).toBeTruthy();
    expect(screen.queryByText(/went through at Moyasar/)).toBeNull();
  });

  it('uses the settled-only wording once the payment card carries open_unverified_24h', async () => {
    vi.spyOn(operationsHealth, 'summary').mockResolvedValue(summaryWithStale({ open_unverified_24h: 4 }));
    render(<OperationsHealthPanel lang="en" />);
    expect(
      await screen.findByText('A payment went through at Moyasar, but its order was not confirmed within 30 minutes.'),
    ).toBeTruthy();
    expect(screen.queryByText(/remained initiated/)).toBeNull();
  });
});
