// @vitest-environment jsdom
/**
 * Integrations → Payments shows the Moyasar readiness panel, whatever the stored
 * provider name says.
 *
 * The panel used to be chosen from `provider_name`: Moyasar for 'moyasar',
 * another gateway's panel for anything else. Moyasar is now the only provider,
 * so a stale row (a restored environment, a row never re-saved) must still land
 * on the panel that can tell the operator what to fix. The Moyasar panel already
 * says when the stored provider is not 'moyasar'.
 *
 * The app context and the payment API are mocked: no Supabase, no network.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbIntegrationSetting, PaymentGatewayStatus } from '../../lib/api';

const useApp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => useApp(),
}));

const status = vi.fn();
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    paymentGateway: {
      ...actual.paymentGateway,
      status: () => status(),
      latestWebhookVerification: async () => null,
    },
  };
});

import { IntegrationsPanel } from './IntegrationsPanel';

afterEach(cleanup);

function paymentRow(providerName: string): DbIntegrationSetting {
  return {
    provider_type: 'payment',
    provider_name: providerName,
    enabled: false,
    public_config: { mode: 'test' },
    has_secret: false,
    updated_at: '2026-11-11T10:55:54.000Z',
  };
}

function mockContext(row: DbIntegrationSetting) {
  useApp.mockReturnValue({
    integrationSettings: [row],
    integrationsLoading: false,
    integrationsError: null,
    loadIntegrations: vi.fn(),
    saveIntegration: vi.fn(),
    currentUser: { id: 'u1', role: 'admin' },
    adminLang: 'en',
    branches: [],
  });
}

beforeEach(() => {
  status.mockResolvedValue({
    status: 'ok',
    provider: 'tap',
    enabled: false,
    mode: 'test',
    currency: 'SAR',
    test_key_set: false,
    live_key_set: false,
    active_key_set: false,
    expiry_minutes: 30,
    webhook_secret_set: false,
    key_prefix_ok: false,
    config_ok: false,
    config_reason: 'disabled',
  } satisfies PaymentGatewayStatus);
});

describe('Integrations → Payments', () => {
  it.each(['tap', 'moyasar', 'sandbox'])('shows the Moyasar panel for a stored %s row', async (name) => {
    mockContext(paymentRow(name));
    render(<IntegrationsPanel />);
    expect(await screen.findByText('Moyasar Payments')).toBeTruthy();
    expect(screen.queryByText('Tap Payments')).toBeNull();
  });
});
