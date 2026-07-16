/**
 * Delete Account — the customer self-service deletion flow.
 *
 * Phases: intro (consequences + acknowledgment) → reverify (OTP to the
 * registered phone, or password fallback) → final confirmation → submitting →
 * success acknowledgment → sign-out. A pre-existing pending request is shown as a
 * friendly status instead of restarting the flow.
 *
 * Safety: the app never performs the deletion — it only re-verifies identity and
 * enqueues the request server-side. Sign-out happens ONLY after the request is
 * accepted. No raw backend error is ever shown; statuses map to safe localized
 * strings.
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  canSubmitDeletion, chooseReverifyMethod, deletionStatusMessageKey, isDeletionLockedPhase,
  isLikelyOffline, otpDeliverable, SUPPORT_EMAIL, SUPPORT_PHONE, type ReverifyMethod,
} from './accountDeletion';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { OTP_RESEND_COOLDOWN_SECONDS, sanitizeOtpDigits } from '../otp/otpInput';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { deactivateThisDevice } from '../notifications/pushRegistration';
import { accountDeletion } from '../../services/api';
import { useAuth } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';

type Phase = 'checking' | 'pending' | 'intro' | 'reverify' | 'unavailable' | 'submitting' | 'success';

const CONSEQUENCE_KEYS = [
  'delBulletAccess', 'delBulletAddresses', 'delBulletProfile', 'delBulletLoyalty',
  'delBulletSessions', 'delBulletDevices', 'delBulletRetain', 'delBulletAnon',
  'delBulletAppDelete', 'delBulletAuto', 'delBulletTimeline',
] as const;

export function DeleteAccountScreen() {
  const { t, lang, isRTL, rtlText, rtlRow } = useI18n();
  const { signOut } = useAuth();

  const [phase, setPhase] = useState<Phase>('checking');
  const [pendingStatus, setPendingStatus] = useState<string>('queued');
  const [acknowledged, setAcknowledged] = useState(false);
  const [method, setMethod] = useState<ReverifyMethod | null>(null);
  const [otpAvailable, setOtpAvailable] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const { cooldown, startCooldown, resetCooldown } = useOtpCooldown();
  const finishedRef = useRef(false);

  // Once the request is accepted (or an active one is found), the app is LOCKED
  // to the deletion state: swallow hardware back so it cannot escape into the
  // authenticated app. Header back is hidden and gestures off (below).
  useEffect(() => {
    const locked = isDeletionLockedPhase(phase);
    const sub = BackHandler.addEventListener('hardwareBackPress', () => locked);
    return () => sub.remove();
  }, [phase]);

  // On open: if a deletion request is already in flight, show its friendly state.
  useEffect(() => {
    let alive = true;
    accountDeletion.current()
      .then((row) => {
        if (!alive) return;
        if (row) { setPendingStatus(row.status); setPhase('pending'); }
        else setPhase('intro');
      })
      .catch(() => { if (alive) setPhase('intro'); }); // server still enforces idempotency
    return () => { alive = false; };
  }, []);

  const sendOtp = useCallback(async () => {
    setError(null); setNotice(null); setBusy(true);
    try {
      const res = await accountDeletion.sendOtp(lang);
      // Never present OTP unless the channel actually delivered it; fall back to
      // the password reauth; if neither is possible, show the support state.
      const choice = chooseReverifyMethod({ otp: otpDeliverable(res.status), reauth: res.reauthAvailable !== false });
      if (choice === 'otp') {
        setOtpAvailable(true); setMethod('otp');
        if (res.status === 'sent') setNotice(t('weSentWhatsappCode'));
        startCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      } else if (choice === 'reauth') {
        setOtpAvailable(false); setMethod('reauth'); setNotice(t('delOtpUnavailable'));
      } else {
        setPhase('unavailable');
      }
    } catch (e) {
      // Offline / transient → still allow the password fallback.
      setOtpAvailable(false); setMethod('reauth');
      setError(isLikelyOffline(e) ? t('delOffline') : t('delOtpUnavailable'));
    } finally { setBusy(false); }
  }, [lang, t, startCooldown]);

  const startReverify = useCallback(() => {
    if (!acknowledged) return;
    setError(null); setNotice(null); setCode(''); setPassword('');
    setPhase('reverify');
    void sendOtp();
  }, [acknowledged, sendOtp]);

  const usePasswordInstead = () => {
    resetCooldown(); setOtpAvailable(false); setMethod('reauth'); setError(null); setNotice(null); setCode('');
  };

  const doSubmit = useCallback(async () => {
    if (!method) return;
    setConfirmVisible(false); setError(null); setBusy(true); setPhase('submitting');
    try {
      const res = await accountDeletion.submit(method, { code: code.trim(), password });
      if (res.code === 'verification_failed') {
        setError(method === 'otp' ? t('invalidOrExpiredCode') : t('delWrongPassword'));
        setPassword('');
        setPhase('reverify');
        return;
      }
      // verified, or an existing active request — either way it's accepted.
      setPhase('success');
    } catch (e) {
      setError(isLikelyOffline(e) ? t('delOffline') : t('delError'));
      setPhase('reverify');
    } finally { setBusy(false); }
  }, [method, code, password, t]);

  const finish = useCallback(async () => {
    if (finishedRef.current) return; // once only — the auto-timer and Done may both fire
    finishedRef.current = true;
    // Sign-out ONLY after the request is accepted. Silence this device first so a
    // shared phone never keeps this account's push registration.
    try { await deactivateThisDevice(); } catch { /* best-effort */ }
    await signOut();
    router.replace('/(auth)/login');
  }, [signOut]);

  // After acceptance, sign out AUTOMATICALLY after a brief readable moment —
  // safety must not depend on the customer pressing Done. The DB-level lock is
  // the authoritative protection; this closes the local access window.
  useEffect(() => {
    if (phase !== 'success') return;
    const id = setTimeout(() => { void finish(); }, 4000);
    return () => clearTimeout(id);
  }, [phase, finish]);

  const openSupport = (url: string) => { Linking.openURL(url).catch(() => { /* ignore */ }); };

  const canContinue = canSubmitDeletion({ acknowledged, method, code, password });

  return (
    <Screen background={colors.bg} edges={['top', 'left', 'right', 'bottom']}>
      <Header title={t('delTitle')} showBack={!isDeletionLockedPhase(phase)} />

      {phase === 'checking' ? (
        <LoadingView label={t('loading')} />
      ) : phase === 'submitting' ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('delSubmitting')}
          accessibilityState={{ busy: true }}
          accessibilityLiveRegion="polite"
          style={{ flex: 1 }}
        >
          <LoadingView label={t('delSubmitting')} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
          {phase === 'pending' ? (
            <PendingCard statusKey={deletionStatusMessageKey(pendingStatus)} />
          ) : phase === 'success' ? (
            <SuccessCard />
          ) : phase === 'unavailable' ? (
            <UnavailableCard />
          ) : phase === 'intro' ? (
            <>
              <Text style={[styles.subtitle, rtlText]}>{t('delSubtitle')}</Text>
              <View style={[styles.card, shadow.card]}>
                {CONSEQUENCE_KEYS.map((k) => (
                  <View key={k} style={[styles.bulletRow, rtlRow]}>
                    <View style={styles.bulletDot} />
                    <Text style={[styles.bulletText, rtlText]}>{t(k)}</Text>
                  </View>
                ))}
              </View>

              {/* Accessible acknowledgment checkbox */}
              <Pressable
                onPress={() => setAcknowledged((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acknowledged }}
                accessibilityLabel={t('delAck')}
                hitSlop={8}
                style={[styles.ackRow, rtlRow]}
              >
                <View style={[styles.checkbox, acknowledged && styles.checkboxOn]}>
                  {acknowledged ? <Text style={styles.checkboxMark}>✓</Text> : null}
                </View>
                <Text style={[styles.ackText, rtlText]}>{t('delAck')}</Text>
              </Pressable>

              <Button
                label={t('delContinue')}
                onPress={startReverify}
                disabled={!acknowledged}
                variant="danger"
                accessibilityLabel={t('delContinue')}
                style={{ marginTop: spacing.lg }}
              />
              <SupportBlock onOpen={openSupport} />
            </>
          ) : (
            /* phase === 'reverify' */
            <>
              <Text style={[styles.h2, rtlText]}>{t('delReverifyTitle')}</Text>
              <Text style={[styles.subtitle, rtlText]}>
                {method === 'reauth' ? t('delReverifyReauthSub') : t('delReverifyOtpSub')}
              </Text>

              {method === 'reauth' ? (
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('delPasswordLabel')}
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  autoCapitalize="none"
                  style={[styles.input, rtlText]}
                  accessibilityLabel={t('delPasswordLabel')}
                />
              ) : (
                <>
                  <TextInput
                    value={code}
                    onChangeText={(v) => setCode(sanitizeOtpDigits(v, 6))}
                    keyboardType="number-pad"
                    placeholder={t('delEnterCode')}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.codeInput]}
                    maxLength={6}
                    accessibilityLabel={t('delEnterCode')}
                  />
                  <Button
                    label={cooldown > 0 ? `${t('resendIn')} ${cooldown}s` : t('resendCode')}
                    onPress={() => void sendOtp()}
                    disabled={busy || cooldown > 0}
                    variant="ghost"
                    style={{ marginTop: spacing.xs }}
                  />
                  <Pressable onPress={usePasswordInstead} hitSlop={8} accessibilityRole="button" style={styles.switchLink}>
                    <Text style={styles.switchText}>{t('delUsePassword')}</Text>
                  </Pressable>
                </>
              )}

              <Button
                label={t('delVerifyContinue')}
                onPress={() => setConfirmVisible(true)}
                disabled={!canContinue || busy}
                loading={busy}
                variant="danger"
                style={{ marginTop: spacing.lg }}
              />
              <SupportBlock onOpen={openSupport} />
            </>
          )}

          {/* Announced status/error/notice region */}
          {error ? (
            <Text style={[styles.error, rtlText]} accessibilityLiveRegion="assertive">{error}</Text>
          ) : notice ? (
            <Text style={[styles.notice, rtlText]} accessibilityLiveRegion="polite">{notice}</Text>
          ) : null}
        </ScrollView>
      )}

      {/* Final confirmation (announced modal) */}
      {confirmVisible ? (
        <View style={styles.modalOverlay} accessibilityViewIsModal>
          <View style={[styles.modalCard, shadow.card]}>
            <Text style={[styles.modalTitle, rtlText]}>{t('delFinalTitle')}</Text>
            <Text style={[styles.modalBody, rtlText]}>{t('delFinalBody')}</Text>
            <Button label={t('delFinalConfirm')} onPress={() => void doSubmit()} variant="danger" accessibilityLabel={t('delFinalConfirm')} />
            <Button label={t('cancel')} onPress={() => setConfirmVisible(false)} variant="ghost" style={{ marginTop: spacing.xs }} />
          </View>
        </View>
      ) : null}
    </Screen>
  );

  function SuccessCard() {
    return (
      <View accessible accessibilityLiveRegion="polite">
        <View style={[styles.card, shadow.card, styles.successCard]}>
          <Text style={[styles.h2, rtlText]}>{t('delSuccessTitle')}</Text>
          <Text style={[styles.bodyText, rtlText]}>{t('delSuccessBody')}</Text>
          {/* Honest: no completion message is sent (no operational channel). */}
          <Text style={[styles.muted, rtlText]}>{t('delNoNotice')}</Text>
        </View>
        <Button label={t('delDone')} onPress={() => void finish()} variant="primary" style={{ marginTop: spacing.lg }} />
        <SupportBlock onOpen={openSupport} />
      </View>
    );
  }

  function PendingCard({ statusKey }: { statusKey: Parameters<typeof t>[0] }) {
    // Reached on login/session-restore for an account that is being deleted. The
    // account is locked server-side; the only forward action is to sign out.
    return (
      <View accessible accessibilityLiveRegion="polite">
        <View style={[styles.card, shadow.card]}>
          <Text style={[styles.h2, rtlText]}>{t('delPendingTitle')}</Text>
          <Text style={[styles.bodyText, rtlText]}>{t(statusKey)}</Text>
        </View>
        <Button label={t('signOut')} onPress={() => void finish()} variant="secondary" style={{ marginTop: spacing.lg }} />
        <SupportBlock onOpen={openSupport} />
      </View>
    );
  }

  function UnavailableCard() {
    return (
      <View accessible accessibilityLiveRegion="polite">
        <View style={[styles.card, shadow.card]}>
          <Text style={[styles.h2, rtlText]}>{t('delTitle')}</Text>
          <Text style={[styles.bodyText, rtlText]}>{t('delUnavailable')}</Text>
        </View>
        <Button label={t('back')} onPress={() => router.back()} variant="secondary" style={{ marginTop: spacing.lg }} />
        <SupportBlock onOpen={openSupport} />
      </View>
    );
  }
}

function SupportBlock({ onOpen }: { onOpen: (url: string) => void }) {
  const { t, rtlText } = useI18n();
  return (
    <View style={styles.support}>
      <Text style={[styles.supportLabel, rtlText]}>{t('delSupport')}</Text>
      <Pressable onPress={() => onOpen(`mailto:${SUPPORT_EMAIL}`)} accessibilityRole="link" hitSlop={6}>
        <Text style={styles.supportLink}>{SUPPORT_EMAIL}</Text>
      </Pressable>
      <Pressable onPress={() => onOpen(`tel:${SUPPORT_PHONE}`)} accessibilityRole="link" hitSlop={6}>
        <Text style={styles.supportLink}>{SUPPORT_PHONE}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: font.md, color: colors.muted, marginBottom: spacing.md },
  muted: { fontSize: font.sm, color: colors.muted, marginTop: spacing.sm, lineHeight: font.sm + 6 },
  h2: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  bodyText: { fontSize: font.md, color: colors.text, lineHeight: font.md + 8 },
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  successCard: { borderColor: colors.success, backgroundColor: colors.successBg },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.purple, marginTop: 8 },
  bulletText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: font.md + 7 },

  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg },
  checkbox: {
    width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.red, borderColor: colors.red },
  checkboxMark: { color: colors.white, fontWeight: '900', fontSize: font.md },
  ackText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: font.sm + 7 },

  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: font.md,
    color: colors.text, backgroundColor: colors.white, marginTop: spacing.sm,
  },
  codeInput: { letterSpacing: 6, textAlign: 'center', fontWeight: '800' },
  switchLink: { paddingVertical: spacing.sm, alignItems: 'center' },
  switchText: { color: colors.purple, fontWeight: '800', fontSize: font.sm },

  notice: { fontSize: font.sm, color: colors.success, fontWeight: '700', marginTop: spacing.md, textAlign: 'center' },
  error: { fontSize: font.sm, color: colors.red, fontWeight: '700', marginTop: spacing.md, textAlign: 'center' },

  support: { marginTop: spacing.xl, gap: spacing.xs, alignItems: 'center' },
  supportLabel: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  supportLink: { fontSize: font.md, color: colors.purple, fontWeight: '800' },

  modalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.xl,
  },
  modalCard: {
    width: '100%', backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    padding: spacing.xl, gap: spacing.sm,
  },
  modalTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  modalBody: { fontSize: font.md, color: colors.muted, lineHeight: font.md + 7, marginBottom: spacing.md },
});
