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
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { Logo } from '../../components/Logo';
import { Screen } from '../../components/Screen';
import { LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalTitle } from '../../lib/legal';
import { auth } from '../../services/api';
import { colors, font, radius, spacing } from '../../theme';
import { PhoneOtpLogin } from './PhoneOtpLogin';

export function LoginScreen() {
  const { t, pick, lang, isRTL, rtlText } = useI18n();
  // null = still asking. Login is WhatsApp-only, so a `false` here means the
  // door is genuinely shut (WhatsApp not configured/enabled) and we say so
  // rather than offering a path that no longer exists.
  const [waEnabled, setWaEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    auth.whatsappLoginEnabled()
      .then((enabled) => { if (alive) setWaEnabled(enabled); })
      // A failed flag read must never lock customers out: show the form and let
      // the server stay the authority on whether a code can be sent.
      .catch(() => { if (alive) setWaEnabled(true); });
    return () => { alive = false; };
  }, []);

  return (
    <Screen background={colors.white}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, isRTL && styles.heroRTL]}>
            <Logo />
            <Text style={[styles.welcome, rtlText]}>{t('welcome')}</Text>
            <Text style={[styles.sub, rtlText]}>{t('authSub')}</Text>
          </View>

          {waEnabled === null ? (
            <LoadingView />
          ) : waEnabled ? (
            <PhoneOtpLogin />
          ) : (
            <View style={styles.unavailable}>
              <Text style={[styles.unavailableTitle, rtlText]}>{t('whatsappLoginNotAvailable')}</Text>
              <Text style={[styles.unavailableSub, rtlText]}>{t('whatsappLoginNotAvailableSub')}</Text>
            </View>
          )}

          {/* Legal links — open the relevant documents (no forced acceptance). */}
          <Text style={styles.policy}>
            {pick('By continuing, you agree to the ', 'بمتابعتك، فإنك توافق على ')}
            <Text style={styles.policyLink} onPress={() => router.push('/legal/terms_conditions')}>
              {legalTitle('terms_conditions', lang)}
            </Text>
            {pick(' and ', ' و')}
            <Text style={styles.policyLink} onPress={() => router.push('/legal/privacy_policy')}>
              {legalTitle('privacy_policy', lang)}
            </Text>
            {'.'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.sm },
  hero: { alignItems: 'flex-start', marginBottom: spacing.lg, gap: spacing.xs },
  heroRTL: { alignItems: 'flex-end' },
  welcome: { fontSize: font.xxl, fontWeight: '800', color: colors.purple, marginTop: spacing.md },
  sub: { fontSize: font.md, color: colors.muted },
  unavailable: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    backgroundColor: colors.bgAlt, padding: spacing.lg, gap: spacing.xs,
  },
  unavailableTitle: { fontSize: font.md, fontWeight: '800', color: colors.text },
  unavailableSub: { fontSize: font.sm, color: colors.muted, lineHeight: 20 },
  policy: { marginTop: spacing.xl, textAlign: 'center', color: colors.muted, fontSize: font.sm, lineHeight: 20 },
  policyLink: { color: colors.purple, fontWeight: '800' },
});
