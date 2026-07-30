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
import { StyleSheet, View } from 'react-native';

import { color, fontFamily, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Text } from '../../design-system/ui/Text';
import { SaudiPhoneInput } from '../../components/SaudiPhoneInput';
import { useI18n } from '../../i18n/I18nProvider';
import { formatSaudiE164, isSaudiMobile, toSaudiE164 } from '../../lib/phone';
import { DEFAULT_OTP_LENGTH } from '../otp/otpAutofill';
import { OtpCodeInput } from '../otp/OtpCodeInput';
import { OTP_RESEND_COOLDOWN_SECONDS } from '../otp/otpInput';
import { useOtpAutofill } from '../otp/useOtpAutofill';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { auth } from '../../services/api';
import { requestLoginCode } from './loginAvailability';

type Phase = 'phone' | 'code';

export function PhoneOtpLogin() {
  const { t } = useI18n();
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
    <View style={{ gap: space.s3 }}>
      <Text variant="title">{t('loginPhoneTitle')}</Text>
      <Text variant="body" tone="secondary" style={{ marginBottom: space.s2 }}>{t('loginPhoneSub')}</Text>

      <SaudiPhoneInput
        value={national}
        onChangeText={setNational}
        editable={phase === 'phone'}
        style={styles.field}
      />

      {phase === 'phone' ? (
        <Button label={t('sendLoginCode')} onPress={sendCode} loading={busy} disabled={!isSaudiMobile(national)} />
      ) : (
        <>
          <Text variant="heading" tone="ember" align="center" style={styles.sentTo}>
            {formatSaudiE164(e164)}
          </Text>
          <View style={styles.field}>
            <Text variant="label" tone="secondary" style={{ marginBottom: space.s2 }}>
              {t('enterLoginCode')}
            </Text>
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
            style={{ marginTop: space.s1 }}
          />
          <Button label={t('changeNumber')} onPress={changeNumber} disabled={busy} variant="ghost" />
        </>
      )}

      {notice ? <Text variant="caption" tone="success" style={styles.msg}>{notice}</Text> : null}
      {error ? <Text variant="caption" tone="danger" style={styles.msg}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: space.s3 },
  // The number the code went to — always LTR so it reads correctly in Arabic,
  // and mono because it is a structured number.
  sentTo: {
    fontFamily: fontFamily.num.semibold,
    writingDirection: 'ltr',
    marginBottom: space.s2,
  },
  msg: { marginTop: space.s1 },
});
