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

import { ObservabilityErrorBoundary } from '../components/ObservabilityErrorBoundary';
import { useDesignSystemFonts } from '../design-system/fonts';
import { NotificationTapBridge } from '../features/notifications/NotificationTapBridge';
import { I18nProvider } from '../i18n/I18nProvider';
import { initObservability, wrapRoot } from '../lib/observability';
import { AppStoreProvider, useAuth } from '../store';
import { colors } from '../theme';

// Crash reporting initializes ONCE, before any screen renders. Disabled in
// tests and (by default) in development; native + JS + promise-rejection
// capture in preview/production builds. See src/lib/observability.
initObservability();

void SplashScreen.preventAutoHideAsync();

/**
 * Hides the native splash once the persisted session has been resolved AND the
 * design-system fonts have settled.
 *
 * `fontsReady` is true when the fonts load OR fail — a font that will not
 * decode must never hold the splash open forever. Text still renders in the
 * system face in that case.
 */
function SplashGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { ready: fontsReady } = useDesignSystemFonts();
  useEffect(() => {
    if (status !== 'loading' && fontsReady) void SplashScreen.hideAsync();
  }, [status, fontsReady]);
  return <>{children}</>;
}

function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Above I18nProvider on purpose: a crash inside localization/state
          bootstrap still renders the (static, bilingual) fallback. */}
      <ObservabilityErrorBoundary>
      <I18nProvider>
        <AppStoreProvider>
          <SplashGate>
            <StatusBar style="dark" />
            {/* Push-notification taps → allow-listed internal routes only. */}
            <NotificationTapBridge />
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
              <Stack.Screen name="account/delete" />
            </Stack>
          </SplashGate>
        </AppStoreProvider>
      </I18nProvider>
      </ObservabilityErrorBoundary>
    </SafeAreaProvider>
  );
}

// Sentry.wrap: touch-event + startup profiler instrumentation around the root.
export default wrapRoot(RootLayout);
