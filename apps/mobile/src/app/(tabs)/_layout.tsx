/**
 * Bottom tabs + mandatory fresh-session order-type popup.
 *
 * Open to guests (App Store 5.1.1(v)): a signed-out customer browses the menu
 * and chooses a pickup branch like anyone else. Delivery needs an account,
 * because addresses are saved to one, so a guest who picks it is asked to sign
 * in and comes back to delivery selection afterwards. Orders and Profile show
 * their own sign-in prompt.
 */
import { Redirect, router, Tabs, usePathname } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { HomeIcon, PersonIcon, ReceiptIcon } from '../../components/Icons';
import { loginHref } from '../../features/auth/returnPath';
import { usePushDeviceSync } from '../../features/notifications/usePushDeviceSync';
import { useFirstRunPermissions } from '../../features/onboarding/useFirstRunPermissions';
import { LaunchOrderTypeModal } from '../../features/order/LaunchOrderTypeModal';
import { useI18n } from '../../i18n/I18nProvider';
import { accountDeletion } from '../../services/api';
import { useAuth, useCatalog, useOrderContext } from '../../store';
import { useThemeColors } from '../../theme/ThemeProvider';

export default function TabsLayout() {
  const colors = useThemeColors();
  const pathname = usePathname();
  const { status } = useAuth();
  const { loading: catalogLoading, error: catalogError } = useCatalog();
  const orderCtx = useOrderContext();
  const { t, pick, lang } = useI18n();
  // The OS raises its own permission dialogs once, on the first run after
  // sign-in. Nothing is rendered for this and nothing is blocked by it.
  useFirstRunPermissions(status === 'signed_in', lang);
  // And on EVERY sign-in, claim this device's push token for the customer who
  // just signed in — the half of "notifications survive a sign-out" that a
  // one-shot first run cannot cover. Never prompts.
  usePushDeviceSync(status === 'signed_in', lang);
  const [deletionPending, setDeletionPending] = useState(false);


  useEffect(() => {
    if (status !== 'signed_in') { setDeletionPending(false); return; }
    let alive = true;
    const check = () => { accountDeletion.current().then((r) => { if (alive) setDeletionPending(!!r); }).catch(() => {}); };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { alive = false; sub.remove(); };
  }, [status]);

  if (deletionPending) return <Redirect href="/account/delete" />;
  // Native Modal renders above the root stack, so it is shown only while a TAB
  // is the visible route. It used to be hidden on /select alone; with guests in
  // here it would otherwise cover the login screen a guest is sent to, and any
  // legal page opened from it. If the customer returns to the tabs without a
  // valid context, the popup appears again.
  const onTabRoute = pathname === '/' || pathname === '/orders' || pathname === '/profile';
  const requireOrderChoice =
    status !== 'loading' && orderCtx.ready && !catalogLoading && !catalogError && !orderCtx.valid && onTabRoute;
  const chooseOrderType = (type: 'delivery' | 'pickup') => {
    if (type === 'delivery' && status !== 'signed_in') {
      router.push(loginHref('/select?type=delivery'));
      return;
    }
    router.push({ pathname: '/select', params: { type } });
  };

  return (
    <>
      <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ember, tabBarInactiveTintColor: colors.appText2, tabBarStyle: { borderTopColor: colors.appLine, backgroundColor: colors.appSurface }, tabBarLabelStyle: { fontWeight: '700' } }}>
        <Tabs.Screen name="index" options={{ title: pick('Home', 'الرئيسية'), tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} /> }} />
        <Tabs.Screen name="orders" options={{ title: t('orderHistory'), tabBarIcon: ({ color, size }) => <ReceiptIcon color={color} size={size} /> }} />
        <Tabs.Screen name="profile" options={{ title: t('profile'), tabBarIcon: ({ color, size }) => <PersonIcon color={color} size={size} /> }} />
      </Tabs>
      {requireOrderChoice ? <LaunchOrderTypeModal onChoose={chooseOrderType} /> : null}
    </>
  );
}
