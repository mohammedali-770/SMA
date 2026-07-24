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
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { SaudiPhoneInput } from '../../components/SaudiPhoneInput';
import { useI18n } from '../../i18n/I18nProvider';
import { sanitizeSaudiNationalInput, toSaudiE164 } from '../../lib/phone';
import { OTP_RESEND_COOLDOWN_SECONDS, sanitizeOtpDigits } from '../otp/otpInput';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { useAuth } from '../../store';
import { whatsappOtp } from '../../services/api';
import { colors, font, radius, shadow, spacing } from '../../theme';

type Phase = 'phone' | 'code' | 'verified';

export function VerifyPhoneWhatsApp() {
  const { t, lang, rtlText, rtlRow } = useI18n();
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

  const verify = async () => {
    setError(null);
    if (!e164 || !/^\d{6}$/.test(code.trim())) { setError(t('invalidOrExpiredCode')); return; }
    setBusy(true);
    try {
      const res = await whatsappOtp.verify(e164, code.trim());
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

  const verified = phase === 'verified' || profile?.phoneVerified;

  return (
    <View style={[styles.card, shadow.card]}>
      <View style={[styles.headerRow, rtlRow]}>
        <Text style={[styles.title, rtlText, { flex: 1 }]}>{t('verifyPhoneTitle')}</Text>
        {verified && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>✓ {t('phoneVerifiedBadge')}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.sub, rtlText]}>{t('verifyPhoneSub')}</Text>

      {notAvailable ? (
        <Text style={[styles.notAvailable, rtlText]}>{t('whatsappNotAvailable')}</Text>
      ) : phase === 'verified' ? (
        <Text style={[styles.success, rtlText]}>{t('phoneVerifiedSuccess')}</Text>
      ) : (
        <>
          {/* Digits stay LTR in both languages so numbers read correctly. */}
          <SaudiPhoneInput
            value={national}
            onChangeText={setNational}
            editable={phase === 'phone'}
            showHint={phase === 'phone'}
            label={t('phone')}
            style={styles.phoneField}
          />

          {phase === 'phone' ? (
            <Button label={t('sendCodeWhatsapp')} onPress={sendCode} loading={busy} disabled={!e164} />
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
                accessibilityLabel={t('enterVerificationCode')}
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

      {notice ? <Text style={[styles.notice, rtlText]}>{notice}</Text> : null}
      {error ? <Text style={[styles.error, rtlText]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.successBg },
  badgeText: { fontSize: font.xs, fontWeight: '800', color: colors.success },
  sub: { fontSize: font.sm, color: colors.muted, marginTop: 2, marginBottom: spacing.md },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: font.md,
    color: colors.text, backgroundColor: colors.white, marginBottom: spacing.sm,
  },
  phoneField: { marginBottom: spacing.sm },
  codeInput: { letterSpacing: 6, textAlign: 'center', fontWeight: '800' },
  notice: { fontSize: font.sm, color: colors.success, fontWeight: '700', marginTop: spacing.sm },
  error: { fontSize: font.sm, color: colors.red, fontWeight: '700', marginTop: spacing.sm },
  success: { fontSize: font.md, color: colors.success, fontWeight: '800', paddingVertical: spacing.sm },
  notAvailable: { fontSize: font.sm, color: colors.muted, fontWeight: '700', paddingVertical: spacing.sm },
});
