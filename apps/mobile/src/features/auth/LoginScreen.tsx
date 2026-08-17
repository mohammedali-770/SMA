/** Customer authentication for the Spicy Meal app. */
import { router } from 'expo-router';
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
import { auth } from '../../services/api';
import { makeStyles } from '../../theme/makeStyles';
import { showsUnavailableCard, type WhatsAppLoginAvailability } from './loginAvailability';
import { PhoneOtpLogin } from './PhoneOtpLogin';

export function LoginScreen() {
  const { t, pick, lang } = useI18n();
  const styles = useStyles();
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
            <PhoneOtpLogin />
          )}

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

const useStyles = makeStyles((color) => ({
  scroll: { padding: space.s5, paddingBottom: space.s6, gap: space.s3 },
  // Centred in BOTH languages — the lockup is the one block on this screen with
  // no reading direction. The form below it keeps the reading edge.
  hero: { alignItems: 'center' as const, marginTop: space.s5, marginBottom: space.s6 },
  policy: {
    marginTop: space.s5,
    textAlign: 'center' as const,
    color: color.appText3,
    fontSize: typeScale.caption.size,
    lineHeight: typeScale.body.lineHeight,
  },
  policyLink: { color: color.ember, fontWeight: '700' as const },
}));
