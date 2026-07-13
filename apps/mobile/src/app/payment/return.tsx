/**
 * payment/return — the in-app landing for the `spicymeal://payment/return` deep
 * link that Tap's browser redirect bounces back to (via the payment-return Edge
 * Function). Its whole job is to resolve an interrupted payment on COLD START:
 * on Android the OS may relaunch the killed app straight into this route, so the
 * CheckoutScreen promise that would normally verify the charge never runs.
 *
 * It trusts NOTHING from the redirect except a strict-UUID `session` (or legacy
 * `order`) id, seeds the shared, unit-tested recovery (recoverPendingSession),
 * and routes: a captured charge → its receipt; anything unresolved → back to
 * checkout, whose mount effect resumes the SAME charge (never a new one).
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/I18nProvider';
import { payments } from '../../services/api';
import {
  recoverPendingSession,
} from '../../features/checkout/pendingSession';
import {
  clearPendingSession, loadPendingSession, savePendingSession,
} from '../../features/checkout/pendingSessionStore';
import { useCart } from '../../store';
import { colors, font, spacing } from '../../theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First value of a possibly-array route param, validated as a UUID (else ''). */
function uuidParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && UUID_RE.test(s) ? s : '';
}

export default function PaymentReturnRoute() {
  const params = useLocalSearchParams<{ session?: string; order?: string }>();
  const { pick } = useI18n();
  const cart = useCart();

  useEffect(() => {
    let active = true;
    void (async () => {
      // Legacy order-first deep link: the order already exists server-side — just
      // open its receipt (verification lives on that flow's screen, not here).
      const orderId = uuidParam(params.order);
      if (orderId) { cart.clear(); router.replace(`/receipt/${orderId}`); return; }

      // Session flow: the deep-link session id is authoritative for THIS return.
      // Persist it so the shared recovery resolves exactly this charge (and so a
      // subsequent cold checkout entry resumes the same one).
      const sid = uuidParam(params.session);
      if (sid) await savePendingSession(sid, Date.now());

      const rec = await recoverPendingSession({
        read: loadPendingSession,
        verify: (id) => payments.verifySession(id),
        clear: clearPendingSession,
      });
      if (!active) return;
      if (rec.kind === 'receipt') { cart.clear(); router.replace(`/receipt/${rec.orderId}`); return; }
      // Unresolved (resume) or terminal (cleared/none): hand back to checkout. Its
      // mount effect resumes a still-pending charge and shows a cleared/none one
      // as a normal, retryable checkout — never opening a second charge here.
      router.replace('/checkout');
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <ActivityIndicator size="large" color={colors.purple} />
      <Text style={styles.msg}>
        {pick('Confirming your payment…', 'جارٍ تأكيد الدفع…')}
      </Text>
      {/* Escape hatch if the redirect ever leaves us here longer than expected. */}
      <View style={styles.fallback}>
        <Button
          label={pick('Back to checkout', 'العودة إلى الدفع')}
          onPress={() => router.replace('/checkout')}
          variant="secondary"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  msg: { fontSize: font.md, color: colors.text, fontWeight: '700', textAlign: 'center' },
  fallback: { marginTop: spacing.xl, alignSelf: 'stretch' },
});
