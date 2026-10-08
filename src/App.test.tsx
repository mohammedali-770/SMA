// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The console shell's choice of SURFACE is pinned by the pure tests in
 * `src/lib/consoleAudience.test.ts`. This file pins what those surfaces DO,
 * because that is where the two review findings on #415 lived and the pure
 * tests could not see either of them:
 *
 *   P1 — an unknown identity with a load error rendered DataErrorPanel, whose
 *        Retry calls `reload()`, which is a no-op without `currentUser.id`.
 *        The Retry button was dead on exactly the path the change was for.
 *   P2 — the header rendered GUEST_USER's placeholder role as a "Customer"
 *        badge above a notice saying the user is NOT known to be a customer.
 */

const useApp = vi.fn();
vi.mock('./context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useApp: () => useApp(),
}));

// Imported after the mock so AppContent binds to it.
const { AppContent } = await import('./App');

/** GUEST_USER's shape: what `currentUser` is before any profile has loaded. */
const GUEST = {
  id: '',
  fullName: '',
  phoneNumber: '',
  role: 'customer',
  email: undefined,
  createdAt: '',
  loyaltyPoints: 0,
};

function ctx(over: Record<string, unknown> = {}) {
  return {
    authReady: true,
    isAuthenticated: true,
    currentUser: GUEST,
    dataLoading: false,
    dataError: null,
    profileUnavailable: false,
    writeError: null,
    dismissWriteError: vi.fn(),
    reload: vi.fn(),
    retryProfile: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn(),
    signUp: vi.fn(),
    ...over,
  };
}

/** The header renders GUEST_USER's role as exactly this text. */
const CUSTOMER_BADGE = 'Customer';

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* private mode */
  }
});
afterEach(() => {
  cleanup();
  useApp.mockReset();
});

describe('console shell — unknown identity (#415 P1)', () => {
  it('routes a thrown profile read to a Retry that actually retries', () => {
    // bootstrap's catch: dataError set, identity never established.
    const c = ctx({ dataError: 'JWT expired' });
    useApp.mockReturnValue(c);
    render(<AppContent />);

    expect(screen.getByText("We couldn't load your account")).toBeTruthy();
    expect(screen.queryByText("Couldn't load your data")).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(c.retryProfile).toHaveBeenCalledTimes(1);
    // The defect: this used to be the only thing Retry called, and it does
    // nothing without currentUser.id.
    expect(c.reload).not.toHaveBeenCalled();
  });

  it('still shows the reason, rather than swallowing it', () => {
    useApp.mockReturnValue(ctx({ dataError: 'JWT expired' }));
    render(<AppContent />);
    expect(screen.getByText('JWT expired')).toBeTruthy();
  });

  it('handles an empty profile row the same way', () => {
    const c = ctx({ profileUnavailable: true });
    useApp.mockReturnValue(c);
    render(<AppContent />);

    expect(screen.getByText("We couldn't load your account")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(c.retryProfile).toHaveBeenCalledTimes(1);
  });

  it('does not put a load error during sign-in on the dead path either', () => {
    // The account-loading window with an error: identity still unknown.
    const c = ctx({ dataLoading: true, dataError: 'network down' });
    useApp.mockReturnValue(c);
    render(<AppContent />);

    expect(screen.queryByText("Couldn't load your data")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(c.retryProfile).toHaveBeenCalledTimes(1);
    expect(c.reload).not.toHaveBeenCalled();
  });
});

describe('console shell — header labelling (#415 P2)', () => {
  it('does not call an unreadable profile a customer', () => {
    useApp.mockReturnValue(ctx({ profileUnavailable: true }));
    render(<AppContent />);
    expect(screen.queryByText(CUSTOMER_BADGE)).toBeNull();
  });

  it('does not flash "Customer" at an admin during every sign-in', () => {
    useApp.mockReturnValue(ctx({ dataLoading: true }));
    render(<AppContent />);
    expect(screen.getByText('Loading your account…')).toBeTruthy();
    expect(screen.queryByText(CUSTOMER_BADGE)).toBeNull();
  });

  it('keeps Sign out reachable while the identity is unknown', () => {
    useApp.mockReturnValue(ctx({ dataLoading: true }));
    render(<AppContent />);
    // The header button: the one way out that exists in every state.
    expect(screen.getAllByRole('button', { name: /sign out/i }).length).toBeGreaterThan(0);
  });
});

describe('console shell — known identities', () => {
  const customer = { ...GUEST, id: 'c1', fullName: 'Test Customer', role: 'customer' };

  it('shows a real customer the notice instead of navigating away', () => {
    const c = ctx({ currentUser: customer });
    useApp.mockReturnValue(c);
    render(<AppContent />);

    expect(screen.getByText('This is not a staff account')).toBeTruthy();
    // The component that used to call window.location.replace('/app').
    expect(screen.queryByText('Opening the Spicy Meal app…')).toBeNull();

    const open = screen.getByRole('link', { name: /open the spicy meal app/i });
    expect(open.getAttribute('href')).toBe('/app');

    fireEvent.click(screen.getByRole('button', { name: /sign out to use a staff account/i }));
    expect(c.signOut).toHaveBeenCalledTimes(1);
  });

  it('labels a KNOWN customer as one — the badge is only hidden when it would be a guess', () => {
    useApp.mockReturnValue(ctx({ currentUser: customer }));
    render(<AppContent />);
    expect(screen.getByText(CUSTOMER_BADGE)).toBeTruthy();
  });

  it('keeps DataErrorPanel where its Retry can work', () => {
    // Identity known, so reload() has a currentUser.id to load for.
    const c = ctx({ currentUser: customer, dataError: 'catalog failed' });
    useApp.mockReturnValue(c);
    render(<AppContent />);

    expect(screen.getByText("Couldn't load your data")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(c.reload).toHaveBeenCalledTimes(1);
  });

  it('shows the sign-in form when nobody is signed in', () => {
    useApp.mockReturnValue(ctx({ isAuthenticated: false }));
    render(<AppContent />);
    expect(screen.getByText('Sign in to your account')).toBeTruthy();
  });
});

describe('console shell — source guard', () => {
  it('never navigates the browser away on its own', () => {
    // A rendering test cannot prove an effect did NOT fire a navigation in
    // jsdom, which only logs "Not implemented". The lockout came from exactly
    // such an effect, so its reintroduction is pinned at the source instead.
    const src = readFileSync(join(__dirname, 'App.tsx'), 'utf8');
    expect(src).not.toMatch(/location\.(replace|assign)\s*\(/);
    expect(src).not.toMatch(/location\.href\s*=/);
  });
});
