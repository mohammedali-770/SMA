// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAal: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  reload: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: mocks.getAal,
        listFactors: mocks.listFactors,
        enroll: mocks.enroll,
        unenroll: mocks.unenroll,
        challenge: mocks.challenge,
        verify: mocks.verify,
      },
    },
  },
}));

vi.mock('../context/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/AppContext')>();
  return {
    ...actual,
    useApp: () => ({ reload: mocks.reload, signOut: mocks.signOut }),
  };
});

import { StaffMfaGate } from './StaffMfaGate';

const aal = (currentLevel: 'aal1' | 'aal2', nextLevel: 'aal1' | 'aal2' = currentLevel) => ({
  data: { currentLevel, nextLevel, currentAuthenticationMethods: [] },
  error: null,
});
const factors = (totp: Array<{ id: string; status: 'verified' | 'unverified' }>) => ({
  data: { all: totp, totp, phone: [] },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unenroll.mockResolvedValue({ data: {}, error: null });
  mocks.challenge.mockResolvedValue({ data: { id: 'challenge-1', expires_at: 0 }, error: null });
  mocks.verify.mockResolvedValue({ data: {}, error: null });
  mocks.reload.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('StaffMfaGate', () => {
  it('renders protected staff content immediately for an existing AAL2 session', async () => {
    mocks.getAal.mockResolvedValue(aal('aal2'));
    render(<StaffMfaGate><div>Protected staff console</div></StaffMfaGate>);

    expect(await screen.findByText('Protected staff console')).toBeTruthy();
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it('challenges an existing verified TOTP factor and reloads privileged data only after AAL2', async () => {
    mocks.getAal
      .mockResolvedValueOnce(aal('aal1', 'aal2'))
      .mockResolvedValueOnce(aal('aal2'));
    mocks.listFactors.mockResolvedValue(factors([{ id: 'factor-1', status: 'verified' }]));

    render(<StaffMfaGate><div>Protected staff console</div></StaffMfaGate>);
    expect(await screen.findByText('Enter the current code from your authenticator app.')).toBeTruthy();
    expect(screen.queryByText('Protected staff console')).toBeNull();

    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await waitFor(() => expect(mocks.challenge).toHaveBeenCalledWith({ factorId: 'factor-1' }));
    expect(mocks.verify).toHaveBeenCalledWith({ factorId: 'factor-1', challengeId: 'challenge-1', code: '123456' });
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Protected staff console')).toBeTruthy();
  });

  it('enrolls a new TOTP factor, shows the setup key, then releases the console after verification', async () => {
    mocks.getAal
      .mockResolvedValueOnce(aal('aal1', 'aal2'))
      .mockResolvedValueOnce(aal('aal2'));
    mocks.listFactors
      .mockResolvedValueOnce(factors([]))
      .mockResolvedValueOnce(factors([{ id: 'abandoned', status: 'unverified' }]));
    mocks.enroll.mockResolvedValue({
      data: {
        id: 'factor-new', type: 'totp', friendly_name: 'Spicy Meal Staff', status: 'unverified',
        created_at: '', updated_at: '',
        totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', secret: 'ABCDEF123456', uri: 'otpauth://totp/test' },
      },
      error: null,
    });

    render(<StaffMfaGate><div>Protected staff console</div></StaffMfaGate>);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));

    await waitFor(() => expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: 'abandoned' }));
    expect(mocks.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Spicy Meal Staff' });
    expect(await screen.findByText('ABCDEF123456')).toBeTruthy();
    expect(screen.getByAltText('TOTP authenticator QR code')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish MFA setup' }));

    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith({ factorId: 'factor-new', challengeId: 'challenge-1', code: '654321' }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Protected staff console')).toBeTruthy();
  });

  it('fails closed when the MFA assurance check errors', async () => {
    mocks.getAal.mockResolvedValue({ data: null, error: new Error('MFA unavailable') });
    render(<StaffMfaGate><div>Protected staff console</div></StaffMfaGate>);

    expect(await screen.findByText('MFA unavailable')).toBeTruthy();
    expect(screen.queryByText('Protected staff console')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
