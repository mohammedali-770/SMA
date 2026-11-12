// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * S02#1 (2026-11-11): the console's sign-in screen had a "Create Account" tab.
 * Anyone could make an email/password account on the console domain, which
 * shares its browser session with /app, and place cash orders with no phone
 * number behind them. Staff accounts are made only by an administrator through
 * the staff-accounts Edge Function, so the tab served nobody. It is gone, and
 * these cases keep it gone.
 */

const signIn = vi.fn();
vi.mock('../context/AppContext', () => ({
  useApp: () => ({ signIn }),
}));

const { AuthScreen } = await import('./AuthScreen');

beforeEach(() => {
  signIn.mockReset();
  signIn.mockResolvedValue(undefined);
  try {
    window.localStorage.clear();
  } catch {
    /* private mode */
  }
});
afterEach(() => cleanup());

const SIGN_UP = /sign ?up|create (an |your )?account|register|إنشاء حساب/i;

describe('AuthScreen', () => {
  it('renders no sign-up control, in either language', () => {
    render(<AuthScreen />);
    const check = () => {
      expect(screen.queryByRole('button', { name: SIGN_UP })).toBeNull();
      expect(screen.queryByText(SIGN_UP)).toBeNull();
      expect(screen.queryByLabelText(/full name|phone/i)).toBeNull();
    };
    check();
    fireEvent.click(screen.getByRole('button', { name: /العربية|arabic|English/i }));
    check();
  });

  it('offers exactly email, password and one submit button', () => {
    const { container } = render(<AuthScreen />);
    const inputs = [...container.querySelectorAll('input')].map((i) => i.getAttribute('type'));
    expect(inputs).toEqual(['email', 'password']);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('signs in with the trimmed email', async () => {
    render(<AuthScreen />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  staff@example.test ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledWith('staff@example.test', 'correct horse'));
  });

  it('leaves no sign-up path behind in the context or the API', () => {
    const root = join(__dirname, '..', '..');
    const ctx = readFileSync(join(root, 'src/context/AppContext.tsx'), 'utf8');
    const api = readFileSync(join(root, 'src/lib/api.ts'), 'utf8');
    const strings = readFileSync(join(root, 'src/components/ops/opsStrings.ts'), 'utf8');
    expect(ctx).not.toMatch(/\bsignUp\b/);
    expect(api).not.toMatch(/auth\.signUp\(|async signUp\(/);
    expect(strings).not.toMatch(/authSignUp|authSignUpTitle|authFullName|authPhone/);
  });
});
