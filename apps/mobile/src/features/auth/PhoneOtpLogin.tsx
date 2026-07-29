/**
 * Customer login via WhatsApp — powered by **Supabase Phone Auth**. This is the
 * app's ONLY login path, and it is Saudi-only.
 *
 *   signInWithPhone → supabase.auth.signInWithOtp({ phone })   (Supabase makes OTP)
 *     → Supabase Auth calls the `auth-send-sms-whatsapp` Send SMS Hook
 *     → the code arrives on the customer's WhatsApp
 *   verifyPhone → supabase.auth.verifyOtp({ phone, token, type:'sms' })
 *     → returns a REAL session; AuthProvider.onChange routes the app in.
 *
 * The field holds the 9-digit national part; `+966` is fixed by the UI and the
 * canonical `+9665XXXXXXXX` is derived once, here, so signInWithOtp, verifyOtp
 * and the hook all agree on the same string. The hook re-checks Saudi-ness
 * server-side — this screen is convenience, not the enforcement point.
 *
 * This screen never generates a code, never calls the custom whatsapp-verify-otp
 * function, and never fakes a session — Supabase Auth is the login authority.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { SaudiPhoneInput } from '../../components/SaudiPhoneInput';
import { useI18n } from '../../i18n/I18nProvider';
import { formatSaudiE164, isSaudiMobile, toSaudiE164 } from '../../lib/phone';
import { DEFAULT_OTP_LENGTH } from '../otp/otpAutofill';
import { OtpCodeInput } from '../otp/OtpCodeInput';
import { OTP_RESEND_COOLDOWN_SECONDS } from '../otp/otpInput';
import { useOtpAutofill } from '../otp/useOtpAutofill';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { auth } from '../../services/api';
import { colors, font, spacing } from '../../theme';
import { requestLoginCode } from './loginAvailability';

type Phase = 'phone' | 'code';

export function PhoneOtpLogin() {
  const { t, rtlText } = useI18n();
  const [phase, setPhase] = useState<Phase>('phone');
  const [national, setNational] = useState('');  // 9-digit national part (5XXXXXXXX)
  const [e164, setE164] = useState('');          // the canonical number sent to Supabase
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { cooldown, startCooldown, resetCooldown } = useOtpCooldown();

  const sendCode = async () => {
    setError(null); setNotice(null);
    const normalized = toSaudiE164(national);
    if (!normalized) { setError(t('invalidSaudiPhone')); return; }
    setBusy(true);
    // The server is the authority on whether a code can be sent: the login
    // screen may render this form on an unreadable feature flag, but only a
    // successful send advances to the code step. A rejection — including the
    // hook's "WhatsApp login is temporarily unavailable" when login is really
    // off, or a rate limit — surfaces here and leaves us on the phone step.
    const outcome = await requestLoginCode((p) => auth.signInWithPhone(p), normalized);
    if (outcome.status === 'sent') {
      setE164(normalized);
      setPhase('code');
      setNotice(t('weSentLoginCode'));
      startCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } else {
      setError(outcome.message ?? t('loginCodeSendFailed'));
    }
    setBusy(false);
  };

  const verify = async (codeArg?: string) => {
    setError(null);
    const value = (codeArg ?? code).trim();
    if (!/^\d{4,8}$/.test(value)) { setError(t('invalidOrExpiredCode')); return; }
    setBusy(true);
    try {
      const session = await auth.verifyPhone(e164, value);
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

  // Zero-tap autofill (WebOTP on web; declarative on native). Only listens on the
  // code step; on read it fills the boxes and hands the code straight to verify.
  useOtpAutofill({
    enabled: phase === 'code',
    length: DEFAULT_OTP_LENGTH,
    onCode: (c) => { setCode(c); void verify(c); },
  });

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[styles.title, rtlText]}>{t('loginPhoneTitle')}</Text>
      <Text style={[styles.sub, rtlText]}>{t('loginPhoneSub')}</Text>

      <SaudiPhoneInput
        value={national}
        onChangeText={setNational}
        editable={phase === 'phone'}
        showHint={phase === 'phone'}
        style={styles.field}
      />

      {phase === 'phone' ? (
        <Button label={t('sendLoginCode')} onPress={sendCode} loading={busy} disabled={!isSaudiMobile(national)} />
      ) : (
        <>
          <Text style={styles.sentTo}>{formatSaudiE164(e164)}</Text>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, rtlText]}>{t('enterLoginCode')}</Text>
            <OtpCodeInput
              value={code}
              onChange={setCode}
              length={DEFAULT_OTP_LENGTH}
              onComplete={(c) => verify(c)}
              autoFocus
              accessibilityLabel={t('enterLoginCode')}
            />
          </View>
          <Button label={t('verifyAndLogin')} onPress={() => verify()} loading={busy} />
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

      {notice ? <Text style={[styles.notice, rtlText]}>{notice}</Text> : null}
      {error ? <Text style={[styles.error, rtlText]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  sub: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.sm },
  field: { marginBottom: spacing.md },
  fieldLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  // The number the code went to — always LTR so it reads correctly in Arabic.
  sentTo: {
    fontSize: font.md, fontWeight: '800', color: colors.purple,
    textAlign: 'center', writingDirection: 'ltr', marginBottom: spacing.sm,
  },
  notice: { color: colors.success, fontSize: font.sm, fontWeight: '600', marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: font.sm, fontWeight: '600', marginTop: spacing.xs },
});
