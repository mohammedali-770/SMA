/**
 * Customer authentication for the Spicy Meal app.
 *
 * Primary path: **Login with WhatsApp** — Supabase Phone Auth (signInWithOtp /
 * verifyOtp) with the OTP delivered over WhatsApp by the Send SMS hook. This is
 * the real login: verifyOtp returns a genuine session.
 *
 * Fallback path: email + password (existing customers, or whenever WhatsApp
 * login isn't configured/enabled — `auth.whatsappLoginEnabled()` returns false).
 *
 * Admin/staff do NOT log in here (they use the web dashboard's email/password);
 * whichever path a customer uses, the profile is created with role 'customer'.
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { Button } from '../../components/Button';
import { Logo } from '../../components/Logo';
import { Screen } from '../../components/Screen';
import { LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalTitle } from '../../lib/legal';
import { auth } from '../../services/api';
import { colors, font, radius, spacing } from '../../theme';
import { PhoneOtpLogin } from './PhoneOtpLogin';

type Method = 'whatsapp' | 'email';
type Mode = 'signin' | 'signup';

export function LoginScreen() {
  const { t, pick, lang } = useI18n();
  const [method, setMethod] = useState<Method | null>(null);
  const [waEnabled, setWaEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    auth.whatsappLoginEnabled().then((enabled) => {
      if (!alive) return;
      setWaEnabled(enabled);
      setMethod((m) => m ?? (enabled ? 'whatsapp' : 'email'));
    }).catch(() => {
      if (alive) setMethod((m) => m ?? 'email');
    });
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
          <View style={styles.hero}>
            <Logo />
            <Text style={styles.welcome}>{t('welcome')}</Text>
            <Text style={styles.sub}>{t('authSub')}</Text>
          </View>

          {method === null ? (
            <LoadingView />
          ) : method === 'whatsapp' ? (
            <>
              <PhoneOtpLogin />
              <Pressable onPress={() => setMethod('email')} style={styles.switch}>
                <Text style={styles.switchText}>{t('useEmailInstead')}</Text>
              </Pressable>
            </>
          ) : (
            <EmailAuth showWhatsAppSwitch={waEnabled} onUseWhatsApp={() => setMethod('whatsapp')} />
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

/** Email + password sign-in / sign-up (the fallback path). */
function EmailAuth({ showWhatsAppSwitch, onUseWhatsApp }: { showWhatsAppSwitch: boolean; onUseWhatsApp: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError(t('fillRequiredFields'));
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await auth.signIn(email.trim(), password);
        router.replace('/(tabs)');
      } else {
        if (!fullName.trim()) {
          setError(t('fillRequiredFields'));
          setBusy(false);
          return;
        }
        await auth.signUp(email.trim(), password, fullName.trim(), phone.trim() || undefined);
        const session = await auth.getSession();
        if (session) {
          router.replace('/(tabs)');
        } else {
          setNotice(t('signUpCheckEmail'));
          setMode('signin');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={styles.title}>{mode === 'signin' ? t('signInTitle') : t('signUpTitle')}</Text>

      {mode === 'signup' && (
        <Field label={t('fullName')} value={fullName} onChangeText={setFullName} placeholder={t('namePlaceholder')} />
      )}

      <Field
        label={t('email')}
        value={email}
        onChangeText={setEmail}
        placeholder={t('emailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Field
        label={t('password')}
        value={password}
        onChangeText={setPassword}
        placeholder={t('passwordPlaceholder')}
        secureTextEntry
        autoCapitalize="none"
      />
      {mode === 'signup' && (
        <Field
          label={t('phoneOptional')}
          value={phone}
          onChangeText={setPhone}
          placeholder={t('phonePlaceholder')}
          keyboardType="phone-pad"
        />
      )}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={mode === 'signin' ? t('signInBtn') : t('signUpBtn')}
        onPress={submit}
        loading={busy}
        style={{ marginTop: spacing.md }}
      />

      <Pressable accessibilityRole="button" onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }} style={styles.switch}>
        <Text style={styles.switchText}>{mode === 'signin' ? t('haveNoAccount') : t('haveAccount')}</Text>
      </Pressable>

      {showWhatsAppSwitch && (
        <Pressable accessibilityRole="button" onPress={onUseWhatsApp} style={styles.switchAlt}>
          <Text style={styles.switchText}>{t('useWhatsappInstead')}</Text>
        </Pressable>
      )}
    </>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.sm },
  hero: { alignItems: 'flex-start', marginBottom: spacing.lg, gap: spacing.xs },
  welcome: { fontSize: font.xxl, fontWeight: '800', color: colors.purple, marginTop: spacing.md },
  sub: { fontSize: font.md, color: colors.muted },
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginVertical: spacing.sm },
  field: { marginBottom: spacing.md },
  fieldLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.bgAlt,
  },
  error: { color: colors.red, fontSize: font.sm, fontWeight: '600', marginTop: spacing.xs },
  notice: { color: colors.success, fontSize: font.sm, fontWeight: '600', marginTop: spacing.xs },
  switch: { marginTop: spacing.xl, alignItems: 'center' },
  switchAlt: { marginTop: spacing.md, alignItems: 'center' },
  switchText: { color: colors.purple, fontSize: font.md, fontWeight: '700' },
  policy: { marginTop: spacing.xl, textAlign: 'center', color: colors.muted, fontSize: font.sm, lineHeight: 20 },
  policyLink: { color: colors.purple, fontWeight: '800' },
});
