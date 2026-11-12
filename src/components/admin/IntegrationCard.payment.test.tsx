// @vitest-environment jsdom
/**
 * The payment card, rendered: Moyasar's inputs, the stored-provider coercion,
 * and the LIVE confirmation.
 *
 * `IntegrationCard.test.ts` pins the field list. This proves the card renders
 * that list for whatever row is stored. The card used to switch field sets on
 * the stored provider name, so a row still saying `tap` opened on Tap's merchant
 * id and key slots.
 *
 * The LIVE confirmation is the one safety property this card owns: switching the
 * mode to `live` means real cards, so a declined confirmation must save nothing.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DbIntegrationSetting, UpsertIntegrationInput } from '../../lib/api';

import { IntegrationCard } from './IntegrationCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const staleTapRow: DbIntegrationSetting = {
  provider_type: 'payment',
  provider_name: 'tap',
  enabled: false,
  public_config: { mode: 'test', merchant_id: 'merchant_1', source_id: 'src_all' },
  has_secret: true,
  updated_at: '2026-11-11T10:55:54.000Z',
};

function renderCard(row: DbIntegrationSetting = staleTapRow) {
  const onSave = vi.fn(async (input: UpsertIntegrationInput) => ({
    ...row,
    provider_name: input.providerName,
  }));
  render(<IntegrationCard providerType="payment" row={row} disabled={false} onSave={onSave} />);
  return { onSave };
}

describe('payment card', () => {
  it('opens on Moyasar even when the stored row names another provider', () => {
    renderCard();
    const select = screen.getByRole('combobox', { name: 'Payment Gateway provider' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['moyasar']);
    expect((select as HTMLSelectElement).value).toBe('moyasar');
  });

  it("renders Moyasar's inputs and none of the other gateway's", () => {
    renderCard();
    expect(screen.getByLabelText('Test Webhook Secret Token')).toBeTruthy();
    expect(screen.getByLabelText('Live Webhook Secret Token')).toBeTruthy();
    expect(screen.getByLabelText('Test Secret Key (sk_test_…)')).toBeTruthy();
    expect(screen.queryByText('Merchant ID')).toBeNull();
    expect(screen.queryByText('Source ID')).toBeNull();
  });

  it('saves the provider as moyasar', async () => {
    const { onSave } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ providerType: 'payment', providerName: 'moyasar' });
  });

  it('saves nothing when the switch to LIVE is not confirmed', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderCard();
    fireEvent.change(screen.getByLabelText('Mode (test / live)'), { target: { value: 'live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/LIVE/);
    expect(confirm.mock.calls[0][0]).toMatch(/webhook secret token/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the LIVE mode once it is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onSave } = renderCard();
    fireEvent.change(screen.getByLabelText('Mode (test / live)'), { target: { value: 'live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ publicConfig: { mode: 'live' } });
  });
});
