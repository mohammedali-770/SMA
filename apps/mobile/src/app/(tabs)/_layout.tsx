/**
 * Bottom tabs: Home (menu lives here — NO separate Menu tab), Orders, Profile.
 * Guards the whole group: an unauthenticated deep link bounces to login.
 * Icons are drawn primitives (components/Icons) — crisp, tintable, no font.
 */
import { Redirect, Tabs } from 'expo-router';
import React from 'react';

import { HomeIcon, PersonIcon, ReceiptIcon } from '../../components/Icons';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';
import { colors } from '../../theme';

export default function TabsLayout() {
  const { status } = useAuth();
  const { t, pick } = useI18n();

  if (status === 'signed_out') return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.purple,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.white },
        tabBarLabelStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: pick('Home', 'الرئيسية'),
          tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('orderHistory'),
          tabBarIcon: ({ color, size }) => <ReceiptIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarIcon: ({ color, size }) => <PersonIcon color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
