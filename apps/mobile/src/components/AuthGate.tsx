/**
 * Route guard for screens that require a signed-in customer.
 *
 * Why this exists: only the `(tabs)` group redirected when signed out. Every
 * root-level route rendered regardless of session state.
 *
 * On a phone that is mostly invisible, because there is no address bar to type
 * into. On the web export (`/app`, served by Vercel) those are REAL URLs: a
 * signed-out visitor, a shared link, or a search-engine crawler can land
 * straight on `/app/checkout`. The screens then run their data fetches with no
 * session, and the customer sees an error state rather than a login prompt.
 *
 * Applied to the routes that belong to an account: checkout, receipt/[id],
 * profile/*, account/delete.
 *
 * Deliberately NOT applied to:
 *   `(auth)/*`        — the login flow itself
 *   `legal/*`         — must be publicly reachable; the store listings need a
 *                       privacy-policy URL that resolves without an account
 *   `payment/return`  — the gateway redirects back here and the session may not
 *                       be re-established yet; it has its own recovery path
 *   `index`, `(tabs)` — guest browsing (App Store 5.1.1(v)): the menu is open to
 *                       everyone, and the Orders / Profile tabs show their own
 *                       sign-in prompt
 *   `select`, `cart`, `product/[id]` — guest browsing again: choosing a pickup
 *                       branch, viewing a product and filling a cart need no
 *                       account. Delivery and checkout ask for one at the point
 *                       they need it.
 *   `dev-*`           — dev-only routes, excluded from production builds
 */
import { Redirect, usePathname } from 'expo-router';
import React from 'react';

import { loginHref } from '../features/auth/returnPath';
import { useAuth } from '../store';
import { LoadingView } from './StateViews';
import { Screen } from './Screen';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();

  // Session restore is async. Rendering the login redirect during `loading`
  // would bounce a signed-in customer out of a deep link on every cold start.
  if (status === 'loading') {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  // Carry this route to login so the customer returns here afterwards. The path
  // comes from the router, but it is still checked against the allow-list in
  // returnPath.ts — on the web export it is whatever URL the visitor typed, and
  // an unknown route simply loses its return path rather than being forwarded.
  if (status === 'signed_out') return <Redirect href={loginHref(pathname)} />;

  return <>{children}</>;
}
