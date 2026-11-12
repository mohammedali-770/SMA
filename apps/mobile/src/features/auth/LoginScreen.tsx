/** Customer authentication for the Spicy Meal app. */
import { Link, router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, Text as RNText, View,
} from 'react-native';

import { space, type as typeScale } from '../../design-system/generated/tokens';
import { Card } from '../../design-system/ui/Card';
import { Text } from '../../design-system/ui/Text';
import { Logo } from '../../components/Logo';
import { Screen } from '../../components/Screen';
import { LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalTitle } from '../../lib/legal';
import { useNavigationLatch } from '../../lib/useNavigationLatch';
import { auth } from '../../services/api';
import { makeStyles } from '../../theme/makeStyles';
import { showsUnavailableCard, type WhatsAppLoginAvailability } from './loginAvailability';
import { PhoneOtpLogin } from './PhoneOtpLogin';
import { HOME_ROUTE } from './returnPath';

/**
 * `returnTo` is the untrusted `next` parameter. PhoneOtpLogin checks it against
 * the allow-list when it navigates; nothing here acts on it.
 */
export function LoginScreen({ returnTo }: { returnTo?: string } = {}) {
  const { t, pick, lang } = useI18n();
  const styles = useStyles();
  // Signing in is optional until the customer needs an account (guest browsing,
  // App Store 5.1.1(v)), so this screen must never be a dead end. Back to where
  // they came from when there is one, otherwise the menu.
  //
  // Latched: a double press ran `router.back()` twice and overshot, landing on
  // Home instead of the screen the customer came from.
  const guardNavigation = useNavigationLatch();
  const keepBrowsing = () =>
    guardNavigation(() => (router.canGoBack() ? router.back() : router.replace(HOME_ROUTE)));
  const [availability, setAvailability] = useState<WhatsAppLoginAvailability | null>(null);

  useEffect(() => {
    let alive = true;
    auth.whatsappLoginAvailability()
      .then((a) => { if (alive) setAvailability(a); })
      .catch(() => { if (alive) setAvailability('unknown'); });
    return () => { alive = false; };
  }, []);

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/*
            The brand IS the header. There is no headline or marketing line
            under the mark any more: on a screen whose only job is one phone
            field, every extra sentence was something to read before you could
            act. What remains is the launch screen's own lockup.
          */}
          <View style={styles.hero}>
            <Logo stacked />
          </View>

          {availability === null ? (
            <LoadingView />
          ) : showsUnavailableCard(availability) ? (
            <Card tone="warning">
              <Text variant="heading">{t('whatsappLoginNotAvailable')}</Text>
              <Text variant="body" tone="secondary">{t('whatsappLoginNotAvailableSub')}</Text>
            </Card>
          ) : (
            <PhoneOtpLogin returnTo={returnTo} />
          )}

          <RNText style={styles.browse} onPress={keepBrowsing} accessibilityRole="button">
            {pick('Not now — keep browsing', 'ليس الآن — متابعة التصفح')}
          </RNText>

          <RNText style={styles.policy}>
            {pick('By continuing, you agree to the ', 'بمتابعتك، فإنك توافق على ')}
            {/* A Link, not a pressable span: it is role=link and a real <a href>
                on the web, so Tab reaches it and Enter opens it (R07#5). */}
            <Link href="/legal/terms_conditions" push style={styles.policyLink} accessibilityRole="link">
              {legalTitle('terms_conditions', lang)}
            </Link>
            {pick(' and ', ' و')}
            <Link href="/legal/privacy_policy" push style={styles.policyLink} accessibilityRole="link">
              {legalTitle('privacy_policy', lang)}
            </Link>
            {'.'}
          </RNText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  scroll: { padding: space.s5, paddingBottom: space.s6, gap: space.s3 },
  // Centred in BOTH languages — the lockup is the one block on this screen with
  // no reading direction. The form below it keeps the reading edge.
  hero: { alignItems: 'center' as const, marginTop: space.s5, marginBottom: space.s6 },
  browse: {
    marginTop: space.s4,
    textAlign: 'center' as const,
    color: color.emberText,
    fontSize: typeScale.body.size,
    fontWeight: '700' as const,
  },
  policy: {
    marginTop: space.s5,
    textAlign: 'center' as const,
    color: color.appText3,
    fontSize: typeScale.caption.size,
    lineHeight: typeScale.body.lineHeight,
  },
  // `emberText`, not `ember`: this is caption-size text, so WCAG AA wants
  // 4.5:1 and `ember` gives 4.08 light / 3.15 dark. It stays red — red is the
  // interactive colour — just at an ink that clears the threshold.
  policyLink: { color: color.emberText, fontWeight: '700' as const },
}));
