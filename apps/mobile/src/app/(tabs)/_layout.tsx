/**
 * Bottom tabs: Home (menu lives here — NO separate Menu tab), Orders, Profile.
 * Guards the whole group: an unauthenticated deep link bounces to login.
 * Icons are drawn primitives (components/Icons) — crisp, tintable, no font.
 */
import { Redirect, Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { HomeIcon, PersonIcon, ReceiptIcon } from '../../components/Icons';
import { useI18n } from '../../i18n/I18nProvider';
import { accountDeletion } from '../../services/api';
import { useAuth } from '../../store';
import { colors } from '../../theme';

export default function TabsLayout() {
  const { status } = useAuth();
  const { t, pick } = useI18n();

  // Login / session-restore gate: an account with an ACTIVE deletion request must
  // not regain normal access. The authoritative lock is server-side (DB triggers
  // block all new writes); this routes the customer to the pending state so the
  // app is not usable normally. Backend errors are never surfaced.
  const [deletionPending, setDeletionPending] = useState(false);
  useEffect(() => {
    if (status !== 'signed_in') { setDeletionPending(false); return; }
    let alive = true;
    accountDeletion.current()
      .then((r) => { if (alive) setDeletionPending(!!r); })
      .catch(() => { if (alive) setDeletionPending(false); });
    return () => { alive = false; };
  }, [status]);

  if (status === 'signed_out') return <Redirect href="/(auth)/login" />;
  if (deletionPending) return <Redirect href="/account/delete" />;

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
