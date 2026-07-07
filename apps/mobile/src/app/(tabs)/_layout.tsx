/**
 * Bottom tabs: Home (menu lives here — NO separate Menu tab), Orders, Profile.
 * Guards the whole group: an unauthenticated deep link bounces to login.
 * Icons are emoji to avoid pulling an icon font into the first pass.
 */
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { Text, type ColorValue } from 'react-native';

import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';
import { colors } from '../../theme';

function TabEmoji({ emoji, color, size }: { emoji: string; color: ColorValue; size: number }) {
  return <Text style={{ fontSize: size, color, lineHeight: size + 2 }}>{emoji}</Text>;
}

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
          tabBarIcon: ({ color, size }) => <TabEmoji emoji="🏠" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('orderHistory'),
          tabBarIcon: ({ color, size }) => <TabEmoji emoji="🧾" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarIcon: ({ color, size }) => <TabEmoji emoji="👤" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
