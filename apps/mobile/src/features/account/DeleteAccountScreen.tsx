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
 *
 * The design pass changed presentation only. Every phase transition, the
 * hardware-back lock, the OTP/reauth fallback choice, the submit call and the
 * automatic post-acceptance sign-out are unchanged.
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  canSubmitDeletion, chooseReverifyMethod, deletionStatusMessageKey, isDeletionLockedPhase,
  isLikelyOffline, otpDeliverable, SUPPORT_EMAIL, SUPPORT_PHONE, type ReverifyMethod,
} from './accountDeletion';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { LoadingView } from '../../components/StateViews';
import { color, radius, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Field } from '../../design-system/ui/Field';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { OTP_RESEND_COOLDOWN_SECONDS, sanitizeOtpDigits } from '../otp/otpInput';
import { useOtpCooldown } from '../otp/useOtpCooldown';
import { deactivateThisDevice } from '../notifications/pushRegistration';
import { accountDeletion } from '../../services/api';
import { useAuth } from '../../store';

type Phase = 'checking' | 'pending' | 'intro' | 'reverify' | 'unavailable' | 'submitting' | 'success';

const CONSEQUENCE_KEYS = [
  'delBulletAccess', 'delBulletAddresses', 'delBulletProfile', 'delBulletLoyalty',
  'delBulletSessions', 'delBulletDevices', 'delBulletRetain', 'delBulletAnon',
  'delBulletAppDelete', 'delBulletAuto', 'delBulletTimeline',
] as const;

export function DeleteAccountScreen() {
  const { t, lang, rtlRow } = useI18n();
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
    <Screen background={color.appBg} edges={['top', 'left', 'right', 'bottom']}>
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
          style={styles.flex}
        >
          <LoadingView label={t('delSubmitting')} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {phase === 'pending' ? (
            <PendingCard statusKey={deletionStatusMessageKey(pendingStatus)} />
          ) : phase === 'success' ? (
            <SuccessCard />
          ) : phase === 'unavailable' ? (
            <UnavailableCard />
          ) : phase === 'intro' ? (
            <>
              <Text variant="body" tone="secondary">{t('delSubtitle')}</Text>

              <View style={styles.card}>
                {CONSEQUENCE_KEYS.map((k) => (
                  <View key={k} style={[styles.bullet, rtlRow]}>
                    <View style={styles.dot} />
                    <Text variant="body" style={styles.bulletText}>{t(k)}</Text>
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
                  {acknowledged ? <Text variant="label" tone="onEmber">✓</Text> : null}
                </View>
                <Text variant="label" style={styles.ackText}>{t('delAck')}</Text>
              </Pressable>

              <Button
                label={t('delContinue')}
                onPress={startReverify}
                disabled={!acknowledged}
                variant="danger"
                accessibilityLabel={t('delContinue')}
                style={styles.primaryAction}
              />
              <SupportBlock onOpen={openSupport} />
            </>
          ) : (
            /* phase === 'reverify' */
            <>
              <Text variant="title">{t('delReverifyTitle')}</Text>
              <Text variant="body" tone="secondary">
                {method === 'reauth' ? t('delReverifyReauthSub') : t('delReverifyOtpSub')}
              </Text>

              {method === 'reauth' ? (
                <Field
                  id="delete-password"
                  label={t('delPasswordLabel')}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('delPasswordLabel')}
                  secureTextEntry
                  autoCapitalize="none"
                />
              ) : (
                <>
                  {/* The code is a structured number → mono face, wide tracking,
                      centred, exactly like the login OTP. */}
                  <Field
                    id="delete-otp"
                    label={t('delEnterCode')}
                    value={code}
                    onChangeText={(v) => setCode(sanitizeOtpDigits(v, 6))}
                    keyboardType="number-pad"
                    placeholder={t('delEnterCode')}
                    maxLength={6}
                    numeric
                    inputStyle={styles.codeInput}
                  />
                  <Button
                    label={cooldown > 0 ? `${t('resendIn')} ${cooldown}s` : t('resendCode')}
                    onPress={() => void sendOtp()}
                    disabled={busy || cooldown > 0}
                    variant="ghost"
                  />
                  <Pressable
                    onPress={usePasswordInstead}
                    hitSlop={8}
                    accessibilityRole="button"
                    style={styles.switchLink}
                  >
                    <Text variant="label" tone="ember" align="center">{t('delUsePassword')}</Text>
                  </Pressable>
                </>
              )}

              <Button
                label={t('delVerifyContinue')}
                onPress={() => setConfirmVisible(true)}
                disabled={!canContinue || busy}
                loading={busy}
                variant="danger"
                style={styles.primaryAction}
              />
              <SupportBlock onOpen={openSupport} />
            </>
          )}

          {/* Announced status/error/notice region */}
          {error ? (
            <Text variant="label" tone="danger" align="center" accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : notice ? (
            <Text variant="label" tone="success" align="center" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
        </ScrollView>
      )}

      {/* Final confirmation (announced modal) */}
      {confirmVisible ? (
        <View style={styles.overlay} accessibilityViewIsModal>
          <View style={styles.modal}>
            <Text variant="title">{t('delFinalTitle')}</Text>
            <Text variant="body" tone="secondary">{t('delFinalBody')}</Text>
            <View style={styles.modalActions}>
              <Button
                label={t('delFinalConfirm')}
                onPress={() => void doSubmit()}
                variant="danger"
                accessibilityLabel={t('delFinalConfirm')}
              />
              <Button label={t('cancel')} onPress={() => setConfirmVisible(false)} variant="ghost" />
            </View>
          </View>
        </View>
      ) : null}
    </Screen>
  );

  function SuccessCard() {
    return (
      <View accessible accessibilityLiveRegion="polite" style={styles.phaseCard}>
        <View style={[styles.card, styles.successCard]}>
          <Text variant="title">{t('delSuccessTitle')}</Text>
          <Text variant="body">{t('delSuccessBody')}</Text>
          {/* Honest: no completion message is sent (no operational channel). */}
          <Text variant="caption" tone="secondary">{t('delNoNotice')}</Text>
        </View>
        <Button label={t('delDone')} onPress={() => void finish()} variant="primary" />
        <SupportBlock onOpen={openSupport} />
      </View>
    );
  }

  function PendingCard({ statusKey }: { statusKey: Parameters<typeof t>[0] }) {
    // Reached on login/session-restore for an account that is being deleted. The
    // account is locked server-side; the only forward action is to sign out.
    return (
      <View accessible accessibilityLiveRegion="polite" style={styles.phaseCard}>
        <View style={styles.card}>
          <Text variant="title">{t('delPendingTitle')}</Text>
          <Text variant="body">{t(statusKey)}</Text>
        </View>
        <Button label={t('signOut')} onPress={() => void finish()} variant="secondary" />
        <SupportBlock onOpen={openSupport} />
      </View>
    );
  }

  function UnavailableCard() {
    return (
      <View accessible accessibilityLiveRegion="polite" style={styles.phaseCard}>
        <View style={styles.card}>
          <Text variant="title">{t('delTitle')}</Text>
          <Text variant="body">{t('delUnavailable')}</Text>
        </View>
        <Button label={t('back')} onPress={() => router.back()} variant="secondary" />
        <SupportBlock onOpen={openSupport} />
      </View>
    );
  }
}

function SupportBlock({ onOpen }: { onOpen: (url: string) => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.support}>
      <Text variant="caption" tone="secondary" align="center">{t('delSupport')}</Text>
      <Pressable onPress={() => onOpen(`mailto:${SUPPORT_EMAIL}`)} accessibilityRole="link" hitSlop={6}>
        <Text variant="label" tone="ember" align="center">{SUPPORT_EMAIL}</Text>
      </Pressable>
      <Pressable onPress={() => onOpen(`tel:${SUPPORT_PHONE}`)} accessibilityRole="link" hitSlop={6}>
        {/* A phone number is a structured number — mono, and always LTR. */}
        <Text variant="label" tone="ember" align="center">{SUPPORT_PHONE}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space.s4, paddingBottom: space.s6, gap: space.s3 },
  card: {
    backgroundColor: color.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: color.appLine, padding: space.s4, gap: space.s2,
  },
  phaseCard: { gap: space.s3 },
  successCard: { borderColor: color.mintLine, backgroundColor: color.mintTint },

  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s2, paddingVertical: space.s1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.ember, marginTop: 8 },
  bulletText: { flex: 1 },

  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, marginTop: space.s2 },
  checkbox: {
    width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, borderColor: color.appLine,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  // Danger, not ember: ticking this box is the destructive commitment.
  checkboxOn: { backgroundColor: color.danger, borderColor: color.danger },
  ackText: { flex: 1 },

  codeInput: { letterSpacing: 6, textAlign: 'center' },
  switchLink: { paddingVertical: space.s2, alignItems: 'center' },
  primaryAction: { marginTop: space.s2 },

  support: { marginTop: space.s5, gap: space.s1, alignItems: 'center' },

  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: color.scrim,
    alignItems: 'center', justifyContent: 'center', padding: space.s5,
  },
  modal: {
    width: '100%', maxWidth: 400,
    backgroundColor: color.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    padding: space.s5, gap: space.s2,
  },
  modalActions: { gap: space.s2, marginTop: space.s3 },
});
