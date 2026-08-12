/** Bottom tabs: Home, Orders, Profile. */
import { Redirect, Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { HomeIcon, PersonIcon, ReceiptIcon } from '../../components/Icons';
import { useI18n } from '../../i18n/I18nProvider';
import { accountDeletion } from '../../services/api';
import { useAuth } from '../../store';
import { useThemeColors } from '../../theme/ThemeProvider';

export default function TabsLayout() {
  const colors = useThemeColors();
  const { status } = useAuth();
  const { t, pick } = useI18n();

  const [deletionPending, setDeletionPending] = useState(false);
  useEffect(() => {
    if (status !== 'signed_in') { setDeletionPending(false); return; }
    let alive = true;
    const check = () => {
      accountDeletion.current()
        .then((r) => { if (alive) setDeletionPending(!!r); })
        .catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { alive = false; sub.remove(); };
  }, [status]);

  if (status === 'signed_out') return <Redirect href="/(auth)/login" />;
  if (deletionPending) return <Redirect href="/account/delete" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ember,
        tabBarInactiveTintColor: colors.appText2,
        tabBarStyle: { borderTopColor: colors.appLine, backgroundColor: colors.appSurface },
        tabBarLabelStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: pick('Home', 'الرئيسية'),
          tabBarIcon: ({ color: iconColor, size }) => <HomeIcon color={iconColor} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('orderHistory'),
          tabBarIcon: ({ color: iconColor, size }) => <ReceiptIcon color={iconColor} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarIcon: ({ color: iconColor, size }) => <PersonIcon color={iconColor} size={size} />,
        }}
      />
    </Tabs>
  );
}
