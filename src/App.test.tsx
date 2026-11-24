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

// The MFA gate asks Supabase for an assurance level; the shell tests only need
// to see what renders around it.
vi.mock('./components/StaffMfaGate', () => ({
  StaffMfaGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

/*
 * F-X14-001 / F-X14-002. The frame around the consoles (header, loaders, load
 * and save errors) used to be English-only although the operations consoles are
 * Arabic by default, and its Sign out button had no accessible name under 640px
 * because its only text was `hidden sm:inline`.
 */
describe('console shell — language follows the console it wraps (F-X14-001)', () => {
  const cashier = { ...GUEST, id: 'u1', fullName: 'Test Cashier', role: 'branch_staff' };
  const admin = { ...GUEST, id: 'u2', fullName: 'Test Admin', role: 'admin' };

  it('is Arabic around the branch console by default: loader, role, sign out', () => {
    useApp.mockReturnValue(ctx({ currentUser: cashier, dataLoading: true }));
    render(<AppContent />);

    expect(screen.getByText('جارٍ تحميل بيانات الفرع…')).toBeTruthy();
    expect(screen.getByText('موظف فرع')).toBeTruthy();
    expect(screen.queryByText('Branch_staff')).toBeNull();
    expect(screen.queryByText('Loading branch data…')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'تسجيل الخروج' }).length).toBeGreaterThan(0);
  });

  it('gives the load error and its Retry in Arabic, and Retry still retries', () => {
    const c = ctx({ currentUser: cashier, dataError: 'catalog failed' });
    useApp.mockReturnValue(c);
    render(<AppContent />);

    expect(screen.getByText('تعذّر تحميل بياناتك')).toBeTruthy();
    expect(screen.queryByText("Couldn't load your data")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(c.reload).toHaveBeenCalledTimes(1);
  });

  it('gives the save-error banner and its dismiss in Arabic', () => {
    const c = ctx({ currentUser: cashier, writeError: 'permission denied' });
    useApp.mockReturnValue(c);
    render(<AppContent />);

    expect(screen.getByText('تعذّر الحفظ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
    expect(c.dismissWriteError).toHaveBeenCalledTimes(1);
  });

  it('honours a stored English choice, and sets the direction from the language', () => {
    window.localStorage.setItem('sm-ops-lang-v2', 'en');
    useApp.mockReturnValue(ctx({ currentUser: cashier, dataLoading: true }));
    const { container } = render(<AppContent />);

    expect(screen.getByText('Loading branch data…')).toBeTruthy();
    expect(screen.getByText('Branch operator')).toBeTruthy();
    expect(container.querySelector('header')?.getAttribute('dir')).toBe('ltr');
  });

  it('sets rtl on the header in Arabic', () => {
    useApp.mockReturnValue(ctx({ currentUser: cashier, dataLoading: true }));
    const { container } = render(<AppContent />);
    expect(container.querySelector('header')?.getAttribute('dir')).toBe('rtl');
  });

  it('follows the admin dashboard language for administrators', () => {
    useApp.mockReturnValue(ctx({ currentUser: admin, dataLoading: true, adminLang: 'ar' }));
    render(<AppContent />);
    expect(screen.getByText('جارٍ تحميل بيانات الفريق…')).toBeTruthy();
    expect(screen.getByText('مسؤول')).toBeTruthy();
  });

  it('stays English for administrators until they switch, and ignores the ops language', () => {
    window.localStorage.setItem('sm-ops-lang-v2', 'ar');
    useApp.mockReturnValue(ctx({ currentUser: admin, dataLoading: true, adminLang: 'en' }));
    render(<AppContent />);
    expect(screen.getByText('Loading staff data…')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('keeps the sign-in states English by default, as the screens they sit on are', () => {
    useApp.mockReturnValue(ctx({ dataLoading: true }));
    render(<AppContent />);
    expect(screen.getByText('Loading your account…')).toBeTruthy();
  });

  it('shows an unrecognised role id rather than nothing', () => {
    useApp.mockReturnValue(ctx({ currentUser: { ...cashier, role: 'courier' }, dataLoading: true }));
    render(<AppContent />);
    expect(screen.getByText('Courier')).toBeTruthy();
  });
});

describe('console shell — Sign out is a named, full-size target (F-X14-002)', () => {
  it('carries its name on the button itself, not on a span hidden below 640px', () => {
    useApp.mockReturnValue(ctx({ dataLoading: true }));
    render(<AppContent />);
    const button = screen.getAllByRole('button', { name: 'Sign out' })[0];
    // `hidden sm:inline` removes the visible text from the accessibility tree
    // at phone width; the name has to be on the button.
    expect(button.getAttribute('aria-label')).toBe('Sign out');
    expect(button.className).toMatch(/\bmin-h-11\b/);
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
