/**
 * Root layout: gesture handler init, safe-area + i18n + app-store providers, a
 * splash gate that waits for the initial session check, and the navigation
 * Stack. Sub-screens draw their own headers (see components/Header), so the
 * native header is hidden globally for a fully branded, RTL-aware look.
 */
import 'react-native-gesture-handler';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from '../i18n/I18nProvider';
import { AppStoreProvider, useAuth } from '../store';
import { colors } from '../theme';

void SplashScreen.preventAutoHideAsync();

/** Hides the native splash once the persisted session has been resolved. */
function SplashGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppStoreProvider>
          <SplashGate>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              {/* Blocking order-type/branch selection — gestures off so the menu
                  can't be reached without a valid order context. */}
              <Stack.Screen name="select" options={{ gestureEnabled: false }} />
              <Stack.Screen name="product/[id]" />
              <Stack.Screen name="cart" />
              <Stack.Screen name="checkout" />
              {/* In-app Tap hosted checkout — gestures off so a mid-payment swipe
                  can't silently abandon the WebView (dismiss goes via its header). */}
              <Stack.Screen name="payment/checkout" options={{ gestureEnabled: false }} />
              <Stack.Screen name="payment/return" options={{ gestureEnabled: false }} />
              <Stack.Screen name="legal/index" />
              <Stack.Screen name="legal/[type]" />
              <Stack.Screen name="receipt/[id]" options={{ gestureEnabled: false }} />
            </Stack>
          </SplashGate>
        </AppStoreProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
