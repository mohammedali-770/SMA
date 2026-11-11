// @vitest-environment jsdom
//
// The Orders tab mounts OrdersScreen, which queries the customer's own orders as
// soon as it gains focus, ONLY when the session is known to be signed in.
//
// WHY THIS IS PINNED BY RENDERING RATHER THAN BY READING SOURCE. Session restore
// is async, so auth starts at `loading`. The route used to show the sign-in card
// for `signed_out` and OrdersScreen for everything else, so during `loading` it
// mounted OrdersScreen and the query went out with no session. The server
// refused it (401), and the screen reported the refusal to Sentry. On Expo SDK
// 58 a directly opened tab renders before the session settles, so every
// signed-out visit to /app/orders on the web export did that: 5 of 5 direct
// loads, measured 2026-11-11, against 0 of 5 on SDK 57. The defect is a
// component mounted in a state where it must not be, which is exactly what a
// render can observe.
//
// Every import of the route is replaced, so no React Native module loads here
// (vitest.config.ts: mobile tests stay framework-free).
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Status = 'loading' | 'signed_in' | 'signed_out';
const auth = vi.hoisted(() => ({ status: 'loading' as string }));

vi.mock('../../store', () => ({ useAuth: () => ({ status: auth.status }) }));
vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key, pick: (en: string) => en }),
}));
vi.mock('../orders/OrdersScreen', () => ({
  OrdersScreen: () => React.createElement('div', { 'data-testid': 'orders-screen' }),
}));
vi.mock('./SignInPrompt', () => ({
  SignInScreen: ({ returnTo }: { returnTo: string }) =>
    React.createElement('div', { 'data-testid': 'sign-in', 'data-return-to': returnTo }),
}));
vi.mock('../../components/Screen', () => ({
  Screen: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'screen' }, children),
}));
vi.mock('../../components/StateViews', () => ({
  LoadingView: () => React.createElement('div', { 'data-testid': 'loading' }),
}));

import OrdersRoute from '../../app/(tabs)/orders';

afterEach(cleanup);

function renderAs(status: string) {
  auth.status = status;
  return render(React.createElement(OrdersRoute));
}

describe('the Orders tab renders OrdersScreen only for a signed-in customer', () => {
  it('while the session is still loading: a loading view, and no OrdersScreen', () => {
    renderAs('loading' satisfies Status);
    expect(screen.queryByTestId('orders-screen')).toBeNull();
    expect(screen.queryByTestId('sign-in')).toBeNull();
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('signed out: the sign-in card, returning to this tab, and no OrdersScreen', () => {
    renderAs('signed_out' satisfies Status);
    expect(screen.queryByTestId('orders-screen')).toBeNull();
    expect(screen.getByTestId('sign-in').getAttribute('data-return-to')).toBe('/(tabs)/orders');
  });

  it('signed in: OrdersScreen, and nothing else', () => {
    renderAs('signed_in' satisfies Status);
    expect(screen.getByTestId('orders-screen')).toBeTruthy();
    expect(screen.queryByTestId('sign-in')).toBeNull();
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('a status it does not know never mounts OrdersScreen', () => {
    // The gate allows `signed_in`; it does not merely refuse `signed_out`.
    renderAs('restoring');
    expect(screen.queryByTestId('orders-screen')).toBeNull();
  });
});
