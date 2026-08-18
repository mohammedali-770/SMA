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
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { fontFamily, hitTarget, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Text } from '../../design-system/ui/Text';
import { SaudiPhoneInput } from '../../components/SaudiPhoneInput';
import { useI18n } from '../../i18n/I18nProvider';
import { formatSaudiE164, isSaudiMobile, toSaudiE164 } from '../../lib/phone';
import { DEFAULT_OTP_LENGTH } from '../otp/otpAutofill';
import { OtpCodeInput } from '../otp/OtpCodeInput';
import { OtpPasteAssist } from '../otp/OtpPasteAssist';
import { OTP_RESEND_COOLDOWN_SECONDS } from '../otp/otpInput';
import { OtpResendTimer, type OtpResendHandle } from '../otp/OtpResendTimer';
import { useOtpAutofill } from '../otp/useOtpAutofill';
import { auth } from '../../services/api';
import { requestLoginCode } from './loginAvailability';
import { failureMessage } from '../../lib/errors/reportFailure';
import { makeStyles } from '../../theme/makeStyles';

type Phase = 'phone' | 'code';

export function PhoneOtpLogin() {
  const styles = useStyles();
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('phone');
  const [national, setNational] = useState('');  // 9-digit national part (5XXXXXXXX)
  const [e164, setE164] = useState('');          // the canonical number sent to Supabase
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The countdown deliberately does NOT live in this component's state: it
  // ticks once per second, and re-rendering the focused OTP field ~60 times per
  // cooldown is one of the two causes of the iOS 26 autofill failure. It owns
  // its own state inside OtpResendTimer and is driven from here by ref.
  const resend = useRef<OtpResendHandle>(null);

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
      resend.current?.start(OTP_RESEND_COOLDOWN_SECONDS);
    } else {
      // NEVER render the provider's own text: a corporate Wi-Fi that intercepts
      // TLS used to put "fetch failed: UnexpectedException: A TLS error caused
      // the secure connection to fail. (at ExpoModulesCore/Promise.swift:56)"
      // on this screen. The customer gets actionable copy; the technical detail
      // goes to Sentry with subsystem + op attached.
      setError(failureMessage(outcome.message, t, {
        subsystem: 'auth',
        op: 'send_login_code',
        fallbackKey: 'loginCodeSendFailed',
      }));
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
    } catch (err) {
      // A wrong code and an unreachable server are different problems: telling
      // someone on a blocked network that their code is invalid sends them to
      // request another one that also cannot arrive.
      setError(failureMessage(err, t, {
        subsystem: 'auth',
        op: 'verify_login_code',
        fallbackKey: 'invalidOrExpiredCode',
      }));
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    setPhase('phone'); setCode(''); setError(null); setNotice(null);
    resend.current?.reset();
  };

  // Stable identities for the memoized OtpCodeInput: `busy`, `error` and the
  // notice all change while the code field is focused, and the field must not
  // be re-rendered by any of them.
  const verifyRef = useRef(verify);
  verifyRef.current = verify;
  const handleCodeComplete = useCallback((c: string) => { void verifyRef.current(c); }, []);

  // A pasted code is treated exactly like an autofilled one: fill the field and
  // submit, so the customer never taps Verify separately after pasting.
  const handlePastedCode = useCallback((c: string) => {
    setCode(c);
    void verifyRef.current(c);
  }, []);

  // Zero-tap autofill (WebOTP on web; declarative on native). Only listens on the
  // code step; on read it fills the boxes and hands the code straight to verify.
  useOtpAutofill({
    enabled: phase === 'code',
    length: DEFAULT_OTP_LENGTH,
    onCode: (c) => { setCode(c); void verify(c); },
  });

  // ---- phase 1: the number ------------------------------------------------
  // No heading and no explanatory paragraph. The field is labelled, the +966
  // prefix is visible, and the one line that genuinely carries new information
  // — that the code arrives on WhatsApp — sits under the button, where it is
  // read at the moment it applies.
  if (phase === 'phone') {
    return (
      <View style={styles.stack}>
        <SaudiPhoneInput value={national} onChangeText={setNational} />
        <Button
          label={t('loginContinue')}
          onPress={sendCode}
          loading={busy}
          disabled={!isSaudiMobile(national)}
        />
        <Text variant="caption" tone="secondary" align="center">{t('loginCodeOnWhatsapp')}</Text>
        {error ? <Text variant="caption" tone="danger" align="center">{error}</Text> : null}
      </View>
    );
  }

  // ---- phase 2: the code --------------------------------------------------
  // The number moves up as a compact line with an inline "Change", which
  // replaces both the disabled phone field and a third full-width button. That
  // leaves the six boxes as the only thing competing for attention.
  return (
    <View style={styles.stack}>
      <Text variant="display" align="center">{t('enterCodeTitle')}</Text>

      <View style={styles.sentToRow}>
        <Text variant="body" style={styles.sentTo}>{formatSaudiE164(e164)}</Text>
        <Pressable
          onPress={changeNumber}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('changeNumber')}
          hitSlop={space.s2}
          style={styles.inlineAction}
        >
          <Text variant="label" tone="ember">{t('changeShort')}</Text>
        </Pressable>
      </View>

      <OtpCodeInput
        value={code}
        onChange={setCode}
        length={DEFAULT_OTP_LENGTH}
        onComplete={handleCodeComplete}
        autoFocus
        accessibilityLabel={t('enterCodeTitle')}
        style={styles.otp}
      />

      {/*
        iOS 26.x does not reliably offer the keyboard autofill suggestion for a
        WhatsApp-delivered code (Apple bug, no public API to opt into), but
        WhatsApp's own "Copy code" button always works. This turns that into a
        single tap. Shown only while the code is incomplete.
      */}
      <OtpPasteAssist
        length={DEFAULT_OTP_LENGTH}
        visible={code.length < DEFAULT_OTP_LENGTH}
        onCode={handlePastedCode}
      />

      <Button label={t('verifyShort')} onPress={() => verify()} loading={busy} />

      <OtpResendTimer ref={resend}>
        {(cooldown) => (
          <Pressable
            onPress={sendCode}
            disabled={busy || cooldown > 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || cooldown > 0 }}
            style={styles.resend}
          >
            <Text variant="caption" tone={cooldown > 0 ? 'tertiary' : 'ember'} align="center">
              {cooldown > 0 ? `${t('resendIn')} ${cooldown}s` : t('resendCode')}
            </Text>
          </Pressable>
        )}
      </OtpResendTimer>

      {error ? (
        <Text variant="caption" tone="danger" align="center">{error}</Text>
      ) : (
        <Text variant="caption" tone="secondary" align="center">
          {notice ?? t('loginCodeOnWhatsapp')}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  stack: { gap: space.s3 },
  sentToRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    // Fixed LTR: the number and its "Change" action read left-to-right in both
    // languages, so the pair never reverses around the number.
    direction: 'ltr',
  },
  // The number the code went to — always LTR so it reads correctly in Arabic,
  // and mono because it is a structured number.
  sentTo: { fontFamily: fontFamily.num.semibold, writingDirection: 'ltr' },
  // Both inline actions still clear the 44px touch minimum.
  inlineAction: { minHeight: hitTarget, justifyContent: 'center' },
  resend: { minHeight: hitTarget, justifyContent: 'center' },
  otp: { marginVertical: space.s2 },
}));
