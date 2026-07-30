/**
 * Customer authentication for the Spicy Meal app.
 *
 * **WhatsApp is the only way in.** Supabase Phone Auth (signInWithOtp /
 * verifyOtp) with the OTP delivered over WhatsApp by the Send SMS hook —
 * verifyOtp returns a genuine session. There is no email/password path here:
 * customers are Saudi and log in with a `+966` mobile, nothing else.
 *
 * Admin/staff do NOT log in here (they use the web dashboard's email/password);
 * a customer signing in this way gets a profile with role 'customer'.
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text as RNText, View,
} from 'react-native';

import { color, space, type as typeScale } from '../../design-system/generated/tokens';
import { Card } from '../../design-system/ui/Card';
import { Text } from '../../design-system/ui/Text';
import { Logo } from '../../components/Logo';
import { Screen } from '../../components/Screen';
import { LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalTitle } from '../../lib/legal';
import { auth } from '../../services/api';
import { showsUnavailableCard, type WhatsAppLoginAvailability } from './loginAvailability';
import { PhoneOtpLogin } from './PhoneOtpLogin';

export function LoginScreen() {
  const { t, pick, lang, isRTL } = useI18n();
  // null = still asking. Then a TRI-STATE: only a CONFIRMED 'disabled' hides the
  // form. An unreadable flag ('unknown' — network / RPC / RLS error) must never
  // render the unavailable card, because WhatsApp is the only way in and a
  // transient read failure would lock customers out of a working app. On
  // 'unknown' we show the form and let the send hook, which fails closed, be
  // the authority.
  const [availability, setAvailability] = useState<WhatsAppLoginAvailability | null>(null);

  useEffect(() => {
    let alive = true;
    auth.whatsappLoginAvailability()
      .then((a) => { if (alive) setAvailability(a); })
      // whatsappLoginAvailability() already resolves 'unknown' instead of
      // rejecting; this is belt-and-braces so no future change can strand the
      // screen on the loading state.
      .catch(() => { if (alive) setAvailability('unknown'); });
    return () => { alive = false; };
  }, []);

  return (
    <Screen background={color.appBg}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, isRTL && styles.heroRTL]}>
            <Logo />
            <Text variant="display" style={styles.welcome}>{t('welcome')}</Text>
            <Text variant="body" tone="secondary">{t('authSub')}</Text>
          </View>

          {availability === null ? (
            <LoadingView />
          ) : showsUnavailableCard(availability) ? (
            <Card tone="warning">
              <Text variant="heading">{t('whatsappLoginNotAvailable')}</Text>
              <Text variant="body" tone="secondary">{t('whatsappLoginNotAvailableSub')}</Text>
            </Card>
          ) : (
            <PhoneOtpLogin />
          )}

          {/* Legal links — open the relevant documents (no forced acceptance). */}
          {/* Inline links must compose inside ONE Text node, so this uses the
              platform Text directly rather than the design-system wrapper. */}
          <RNText style={styles.policy}>
            {pick('By continuing, you agree to the ', 'بمتابعتك، فإنك توافق على ')}
            <RNText style={styles.policyLink} onPress={() => router.push('/legal/terms_conditions')}>
              {legalTitle('terms_conditions', lang)}
            </RNText>
            {pick(' and ', ' و')}
            <RNText style={styles.policyLink} onPress={() => router.push('/legal/privacy_policy')}>
              {legalTitle('privacy_policy', lang)}
            </RNText>
            {'.'}
          </RNText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.s5, paddingBottom: space.s6, gap: space.s3 },
  hero: { alignItems: 'flex-start', marginBottom: space.s5, gap: space.s1 },
  heroRTL: { alignItems: 'flex-end' },
  welcome: { marginTop: space.s3 },
  policy: {
    marginTop: space.s5,
    textAlign: 'center',
    color: color.appText3,
    fontSize: typeScale.caption.size,
    lineHeight: typeScale.body.lineHeight,
  },
  policyLink: { color: color.ember, fontWeight: '700' },
});
