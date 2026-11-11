// @vitest-environment jsdom
/**
 * The Moyasar readiness panel against the two servers it can meet.
 *
 * The console deploys on merge; the payment Edge Functions do not. So this
 * panel talks to the Moyasar-only payment-test-config in this repository AND to
 * the 2026-07-12 bundle still deployed in Production, which predates Moyasar.
 * The July status has no Moyasar readiness fields and fills its key booleans
 * from another gateway's key names; shown as Moyasar readiness it reported
 * "Key for mode: Yes" and offered a connection test that does not test Moyasar.
 *
 * It also shows the webhook-verification code Moyasar sends when a webhook is
 * registered, for as long as Moyasar will still accept it.
 *
 * The app context and the payment API are mocked: no Supabase, no network.
 */
import { cleanup, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentGatewayStatus } from '../../lib/api';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

const status = vi.fn();
const latestWebhookVerification = vi.fn();
vi.mock('../../lib/api', () => ({
  paymentGateway: {
    status: () => status(),
    latestWebhookVerification: () => latestWebhookVerification(),
    testConnection: vi.fn(),
    testCheckout: vi.fn(),
    testCheckoutResult: vi.fn(),
  },
}));

import { MoyasarPaymentPanel } from './MoyasarPaymentPanel';

afterEach(cleanup);

/** What the deployed July bundle answers for the live row: provider 'moyasar', a key of the old gateway. */
const JULY_STATUS = {
  status: 'ok',
  provider: 'moyasar',
  enabled: true,
  mode: 'test',
  currency: 'SAR',
  source_id: 'src_all',
  merchant_id_set: true,
  test_key_set: true,
  live_key_set: false,
  active_key_set: true,
  expiry_minutes: 30,
} as PaymentGatewayStatus;

/** What the Moyasar-only function in this repository answers. */
function moyasarStatus(over: Partial<PaymentGatewayStatus> = {}): PaymentGatewayStatus {
  return {
    status: 'ok',
    provider: 'moyasar',
    enabled: true,
    mode: 'test',
    currency: 'SAR',
    source_id: 'invoice',
    merchant_id_set: true,
    test_key_set: true,
    live_key_set: false,
    active_key_set: true,
    expiry_minutes: 30,
    webhook_secret_set: true,
    key_prefix_ok: true,
    config_ok: true,
    config_reason: null,
    ...over,
  };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function renderPanel(lang: 'en' | 'ar' = 'en') {
  useApp.mockReturnValue({ adminLang: lang });
  return render(<MoyasarPaymentPanel disabled={false} />);
}

beforeEach(() => {
  status.mockReset();
  latestWebhookVerification.mockReset();
  latestWebhookVerification.mockResolvedValue(null);
});

describe('against the payment-test-config deployed before Moyasar', () => {
  it('says to deploy the Moyasar functions, and shows none of its readings', async () => {
    status.mockResolvedValue(JULY_STATUS);
    renderPanel();

    expect(await screen.findByText('Deploy the Moyasar payment functions first.')).toBeTruthy();
    expect(screen.queryByText(/Key for mode/)).toBeNull();
    expect(screen.queryByText(/Webhook secret/)).toBeNull();
  });

  it('disables the connection test, which would not test Moyasar', async () => {
    status.mockResolvedValue(JULY_STATUS);
    renderPanel();

    const test = await screen.findByRole('button', { name: 'Test' });
    expect((test as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it in Arabic too', async () => {
    status.mockResolvedValue(JULY_STATUS);
    renderPanel('ar');
    expect(await screen.findByText('انشر دوال الدفع الخاصة بـ Moyasar أولاً.')).toBeTruthy();
  });
});

describe('against the Moyasar-only payment-test-config', () => {
  it('shows the readiness rows and offers the connection test', async () => {
    status.mockResolvedValue(moyasarStatus());
    renderPanel();

    expect(await screen.findByText('Key for mode (test)')).toBeTruthy();
    expect(screen.getByText('Key prefix (sk_test_)')).toBeTruthy();
    expect(screen.getByText('Webhook secret (test)')).toBeTruthy();
    expect(screen.queryByText('Deploy the Moyasar payment functions first.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('names the live prefix in live mode', async () => {
    status.mockResolvedValue(moyasarStatus({ mode: 'live', live_key_set: true }));
    renderPanel();
    expect(await screen.findByText('Key prefix (sk_live_)')).toBeTruthy();
    expect(screen.getByText('Webhook secret (live)')).toBeTruthy();
  });

  it("follows the server's verdict, including a reason the console does not know", async () => {
    status.mockResolvedValue(moyasarStatus({ config_ok: false, config_reason: 'something_new' }));
    renderPanel();
    expect(await screen.findByText('The server reports Moyasar is not ready (something_new).')).toBeTruthy();
  });

  it('reports a missing webhook secret as blocking', async () => {
    status.mockResolvedValue(
      moyasarStatus({ webhook_secret_set: false, config_ok: false, config_reason: 'missing_webhook_secret' }),
    );
    renderPanel();
    expect(await screen.findByText(/No webhook secret token is set/)).toBeTruthy();
  });
});

describe('the webhook verification code', () => {
  it('shows a fresh code with where to enter it', async () => {
    status.mockResolvedValue(moyasarStatus());
    latestWebhookVerification.mockResolvedValue({ created_at: minutesAgo(5), verification_code: '482913' });
    renderPanel();

    expect(await screen.findByText('Webhook verification code: 482913')).toBeTruthy();
    expect(screen.getByText(/Moyasar → Settings → Webhooks within 30 minutes/)).toBeTruthy();
  });

  it('shows it in Arabic too', async () => {
    status.mockResolvedValue(moyasarStatus());
    latestWebhookVerification.mockResolvedValue({ created_at: minutesAgo(5), verification_code: '482913' });
    renderPanel('ar');
    expect(await screen.findByText('رمز التحقق من الويب هوك: 482913')).toBeTruthy();
  });

  it('shows the code even while the server predates Moyasar', async () => {
    status.mockResolvedValue(JULY_STATUS);
    latestWebhookVerification.mockResolvedValue({ created_at: minutesAgo(1), verification_code: '482913' });
    renderPanel();
    expect(await screen.findByText('Webhook verification code: 482913')).toBeTruthy();
  });

  it('shows nothing for a code older than 30 minutes', async () => {
    status.mockResolvedValue(moyasarStatus());
    latestWebhookVerification.mockResolvedValue({ created_at: minutesAgo(31), verification_code: '482913' });
    renderPanel();

    await screen.findByText('Key for mode (test)');
    await waitFor(() => expect(latestWebhookVerification).toHaveBeenCalled());
    expect(screen.queryByText(/482913/)).toBeNull();
  });

  it('takes the code away when the 30 minutes run out', async () => {
    status.mockResolvedValue(moyasarStatus());
    // Arrived 30 minutes ago less a moment: shown now, gone a moment later.
    const createdAt = new Date(Date.now() - 30 * 60_000 + 300).toISOString();
    latestWebhookVerification.mockResolvedValue({ created_at: createdAt, verification_code: '482913' });
    renderPanel();

    const code = await screen.findByText('Webhook verification code: 482913');
    await waitForElementToBeRemoved(code, { timeout: 3000 });
  });

  it('shows nothing, and keeps the readiness, when the read fails', async () => {
    status.mockResolvedValue(moyasarStatus());
    latestWebhookVerification.mockRejectedValue(new Error('permission denied'));
    renderPanel();

    expect(await screen.findByText('Key for mode (test)')).toBeTruthy();
    expect(screen.queryByText(/verification code/i)).toBeNull();
    expect(screen.queryByText('permission denied')).toBeNull();
  });
});
