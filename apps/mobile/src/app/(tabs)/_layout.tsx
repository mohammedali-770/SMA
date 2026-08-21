/** Bottom tabs + mandatory fresh-session order-type popup. */
import { Redirect, router, Tabs, usePathname } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { HomeIcon, PersonIcon, ReceiptIcon } from '../../components/Icons';
import { LaunchOrderTypeModal } from '../../features/order/LaunchOrderTypeModal';
import { useFirstRunPermissions } from '../../features/onboarding/useFirstRunPermissions';
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
  const [deletionPending, setDeletionPending] = useState(false);


  useEffect(() => {
    if (status !== 'signed_in') { setDeletionPending(false); return; }
    let alive = true;
    const check = () => { accountDeletion.current().then((r) => { if (alive) setDeletionPending(!!r); }).catch(() => {}); };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { alive = false; sub.remove(); };
  }, [status]);

  if (status === 'signed_out') return <Redirect href="/(auth)/login" />;
  if (deletionPending) return <Redirect href="/account/delete" />;
  // Native Modal renders above the root stack. Hide it while /select is active
  // so the branch/address resolver is usable; if the user returns without a
  // valid context, the popup automatically appears again on the tabs route.
  const requireOrderChoice = status === 'signed_in' && orderCtx.ready && !catalogLoading && !catalogError && !orderCtx.valid && pathname !== '/select';

  return (
    <>
      <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ember, tabBarInactiveTintColor: colors.appText2, tabBarStyle: { borderTopColor: colors.appLine, backgroundColor: colors.appSurface }, tabBarLabelStyle: { fontWeight: '700' } }}>
        <Tabs.Screen name="index" options={{ title: pick('Home', 'الرئيسية'), tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} /> }} />
        <Tabs.Screen name="orders" options={{ title: t('orderHistory'), tabBarIcon: ({ color, size }) => <ReceiptIcon color={color} size={size} /> }} />
        <Tabs.Screen name="profile" options={{ title: t('profile'), tabBarIcon: ({ color, size }) => <PersonIcon color={color} size={size} /> }} />
      </Tabs>
      {requireOrderChoice ? <LaunchOrderTypeModal onChoose={(type) => router.push({ pathname: '/select', params: { type } })} /> : null}
    </>
  );
}
