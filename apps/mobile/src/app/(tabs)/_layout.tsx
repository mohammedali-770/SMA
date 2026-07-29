/**
 * Bottom tabs: Home (menu lives here — NO separate Menu tab), Orders, Profile.
 * Guards the whole group: an unauthenticated deep link bounces to login.
 * Icons are drawn primitives (components/Icons) — crisp, tintable, no font.
 */
import { Redirect, Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { HomeIcon, PersonIcon, ReceiptIcon } from '../../components/Icons';
import { useI18n } from '../../i18n/I18nProvider';
import { accountDeletion } from '../../services/api';
import { useAuth } from '../../store';
import { colors } from '../../theme';
import { useThemeColors } from '../../theme/ThemeProvider';

export default function TabsLayout() {
  const colors = useThemeColors();
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
    const check = () => {
      accountDeletion.current()
        .then((r) => { if (alive) setDeletionPending(!!r); })
        .catch(() => { /* keep the prior state; the DB lock is authoritative */ });
    };
    check();
    // Re-check on every foreground so an active deletion re-locks the app
    // mid-session (not depending only on an auth-status change that may not fire).
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { alive = false; sub.remove(); };
  }, [status]);

  if (status === 'signed_out') return <Redirect href="/(auth)/login" />;
  if (deletionPending) return <Redirect href="/account/delete" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.surface },
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
