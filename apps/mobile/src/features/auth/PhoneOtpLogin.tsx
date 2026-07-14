/**
 * Customer login via WhatsApp — powered by **Supabase Phone Auth**.
 *
 *   signInWithPhone → supabase.auth.signInWithOtp({ phone })   (Supabase makes OTP)
 *     → Supabase Auth calls the `auth-send-sms-whatsapp` Send SMS Hook
 *     → the code arrives on the customer's WhatsApp
 *   verifyPhone → supabase.auth.verifyOtp({ phone, token, type:'sms' })
 *     → returns a REAL session; AuthProvider.onChange routes the app in.
 *
 * This screen never generates a code, never calls the custom whatsapp-verify-otp
 * function, and never fakes a session — Supabase Auth is the login authority.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/I18nProvider';
import { toE164 } from '../../lib/phone';
import { OTP_RESEND_COOLDOWN_SECONDS, sanitizeOtpDigits } from '../otp/otpInput';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { auth } from '../../services/api';
import { colors, font, radius, spacing } from '../../theme';

type Phase = 'phone' | 'code';

export function PhoneOtpLogin() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('phone');
  const [phone, setPhone] = useState('');
  const [e164, setE164] = useState('');   // the canonical number sent to Supabase
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { cooldown, startCooldown, resetCooldown } = useOtpCooldown();

  const sendCode = async () => {
    setError(null); setNotice(null);
    const normalized = toE164(phone);
    if (!normalized) { setError(t('invalidPhone')); return; }
    setBusy(true);
    try {
      await auth.signInWithPhone(normalized);
      setE164(normalized);
      setPhase('code');
      setNotice(t('weSentLoginCode'));
      startCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      // Surface a safe message; Supabase returns an error when the hook can't
      // deliver (e.g. WhatsApp login disabled) or when rate-limited.
      setError(err instanceof Error && err.message ? err.message : t('loginCodeSendFailed'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{4,8}$/.test(code.trim())) { setError(t('invalidOrExpiredCode')); return; }
    setBusy(true);
    try {
      const session = await auth.verifyPhone(e164, code.trim());
      if (session) {
        // AuthProvider.onChange also fires; navigate eagerly for a snappy UI.
        router.replace('/(tabs)');
      } else {
        setError(t('invalidOrExpiredCode'));
      }
    } catch {
      setError(t('invalidOrExpiredCode'));
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    setPhase('phone'); setCode(''); setError(null); setNotice(null);
    resetCooldown();
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.title}>{t('loginPhoneTitle')}</Text>
      <Text style={styles.sub}>{t('loginPhoneSub')}</Text>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t('phoneNumberLabel')}</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          editable={phase === 'phone'}
          keyboardType="phone-pad"
          placeholder="05XXXXXXXX"
          placeholderTextColor={colors.muted}
          autoComplete="tel"
          style={[styles.input, phase !== 'phone' && styles.inputMuted]}
        />
      </View>

      {phase === 'phone' ? (
        <Button label={t('sendLoginCode')} onPress={sendCode} loading={busy} />
      ) : (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t('enterLoginCode')}</Text>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(sanitizeOtpDigits(v, 8))}
              keyboardType="number-pad"
              placeholder={t('enterLoginCode')}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.codeInput]}
              maxLength={8}
              autoFocus
            />
          </View>
          <Button label={t('verifyAndLogin')} onPress={verify} loading={busy} />
          <Button
            label={cooldown > 0 ? `${t('resendIn')} ${cooldown}s` : t('resendCode')}
            onPress={sendCode}
            disabled={busy || cooldown > 0}
            variant="ghost"
            style={{ marginTop: spacing.xs }}
          />
          <Button label={t('changeNumber')} onPress={changeNumber} disabled={busy} variant="ghost" />
        </>
      )}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  sub: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.sm },
  field: { marginBottom: spacing.md },
  fieldLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: font.md,
    color: colors.text, backgroundColor: colors.bgAlt,
  },
  inputMuted: { backgroundColor: colors.bg, color: colors.muted },
  codeInput: { letterSpacing: 6, textAlign: 'center', fontWeight: '800' },
  notice: { color: colors.success, fontSize: font.sm, fontWeight: '600', marginTop: spacing.xs },
  error: { color: colors.red, fontSize: font.sm, fontWeight: '600', marginTop: spacing.xs },
});
