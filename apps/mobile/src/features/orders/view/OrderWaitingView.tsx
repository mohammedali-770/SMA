/**
 * The window a customer sees between paying and the branch issuing the order
 * number (receiptGate.ts): a live seconds counter inside a turning ring, and a
 * request to keep the app open. The receipt screen replaces it with the order
 * page the moment the number arrives.
 *
 * The counter counts UP. A countdown would promise a moment the POS does not
 * guarantee, and would sit at zero if the branch were slow.
 *
 * After WAITING_SLOW_AFTER_MS the copy changes: it no longer asks the customer
 * to wait, says the order is safe, and offers My Orders. The counter and the
 * ring are removed then, since they would only count a wait nobody is asked
 * to make.
 *
 * Motion: one native-driver rotation. With Reduce Motion on, the ring is
 * still; the counter (a number changing once a second) carries the progress.
 * The whole window is ONE accessible element with a polite live region, and
 * the counter is hidden from it, so a screen reader announces the message
 * once, and again when it changes, never every second.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { CheckCircleIcon } from '../../../components/Icons';
import { Logo } from '../../../components/Logo';
import { fontFamily, radius, space } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { makeStyles } from '../../../theme/makeStyles';
import { waitingPhase } from '../receiptGate';
import { TONE_COLOR } from './confirmationTone';

// The same green the confirmed order's pill uses (confirmationTone.ts).
const paidTone = TONE_COLOR.success;

const RING = 132;
const RING_STROKE = 6;

export function OrderWaitingView({ paid, onViewOrders }: { paid: boolean; onViewOrders: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();

  // Whole seconds since this window appeared; the phase follows from it.
  const startedAt = useRef(Date.now()).current;
  const [seconds, setSeconds] = useState(0);
  const phase = waitingPhase(seconds * 1000);
  useEffect(() => {
    if (phase === 'slow') return undefined;
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => {
        if (alive) setReduceMotion(on);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || phase === 'slow') return undefined;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, reduceMotion, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const title = phase === 'slow' ? t('ow_slow_title') : t('ow_title');
  const body = phase === 'slow' ? t('ow_slow_body') : t('ow_body');

  return (
    <View style={styles.root}>
      <View
        style={styles.center}
        accessible
        accessibilityRole="progressbar"
        aria-busy={phase === 'active'}
        accessibilityLiveRegion="polite"
        accessibilityLabel={[paid ? t('oc_payment_received') : null, title, body].filter(Boolean).join('. ')}
      >
        <Logo hero />

        {paid ? (
          <View
            style={[styles.paid, { backgroundColor: paidTone.bg, borderColor: paidTone.line }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <CheckCircleIcon size={18} color={paidTone.fg} />
            <Text variant="label" style={{ color: paidTone.fg }}>
              {t('oc_payment_received')}
            </Text>
          </View>
        ) : null}

        {phase === 'active' ? (
          <View
            style={styles.ringStage}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={styles.ringTrack} />
            <Animated.View style={[styles.ringArc, { transform: [{ rotate }] }]} />
            <View style={styles.ringCenter}>
              <Text style={styles.count}>{seconds}</Text>
              <Text variant="caption" tone="tertiary">
                {t('ow_seconds')}
              </Text>
            </View>
          </View>
        ) : null}

        <Text variant="title" align="center">
          {title}
        </Text>
        <Text variant="body" tone="secondary" align="center" style={styles.body}>
          {body}
        </Text>
      </View>

      {phase === 'slow' ? (
        <View style={styles.footer}>
          <Button label={t('viewMyOrders')} onPress={onViewOrders} variant="primary" />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: space.s5,
    gap: space.s3,
  },
  paid: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.s2,
    paddingVertical: space.s2,
    paddingHorizontal: space.s3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  ringStage: {
    width: RING,
    height: RING,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginVertical: space.s4,
  },
  ringTrack: {
    position: 'absolute' as const,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: RING_STROKE,
    borderColor: colors.appLine,
  },
  // A quarter arc: one coloured edge of a circle whose other edges are clear.
  ringArc: {
    position: 'absolute' as const,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: RING_STROKE,
    borderColor: 'transparent',
    borderTopColor: colors.ember,
  },
  ringCenter: { alignItems: 'center' as const },
  // Latin digits, left to right, in both languages: a number that changes
  // every second must not reorder.
  count: {
    fontSize: 44,
    lineHeight: 50,
    color: colors.ember,
    fontFamily: fontFamily.num.semibold,
    writingDirection: 'ltr' as const,
  },
  body: { maxWidth: 320 },
  footer: { padding: space.s4 },
}));
