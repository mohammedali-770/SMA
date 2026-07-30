/**
 * WhatsApp phone verification (Profile screen).
 *
 * Verifies phone OWNERSHIP for the signed-in customer — it does NOT log the user
 * in or change the session. The OTP is generated, rate-limited, and checked
 * entirely server-side; this UI only collects the phone + code and reflects the
 * result. When WhatsApp is not configured/enabled the server returns `disabled`
 * and we show a graceful not-available state.
 *
 * Saudi-only, exactly like login: the number is collected as a `+966` national
 * part and normalized once with `toSaudiE164` before either call, so send and
 * verify key off the same canonical string the server derives.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Text } from '../../design-system/ui/Text';
import { SaudiPhoneInput } from '../../components/SaudiPhoneInput';
import { useI18n } from '../../i18n/I18nProvider';
import { sanitizeSaudiNationalInput, toSaudiE164 } from '../../lib/phone';
import { DEFAULT_OTP_LENGTH } from '../otp/otpAutofill';
import { OtpCodeInput } from '../otp/OtpCodeInput';
import { OTP_RESEND_COOLDOWN_SECONDS } from '../otp/otpInput';
import { useOtpAutofill } from '../otp/useOtpAutofill';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { useAuth } from '../../store';
import { whatsappOtp } from '../../services/api';

type Phase = 'phone' | 'code' | 'verified';

export function VerifyPhoneWhatsApp() {
  const { t, lang, rtlRow } = useI18n();
  const { profile, refreshProfile } = useAuth();

  const [phase, setPhase] = useState<Phase>(profile?.phoneVerified ? 'verified' : 'phone');
  // Stored profile phones arrive in any shape (+966…, 05…); keep only the
  // national part so the field and the `+966` prefix never double up.
  const [national, setNational] = useState(() => sanitizeSaudiNationalInput(profile?.phoneNumber ?? ''));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const { cooldown, startCooldown } = useOtpCooldown();

  const e164 = toSaudiE164(national);

  const sendCode = async () => {
    setError(null); setNotice(null);
    if (!e164) { setError(t('invalidSaudiPhone')); return; }
    setBusy(true);
    try {
      const res = await whatsappOtp.send(e164, lang);
      if (res.status === 'disabled') { setNotAvailable(true); return; }
      setPhase('code');
      setNotice(t('weSentWhatsappCode'));
      startCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch {
      setNotice(t('weSentWhatsappCode')); // stay generic; never reveal validity
      setPhase('code');
      startCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } finally { setBusy(false); }
  };

  const verify = async (codeArg?: string) => {
    setError(null);
    const value = (codeArg ?? code).trim();
    if (!e164 || !/^\d{6}$/.test(value)) { setError(t('invalidOrExpiredCode')); return; }
    setBusy(true);
    try {
      const res = await whatsappOtp.verify(e164, value);
      if (res.verified) {
        setPhase('verified');
        setNotice(t('phoneVerifiedSuccess'));
        await refreshProfile();
      } else {
        setError(t('invalidOrExpiredCode'));
      }
    } catch {
      setError(t('invalidOrExpiredCode'));
    } finally { setBusy(false); }
  };

  // Zero-tap autofill (WebOTP on web; declarative on native). Only listens on the
  // code step; on read it fills the boxes and hands the code straight to verify.
  useOtpAutofill({
    enabled: phase === 'code',
    length: DEFAULT_OTP_LENGTH,
    onCode: (c) => { setCode(c); void verify(c); },
  });

  const verified = phase === 'verified' || profile?.phoneVerified;

  return (
    <Card style={styles.card}>
      <View style={[styles.headerRow, rtlRow]}>
        <Text variant="heading" style={{ flex: 1 }}>{t('verifyPhoneTitle')}</Text>
        {verified && (
          <View style={styles.badge}>
            <Text variant="caption" tone="success">✓ {t('phoneVerifiedBadge')}</Text>
          </View>
        )}
      </View>
      <Text variant="body" tone="secondary" style={{ marginBottom: space.s3 }}>{t('verifyPhoneSub')}</Text>

      {notAvailable ? (
        <Text variant="body" tone="secondary" style={styles.state}>{t('whatsappNotAvailable')}</Text>
      ) : phase === 'verified' ? (
        <Text variant="heading" tone="success" style={styles.state}>{t('phoneVerifiedSuccess')}</Text>
      ) : (
        <>
          {/* Digits stay LTR in both languages so numbers read correctly. */}
          <SaudiPhoneInput
            value={national}
            onChangeText={setNational}
            editable={phase === 'phone'}
            label={t('phone')}
            style={styles.phoneField}
          />

          {phase === 'phone' ? (
            <Button label={t('sendCodeWhatsapp')} onPress={sendCode} loading={busy} disabled={!e164} />
          ) : (
            <>
              <OtpCodeInput
                value={code}
                onChange={setCode}
                length={DEFAULT_OTP_LENGTH}
                onComplete={(c) => verify(c)}
                accessibilityLabel={t('enterVerificationCode')}
                style={styles.codeField}
              />
              <Button label={t('verifyBtn')} onPress={() => verify()} loading={busy} />
              <Button
                label={cooldown > 0 ? `${t('resendIn')} ${cooldown}s` : t('resendCode')}
                onPress={sendCode}
                disabled={busy || cooldown > 0}
                variant="ghost"
                style={{ marginTop: space.s1 }}
              />
            </>
          )}
        </>
      )}

      {notice ? <Text variant="caption" tone="success" style={styles.msg}>{notice}</Text> : null}
      {error ? <Text variant="caption" tone="danger" style={styles.msg}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space.s3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s2 },
  badge: {
    paddingHorizontal: space.s3,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: color.appSurface2,
  },
  phoneField: { marginBottom: space.s2 },
  codeField: { marginBottom: space.s2 },
  msg: { marginTop: space.s2 },
  state: { paddingVertical: space.s2 },
});
