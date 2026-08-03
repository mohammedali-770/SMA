/**
 * Route guard for screens that require a signed-in customer.
 *
 * Why this exists: only the `(tabs)` group redirected when signed out. Every
 * root-level route — cart, checkout, select, product/[id], receipt/[id],
 * profile/addresses, profile/address/[id] — rendered regardless of session
 * state.
 *
 * On a phone that is mostly invisible, because there is no address bar to type
 * into. On the web export (`/app`, served by Vercel) those are REAL URLs: a
 * signed-out visitor, a shared link, or a search-engine crawler can land
 * straight on `/app/checkout`. The screens then run their data fetches with no
 * session, and the customer sees an error state rather than a login prompt.
 *
 * Deliberately NOT applied to:
 *   `(auth)/*`        — the login flow itself
 *   `legal/*`         — must be publicly reachable; the store listings need a
 *                       privacy-policy URL that resolves without an account
 *   `payment/return`  — the gateway redirects back here and the session may not
 *                       be re-established yet; it has its own recovery path
 *   `index`           — already redirects on session state
 *   `dev-*`           — dev-only routes, excluded from production builds
 */
import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '../store';
import { LoadingView } from './StateViews';
import { Screen } from './Screen';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  // Session restore is async. Rendering the login redirect during `loading`
  // would bounce a signed-in customer out of a deep link on every cold start.
  if (status === 'loading') {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  // No `returnTo` yet: nothing in the login flow consumes one, and on the web
  // export an unvalidated return path is an open-redirect waiting to happen.
  // Landing on the home tab after login is the safe behaviour; carrying the
  // intended destination is a follow-up that needs an allow-list check on the
  // path, not just a query parameter.
  if (status === 'signed_out') return <Redirect href="/(auth)/login" />;

  return <>{children}</>;
}
