/**
 * Root layout: gesture handler init, safe-area + theme + i18n + app-store
 * providers, a splash gate that waits for the initial session check, and the
 * navigation Stack. Sub-screens draw their own headers, so the native header is
 * hidden globally for a fully branded, RTL-aware look.
 */
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
import { AppStoreProvider, useAuth } from '../store';
import { ThemeProvider, useTheme, useThemeColors } from '../theme/ThemeProvider';

// Crash reporting initializes ONCE, before any screen renders. Disabled in
// tests and (by default) in development; native + JS + promise-rejection
// capture in preview/production builds. See src/lib/observability.
initObservability();

void SplashScreen.preventAutoHideAsync();

/**
 * Hides the native splash once the persisted session has been resolved AND the
 * design-system fonts have settled.
 */
function SplashGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { ready: fontsReady } = useDesignSystemFonts();
  useEffect(() => {
    if (status !== 'loading' && fontsReady) void SplashScreen.hideAsync();
  }, [status, fontsReady]);
  return <>{children}</>;
}

function ThemedNavigation() {
  const { resolved } = useTheme();
  const colors = useThemeColors();

  return (
    <>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      {/* Push-notification taps → allow-listed internal routes only. */}
      <NotificationTapBridge />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.appBg } }}>
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
        <Stack.Screen name="account/delete" />
        <Stack.Screen name="profile/addresses" />
        <Stack.Screen name="profile/address/[id]" />
      </Stack>
    </>
  );
}

function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Above localization/state bootstrap so a bootstrap crash still renders
          the static bilingual observability fallback. */}
      <ObservabilityErrorBoundary>
        <ThemeProvider>
          <I18nProvider>
            <AppStoreProvider>
              <SplashGate>
                <ThemedNavigation />
              </SplashGate>
            </AppStoreProvider>
          </I18nProvider>
        </ThemeProvider>
      </ObservabilityErrorBoundary>
    </SafeAreaProvider>
  );
}

export default wrapRoot(RootLayout);
