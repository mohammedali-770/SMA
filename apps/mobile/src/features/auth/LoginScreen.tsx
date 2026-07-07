/**
 * Email/password sign-in and sign-up against Supabase Auth (GoTrue). On success
 * the AuthProvider flips to signed_in via onAuthStateChange; we navigate to the
 * tabs. Phone/OTP is intentionally out of scope for this pass.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { Button } from '../../components/Button';
import { Logo } from '../../components/Logo';
import { Screen } from '../../components/Screen';
import { useI18n } from '../../i18n/I18nProvider';
import { auth } from '../../services/api';
import { colors, font, radius, spacing } from '../../theme';

type Mode = 'signin' | 'signup';

export function LoginScreen() {
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
      setError(t('somethingWentWrong'));
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await auth.signIn(email.trim(), password);
        router.replace('/(tabs)');
      } else {
        if (!fullName.trim()) {
          setError(t('somethingWentWrong'));
          setBusy(false);
          return;
        }
        await auth.signUp(email.trim(), password, fullName.trim(), phone.trim() || undefined);
        // If email confirmation is disabled, a session already exists and the
        // AuthProvider will route us in. Otherwise, prompt to sign in.
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

          <Pressable onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }} style={styles.switch}>
            <Text style={styles.switchText}>{mode === 'signin' ? t('haveNoAccount') : t('haveAccount')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
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
  switchText: { color: colors.purple, fontSize: font.md, fontWeight: '700' },
});
