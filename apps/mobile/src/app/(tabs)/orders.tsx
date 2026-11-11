import React from 'react';

import { SignInScreen } from '../../features/auth/SignInPrompt';
import { OrdersScreen } from '../../features/orders/OrdersScreen';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';

/**
 * A guest has no orders to show, so the tab explains that and offers sign-in,
 * returning here afterwards (guest browsing, App Store 5.1.1(v)). The prompt
 * lives in the route rather than in OrdersScreen, which reads the customer's own
 * order rows and is unchanged.
 */
export default function OrdersRoute() {
  const { status } = useAuth();
  const { t, pick } = useI18n();
  if (status === 'signed_out') {
    return (
      <SignInScreen
        heading={t('orderHistory')}
        title={pick('Your orders live in your account', 'طلباتك محفوظة في حسابك')}
        body={pick('Sign in to see your orders and follow their status.', 'سجّل الدخول لعرض طلباتك ومتابعة حالتها.')}
        returnTo="/(tabs)/orders"
      />
    );
  }
  return <OrdersScreen />;
}
