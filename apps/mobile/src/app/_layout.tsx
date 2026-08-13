/** Root layout: providers, fast native-splash handoff, branded navigation. */
import 'react-native-gesture-handler';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ObservabilityErrorBoundary } from '../components/ObservabilityErrorBoundary';
import { useDesignSystemFonts } from '../design-system/fonts';
import { NotificationTapBridge } from '../features/notifications/NotificationTapBridge';
import { I18nProvider } from '../i18n/I18nProvider';
import { initObservability, wrapRoot } from '../lib/observability';
import { AppStoreProvider } from '../store';
import { ThemeProvider, useTheme, useThemeColors } from '../theme/ThemeProvider';

initObservability();
void SplashScreen.preventAutoHideAsync();

function SplashGate({ children }: { children: React.ReactNode }) {
  const { ready: fontsReady } = useDesignSystemFonts();
  useEffect(() => { if (fontsReady) void SplashScreen.hideAsync(); }, [fontsReady]);
  return <>{children}</>;
}

function ThemedNavigation() {
  const { resolved } = useTheme();
  const colors = useThemeColors();
  return (
    <>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      <NotificationTapBridge />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.appBg } }}>
        <Stack.Screen name="index" /><Stack.Screen name="(auth)" /><Stack.Screen name="(tabs)" />
        <Stack.Screen name="select" options={{ gestureEnabled: false }} />
        <Stack.Screen name="product/[id]" /><Stack.Screen name="cart" /><Stack.Screen name="checkout" />
        <Stack.Screen name="payment/checkout" options={{ gestureEnabled: false }} />
        <Stack.Screen name="payment/return" options={{ gestureEnabled: false }} />
        <Stack.Screen name="legal/index" /><Stack.Screen name="legal/[type]" />
        <Stack.Screen name="receipt/[id]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="account/delete" /><Stack.Screen name="profile/addresses" /><Stack.Screen name="profile/address/[id]" />
        <Stack.Screen name="profile/notifications" /><Stack.Screen name="profile/account" />
      </Stack>
    </>
  );
}

function RootLayout() {
  return (
    <SafeAreaProvider><ObservabilityErrorBoundary><ThemeProvider><I18nProvider><AppStoreProvider>
      <SplashGate><ThemedNavigation /></SplashGate>
    </AppStoreProvider></I18nProvider></ThemeProvider></ObservabilityErrorBoundary></SafeAreaProvider>
  );
}
export default wrapRoot(RootLayout);
