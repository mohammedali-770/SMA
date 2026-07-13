/**
 * payment/checkout — the in-app Tap hosted-checkout screen. It renders the Tap
 * checkout page INSIDE the app (react-native-webview) instead of handing off to
 * the external browser, so the customer stays in Spicy Meal the whole time.
 *
 * What it does NOT do: it never reads card data, never injects JS into the Tap
 * page, and never decides that a payment succeeded. Its ONLY payment signal is
 * "the WebView reached our payment-return URL"; it then hands back to
 * CheckoutScreen, which asks the server (payment-verify) what actually happened.
 * Every navigation is run through the pure allow-list in webviewPolicy.ts.
 *
 * The Tap checkout URL (which carries a short-lived token) is taken from the
 * in-memory handoff by session id — it is never a route param and never logged.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { useI18n } from '../../i18n/I18nProvider';
import { SUPABASE_URL } from '../../lib/env';
import { readCheckoutHandoff, settleCheckoutHandoff, type CheckoutHandoffResult } from '../../features/checkout/checkoutHandoff';
import { decideNavigation, safeHostForLog, type WebviewNavConfig } from '../../features/checkout/webviewPolicy';
import { colors, font, spacing } from '../../theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && UUID_RE.test(s) ? s : '';
}

function hostOf(u: string): string {
  try { return new URL(u).hostname; } catch { return ''; }
}

export default function PaymentCheckoutScreen() {
  const params = useLocalSearchParams<{ session?: string }>();
  const insets = useSafeAreaInsets();
  const { t, pick } = useI18n();

  const sessionId = uuidParam(params.session);
  // Take the Tap URL from the in-memory handoff ONCE (lazy init — never a ref read
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
    checkoutHost: hostOf(checkoutUrl ?? ''),
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
          <Text
            accessibilityRole="button"
            onPress={() => finish('dismissed')}
            style={styles.close}
          >
            {pick('Close', 'إغلاق')}
          </Text>
        )}
      />
      <View style={styles.body}>
        {checkoutUrl ? (
          <WebView
            ref={webRef}
            source={{ uri: checkoutUrl }}
            // Only https ever loads in-frame; the app scheme is caught by our
            // handler (returns false) rather than erroring.
            originWhitelist={['https://*', 'spicymeal://*']}
            onShouldStartLoadWithRequest={onShouldStart}
            onNavigationStateChange={onNavStateChange}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => { setLoading(false); setFirstLoaded(true); }}
            onError={() => { setLoading(false); setFailed(true); }}
            onHttpError={() => { setLoading(false); setFailed(true); }}
            // Tap's web checkout needs JS + cookies (session, 3DS). We add NO JS of
            // our own — no injectedJavaScript, no message bridge reading the page.
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            // Keep every navigation inside this WebView so the allow-list governs
            // it; no popups / new windows can escape the policy.
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures={false}
            startInLoadingState={false}
            style={styles.web}
          />
        ) : null}

        {failed ? (
          <View style={styles.overlay}>
            <Text style={styles.errTitle}>{t('payScreenError')}</Text>
            <View style={styles.errActions}>
              <Button label={t('payTryAgain')} onPress={reload} variant="danger" />
              <Button label={pick('Close', 'إغلاق')} onPress={() => finish('dismissed')} variant="secondary" />
            </View>
          </View>
        ) : loading && !firstLoaded ? (
          // Opaque loader only before the first paint; later Tap/3DS transitions
          // render on the page itself so we don't blank an interactive checkout.
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.purple} />
            <Text style={styles.loadingMsg}>{t('payScreenLoading')}</Text>
          </View>
        ) : null}
      </View>
      {/* Reassurance strip: this is a hosted, secure page; we never see card data. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Text style={styles.footerText}>
          {pick('Your card details are entered on Tap’s secure page.', 'تُدخل بيانات بطاقتك في صفحة Tap الآمنة.')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.bg },
  close: { color: colors.purple, fontWeight: '800', fontSize: font.md, paddingVertical: spacing.xs },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  loadingMsg: { color: colors.muted, fontSize: font.md, fontWeight: '700', textAlign: 'center' },
  errTitle: { color: colors.text, fontSize: font.md, fontWeight: '800', textAlign: 'center', lineHeight: 22 },
  errActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md },
  footer: {
    backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
  },
  footerText: { color: colors.muted, fontSize: font.xs, textAlign: 'center' },
});
