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
import { useThemeColors } from '../../theme/ThemeProvider';
import { makeStyles } from '../../theme/makeStyles';
import { showsUnavailableCard, type WhatsAppLoginAvailability } from './loginAvailability';
import { PhoneOtpLogin } from './PhoneOtpLogin';

export function LoginScreen() {
  const colors = useThemeColors();
  const styles = useStyles();
  const { t, pick, lang, isRTL, rtlText } = useI18n();
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

          {availability === null ? (
            <LoadingView />
          ) : showsUnavailableCard(availability) ? (
            <View style={styles.unavailable}>
              <Text style={[styles.unavailableTitle, rtlText]}>{t('whatsappLoginNotAvailable')}</Text>
              <Text style={[styles.unavailableSub, rtlText]}>{t('whatsappLoginNotAvailableSub')}</Text>
            </View>
          ) : (
            <PhoneOtpLogin />
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

const useStyles = makeStyles((colors) => ({
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.sm },
  hero: { alignItems: 'flex-start', marginBottom: spacing.lg, gap: spacing.xs },
  heroRTL: { alignItems: 'flex-end' },
  welcome: { fontSize: font.xxl, fontWeight: '800', color: colors.accent, marginTop: spacing.md },
  sub: { fontSize: font.md, color: colors.muted },
  unavailable: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    backgroundColor: colors.bgAlt, padding: spacing.lg, gap: spacing.xs,
  },
  unavailableTitle: { fontSize: font.md, fontWeight: '800', color: colors.text },
  unavailableSub: { fontSize: font.sm, color: colors.muted, lineHeight: 20 },
  policy: { marginTop: spacing.xl, textAlign: 'center', color: colors.muted, fontSize: font.sm, lineHeight: 20 },
  policyLink: { color: colors.accent, fontWeight: '800' },
}));
