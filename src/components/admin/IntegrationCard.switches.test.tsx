// @vitest-environment jsdom
/**
 * The enable switches that turn live systems on and off ask first (audit
 * F-WAD-03-002): the Lazywait POS feed, customer push, and WhatsApp (the
 * integration and the customer-login flag).
 *
 * The PAYMENT card is deliberately untouched (CLAUDE.md section 6): its own
 * LIVE-mode confirmation is pinned in IntegrationCard.payment.test.tsx, and the
 * last test here pins that this change adds no prompt to it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DbIntegrationSetting, UpsertIntegrationInput } from '../../lib/api';

import { IntegrationCard } from './IntegrationCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (
  type: DbIntegrationSetting['provider_type'],
  name: string,
  enabled: boolean,
  pub: Record<string, unknown> = {},
): DbIntegrationSetting => ({
  provider_type: type,
  provider_name: name,
  enabled,
  public_config: pub,
  has_secret: true,
  updated_at: '2026-11-25T08:00:00.000Z',
});

function renderCard(r: DbIntegrationSetting, isRTL = false) {
  const onSave = vi.fn(async (input: UpsertIntegrationInput) => ({ ...r, enabled: input.enabled }));
  render(
    <IntegrationCard providerType={r.provider_type} row={r} disabled={false} isRTL={isRTL} onSave={onSave} />,
  );
  return { onSave };
}
const toggle = () => fireEvent.click(screen.getByRole('checkbox'));
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Save$|^حفظ$/ }));

describe('Lazywait POS', () => {
  it('unticking asks, says orders stop reaching the POS, and a decline saves nothing', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderCard(row('lazywait', 'lazywait', true));
    toggle();
    save();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toMatch(
      /Turn OFF the Lazywait POS integration\? New orders stop being sent to the kitchen POS/,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepting saves enabled=false', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onSave } = renderCard(row('lazywait', 'lazywait', true));
    toggle();
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ providerType: 'lazywait', enabled: false });
  });

  it('saving WITHOUT touching the switch asks nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderCard(row('lazywait', 'lazywait', true));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('Push', () => {
  it('ticking it ON asks and says real messages start reaching customers', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderCard(row('push', 'expo', false));
    toggle();
    save();
    expect(String(confirm.mock.calls[0][0])).toMatch(
      /Turn ON push notifications\? Real messages start reaching customers/,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('unticking it asks and says order-status messages and broadcasts stop', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderCard(row('push', 'expo', true));
    toggle();
    save();
    expect(String(confirm.mock.calls[0][0])).toMatch(
      /Turn OFF push notifications\? Customers stop receiving order-status messages/,
    );
  });
});

describe('WhatsApp', () => {
  const login = (on: boolean) => row('whatsapp', 'meta_cloud', true, { whatsapp_login_enabled: on });

  it('switching customer LOGIN off asks and says customers may be unable to sign in', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderCard(login(true));
    fireEvent.change(screen.getByLabelText(/Enable WhatsApp customer LOGIN/), { target: { value: 'false' } });
    save();
    expect(String(confirm.mock.calls[0][0])).toMatch(
      /Turn OFF WhatsApp customer login\?.*may be unable to sign in/,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('switching customer LOGIN on asks too', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onSave } = renderCard(login(false));
    fireEvent.change(screen.getByLabelText(/Enable WhatsApp customer LOGIN/), { target: { value: 'true' } });
    save();
    expect(String(confirm.mock.calls[0][0])).toMatch(/Turn ON WhatsApp customer login/);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('changing both switches gives ONE prompt that names both', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderCard(login(false));
    toggle();
    fireEvent.change(screen.getByLabelText(/Enable WhatsApp customer LOGIN/), { target: { value: 'true' } });
    save();
    expect(confirm).toHaveBeenCalledTimes(1);
    const text = String(confirm.mock.calls[0][0]);
    expect(text).toMatch(/WhatsApp OTP integration/);
    expect(text).toMatch(/WhatsApp customer login/);
  });

  it('editing an unrelated field asks nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderCard(login(true));
    fireEvent.change(screen.getByLabelText('Graph API Version'), { target: { value: 'v22.0' } });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('language', () => {
  it('asks in Arabic when the console is Arabic', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderCard(row('push', 'expo', true), true);
    toggle();
    save();
    expect(String(confirm.mock.calls[0][0])).toMatch(/إيقاف الإشعارات الفورية؟/);
  });
});

describe('not the payment card', () => {
  it('toggling the payment card’s enable switch adds no prompt', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderCard(row('payment', 'moyasar', false, { mode: 'test' }));
    toggle();
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });
});
