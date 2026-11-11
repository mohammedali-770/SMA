import React from 'react';

import { Screen } from '../../components/Screen';
import { LoadingView } from '../../components/StateViews';
import { SignInScreen } from '../../features/auth/SignInPrompt';
import { OrdersScreen } from '../../features/orders/OrdersScreen';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';

/**
 * A guest has no orders to show, so the tab explains that and offers sign-in,
 * returning here afterwards (guest browsing, App Store 5.1.1(v)). The prompt
 * lives in the route rather than in OrdersScreen, which reads the customer's own
 * order rows and is unchanged.
 *
 * OrdersScreen is rendered only once the session is KNOWN to be signed in.
 * Session restore is async, so `status` starts at `loading`. OrdersScreen
 * queries the customer's orders as soon as it gains focus, so rendering it
 * during `loading` sent that query with no session. The server refused it (401),
 * and the screen reported the refusal to Sentry as a failure. On Expo SDK 58 a
 * directly opened tab renders before the session settles, so every signed-out
 * visit to /app/orders did that: 5 of 5 direct loads, measured 2026-11-11,
 * against 0 of 5 on SDK 57. While loading, this shows what AuthGate shows.
 */
export default function OrdersRoute() {
  const { status } = useAuth();
  const { t, pick } = useI18n();
  if (status === 'signed_in') return <OrdersScreen />;
  if (status === 'loading') {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  return (
    <SignInScreen
      heading={t('orderHistory')}
      title={pick('Your orders live in your account', 'طلباتك محفوظة في حسابك')}
      body={pick('Sign in to see your orders and follow their status.', 'سجّل الدخول لعرض طلباتك ومتابعة حالتها.')}
      returnTo="/(tabs)/orders"
    />
  );
}
