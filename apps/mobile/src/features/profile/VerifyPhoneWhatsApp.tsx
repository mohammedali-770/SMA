/**
 * WhatsApp phone verification (Profile screen).
 *
 * Verifies phone OWNERSHIP for the signed-in customer — it does NOT log the user
 * in or change the session (auth stays email/password). The OTP is generated,
 * rate-limited, and checked entirely server-side; this UI only collects the phone
 * + code and reflects the result. When WhatsApp is not configured/enabled the
 * server returns `disabled` and we show a graceful not-available state.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/I18nProvider';
import { OTP_RESEND_COOLDOWN_SECONDS, sanitizeOtpDigits } from '../otp/otpInput';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { useAuth } from '../../store';
import { whatsappOtp } from '../../services/api';
import { colors, font, radius, shadow, spacing } from '../../theme';

type Phase = 'phone' | 'code' | 'verified';

export function VerifyPhoneWhatsApp() {
  const { t, lang } = useI18n();
  const { profile, refreshProfile } = useAuth();

  const [phase, setPhase] = useState<Phase>(profile?.phoneVerified ? 'verified' : 'phone');
  const [phone, setPhone] = useState(profile?.phoneNumber ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const { cooldown, startCooldown } = useOtpCooldown();

  const sendCode = async () => {
    setError(null); setNotice(null);
    if (phone.trim().length < 8) { setError(t('enterPhoneNumber')); return; }
    setBusy(true);
    try {
      const res = await whatsappOtp.send(phone.trim(), lang);
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

  const verify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) { setError(t('invalidOrExpiredCode')); return; }
    setBusy(true);
    try {
      const res = await whatsappOtp.verify(phone.trim(), code.trim());
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

  return (
    <View style={[styles.card, shadow.card]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('verifyPhoneTitle')}</Text>
        {(phase === 'verified' || profile?.phoneVerified) && (
          <Text style={styles.badge}>✓ {t('phoneVerifiedBadge')}</Text>
        )}
      </View>
      <Text style={styles.sub}>{t('verifyPhoneSub')}</Text>

      {notAvailable ? (
        <Text style={styles.notAvailable}>{t('whatsappNotAvailable')}</Text>
      ) : phase === 'verified' ? (
        <Text style={styles.success}>{t('phoneVerifiedSuccess')}</Text>
      ) : (
        <>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            editable={phase === 'phone'}
            keyboardType="phone-pad"
            placeholder="+9665XXXXXXXX"
            placeholderTextColor={colors.muted}
            style={[styles.input, phase !== 'phone' && styles.inputMuted]}
          />

          {phase === 'phone' ? (
            <Button label={t('sendCodeWhatsapp')} onPress={sendCode} loading={busy} />
          ) : (
            <>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(sanitizeOtpDigits(v, 6))}
                keyboardType="number-pad"
                placeholder={t('enterVerificationCode')}
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.codeInput]}
                maxLength={6}
              />
              <Button label={t('verifyBtn')} onPress={verify} loading={busy} />
              <Button
                label={cooldown > 0 ? `${t('resendIn')} ${cooldown}s` : t('resendCode')}
                onPress={sendCode}
                disabled={busy || cooldown > 0}
                variant="ghost"
                style={{ marginTop: spacing.xs }}
              />
            </>
          )}
        </>
      )}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  badge: { fontSize: font.sm, fontWeight: '800', color: colors.success },
  sub: { fontSize: font.sm, color: colors.muted, marginTop: 2, marginBottom: spacing.md },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: font.md,
    color: colors.text, backgroundColor: colors.white, marginBottom: spacing.sm,
  },
  inputMuted: { backgroundColor: colors.bg, color: colors.muted },
  codeInput: { letterSpacing: 6, textAlign: 'center', fontWeight: '800' },
  notice: { fontSize: font.sm, color: colors.success, fontWeight: '700', marginTop: spacing.sm },
  error: { fontSize: font.sm, color: colors.red, fontWeight: '700', marginTop: spacing.sm },
  success: { fontSize: font.md, color: colors.success, fontWeight: '800', paddingVertical: spacing.sm },
  notAvailable: { fontSize: font.sm, color: colors.muted, fontWeight: '700', paddingVertical: spacing.sm },
});
