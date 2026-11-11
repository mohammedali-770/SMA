import { describe, expect, it } from 'vitest';

import { VERIFICATION_WINDOW_MS, webhookVerificationNotice } from './moyasarWebhookVerification';

const ARRIVED = '2026-11-11T12:00:00.000Z';
const arrivedMs = Date.parse(ARRIVED);
const row = (verification_code: string | null, created_at = ARRIVED) => ({ created_at, verification_code });

describe('webhookVerificationNotice', () => {
  it('shows the code with when it arrived and when it stops working', () => {
    expect(webhookVerificationNotice(row('482913'), arrivedMs + 5 * 60_000)).toEqual({
      code: '482913',
      receivedAt: ARRIVED,
      expiresAtMs: arrivedMs + VERIFICATION_WINDOW_MS,
    });
  });

  it("uses Moyasar's 30-minute window", () => {
    expect(VERIFICATION_WINDOW_MS).toBe(30 * 60_000);
  });

  /** Moyasar refuses the code after 30 minutes, so showing it then only misleads. */
  it('shows nothing once the window has closed', () => {
    expect(webhookVerificationNotice(row('482913'), arrivedMs + VERIFICATION_WINDOW_MS - 1)).not.toBeNull();
    expect(webhookVerificationNotice(row('482913'), arrivedMs + VERIFICATION_WINDOW_MS)).toBeNull();
    expect(webhookVerificationNotice(row('482913'), arrivedMs + 2 * VERIFICATION_WINDOW_MS)).toBeNull();
  });

  it('shows nothing when there is no row', () => {
    expect(webhookVerificationNotice(null, arrivedMs)).toBeNull();
    expect(webhookVerificationNotice(undefined, arrivedMs)).toBeNull();
  });

  it('shows only a six-digit code', () => {
    for (const bad of [null, '', '12345', '1234567', '12a456', ' 482913x']) {
      expect(webhookVerificationNotice(row(bad), arrivedMs)).toBeNull();
    }
    expect(webhookVerificationNotice(row(' 482913 '), arrivedMs)?.code).toBe('482913');
  });

  it('shows nothing for an unreadable arrival time', () => {
    expect(webhookVerificationNotice(row('482913', 'not a time'), arrivedMs)).toBeNull();
  });
});
