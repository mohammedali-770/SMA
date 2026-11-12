/**
 * payment/checkout — the in-app secure-payment screen. It renders Moyasar's
 * hosted invoice page INSIDE the app (react-native-webview), the only surface
 * the app uses for online payment, so the customer stays in Spicy Meal the whole
 * time — card entry, Apple Pay and the bank's 3-D Secure challenge included.
 *
 * What it does NOT do: it never reads card data, never injects JS into the
 * page, and never decides that a payment succeeded. Its ONLY payment signal is
 * "the WebView reached our payment-return URL"; it then hands back to
 * CheckoutScreen, which asks the server (payment-verify) what actually happened.
 * Every navigation is run through the pure policy in webviewPolicy.ts.
 *
 * The invoice URL (a payable link) is taken from the in-memory handoff by session
 * id — it is never a route param and never logged.
 *
 * The WebView props are the security surface (see the notes beside each one),
 * and paymentWebViewWiring.test.ts pins them.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type WebViewNavigation } from 'react-native-webview';
// Platform-split: native re-exports react-native-webview verbatim; web renders
// a clean "app-only" state for online payment.
import { WebView } from '../../components/PaymentWebView';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { Header } from '../../components/Header';
import { color, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { SUPABASE_URL } from '../../lib/env';
import { readCheckoutHandoff, settleCheckoutHandoff, type CheckoutHandoffResult } from '../../features/checkout/checkoutHandoff';
import { decideNavigation, safeHostForLog, type WebviewNavConfig } from '../../features/checkout/webviewPolicy';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && UUID_RE.test(s) ? s : '';
}

function hostOf(u: string): string {
  try { return new URL(u).hostname; } catch { return ''; }
}

export default function PaymentCheckoutScreen() {
  const styles = useStyles();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ session?: string }>();
  const insets = useSafeAreaInsets();
  const { t, pick } = useI18n();

  const sessionId = uuidParam(params.session);
  // Take the invoice URL from the in-memory handoff ONCE (lazy init — never a ref read
  // during render). It never lives in route params or storage. If it's absent (app
  // relaunched straight into this route, or the handoff was already settled), there
  // is nothing to resume here — we fall back to checkout, whose recovery resolves
  // any in-flight charge.
  const [checkoutUrl] = useState<string | null>(() =>
    sessionId ? (readCheckoutHandoff(sessionId)?.checkoutUrl ?? null) : null,
  );

  const [loading, setLoading] = useState(true);
  const [firstLoaded, setFirstLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const webRef = useRef<WebView>(null);
  const settledRef = useRef(false);

  const cfg: WebviewNavConfig = {
    returnHost: hostOf(SUPABASE_URL),
    returnPath: '/functions/v1/payment-return',
  };

  // Settle the handoff exactly once and leave the screen. 'completed' resumes the
  // awaiting CheckoutScreen, which then runs the authoritative server verify;
  // 'dismissed' does the same (verify decides — a dismissal is never a failure).
  const finish = (result: CheckoutHandoffResult) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (sessionId) settleCheckoutHandoff(sessionId, result);
    if (router.canGoBack()) router.back();
    else router.replace('/checkout');
  };

  // No session / no in-flight url → nothing to render; hand back immediately.
  useEffect(() => {
    if (!sessionId || !checkoutUrl) finish('dismissed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android hardware back = dismiss (same as the header Close). Safety-net cleanup
  // settles the handoff on any other unmount path so CheckoutScreen never hangs.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish('dismissed');
      return true;
    });
    return () => {
      sub.remove();
      if (!settledRef.current && sessionId) settleCheckoutHandoff(sessionId, 'dismissed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gate EVERY navigation through the pure allow-list. 'complete' → hand back to
  // the app (server verify decides). 'block' → refuse. 'allow' → load it.
  const onShouldStart = (req: ShouldStartLoadRequest): boolean => {
    const res = decideNavigation(req.url, cfg);
    if (__DEV__) {
      // Safe hostname only — never a path, query string or token.
      console.log(`[pay-webview] ${res.decision} (${res.reason}) host=${safeHostForLog(req.url)}`);
    }
    if (res.decision === 'complete') { finish('completed'); return false; }
    return res.decision === 'allow';
  };

  // Belt-and-suspenders: some redirect chains only surface via the nav-state
  // callback. Detect completion here too (we can't block here — that's what
  // onShouldStart is for).
  const onNavStateChange = (nav: WebViewNavigation) => {
    if (decideNavigation(nav.url, cfg).decision === 'complete') finish('completed');
  };

  const reload = () => {
    setFailed(false);
    setLoading(true);
    webRef.current?.reload();
  };

  return (
    <View style={styles.root}>
      <Header
        title={pick('Secure Payment', 'الدفع الآمن')}
        left={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pick('Close', 'إغلاق')}
            onPress={() => finish('dismissed')}
            hitSlop={8}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text variant="label" tone="ember">{pick('Close', 'إغلاق')}</Text>
          </Pressable>
        )}
        safeTop
      />
      <View style={styles.body}>
        {checkoutUrl ? (
          <WebView
            ref={webRef}
            source={{ uri: checkoutUrl }}
            // originWhitelist MUST be ['*'] so EVERY navigation reaches our
            // onShouldStartLoadWithRequest gate. react-native-webview checks the
            // whitelist FIRST and, for any non-matching URL, silently does
            // Linking.openURL(url) (external browser / arbitrary app) instead of
            // calling our handler. A narrow list would therefore hand http://,
            // tel:, intent://, market:// … to the OS behind our back. With ['*']
            // our decideNavigation is the sole authority: it 'block's everything
            // that is not https (returns false → not loaded AND not opened
            // externally).
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={onShouldStart}
            onNavigationStateChange={onNavStateChange}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => { setLoading(false); setFirstLoaded(true); }}
            onError={() => { setLoading(false); setFailed(true); }}
            onHttpError={() => { setLoading(false); setFailed(true); }}
            // The hosted page and the bank's 3-D Secure need JS, DOM storage and
            // cookies. We add NO JS of our own — no injectedJavaScript, no
            // message bridge reading the page.
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            // iOS only (a no-op on Android): lets the page offer Apple Pay.
            // Without it react-native-webview adds its own history-shim user
            // script to every page (14.0.1 RNCWebViewImpl.m, resetupScripts),
            // and WebKit refused Apple Pay beside injected scripts until iOS 16
            // (Safari 13 and 16 release notes; the app's floor is iOS 16.4). With
            // it the library injects nothing at all, and injectJavaScript,
            // injectedJavaScript and sharedCookiesEnabled stop working — this
            // screen uses none of them.
            enableApplePay
            // Android: a target=_blank link or window.open loads in this same
            // WebView, under the policy, instead of escaping to the system
            // browser. react-native-webview documents that false re-exposes
            // CVE-2020-6506 (a cross-origin iframe reaching the top document);
            // the pages loaded here are Moyasar's and the card issuer's.
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures={false}
            startInLoadingState={false}
            style={styles.web}
          />
        ) : null}

        {failed ? (
          <View style={styles.overlay}>
            <Text variant="heading" align="center">{t('payScreenError')}</Text>
            <View style={styles.errActions}>
              <Button label={t('payTryAgain')} onPress={reload} variant="primary" />
              <Button label={pick('Close', 'إغلاق')} onPress={() => finish('dismissed')} variant="secondary" />
            </View>
          </View>
        ) : loading && !firstLoaded ? (
          // Opaque loader only before the first paint; later page and 3-D Secure
          // transitions render on the page itself so we don't blank an
          // interactive checkout.
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.ember} />
            <Text variant="body" tone="secondary" align="center">{t('payScreenLoading')}</Text>
          </View>
        ) : null}
      </View>
      {/* Reassurance strip: this is a hosted, secure page; we never see card data. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.s2 }]}>
        <Text variant="caption" tone="tertiary" align="center">
          {pick('Your card details are entered on Moyasar’s secure page.', 'تُدخل بيانات بطاقتك في صفحة Moyasar الآمنة.')}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.appBg },
  body: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.appBg },
  close: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space.s2 },
  pressed: { opacity: 0.7 },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: space.s4, padding: space.s5,
    backgroundColor: colors.appBg,
  },
  errActions: { alignSelf: 'stretch', gap: space.s2, marginTop: space.s3 },
  footer: {
    backgroundColor: colors.appSurface, borderTopWidth: 1, borderTopColor: colors.appLine,
    paddingHorizontal: space.s4, paddingTop: space.s2,
  },
}));
