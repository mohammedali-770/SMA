/**
 * THE receipt hero — PRESENTATION ONLY.
 *
 * Icon, title and message all come from ONE derived state
 * (`orderConfirmationState`), so the screen cannot contradict itself. An
 * earlier version rendered a green "Order placed!" above a banner that could
 * simultaneously read "Not confirmed"; that is structurally impossible here
 * because both come from the same state.
 *
 * Only `success` states get a check mark. Everything else is honest about
 * waiting — a clock, or an alert for `danger`.
 *
 * The Retry action appears only when the state's presentation says `canResend`,
 * which the state machine grants ONLY for orders proven never to have reached
 * the branch. Never for ambiguous ones: a resend there could duplicate the
 * restaurant's ticket. This component does not decide that — it renders what it
 * is told and calls `onResend`.
 *
 * Refund progress is stated separately and never optimistically: "Refunded"
 * appears only once the provider has confirmed it.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AlertIcon, CheckCircleIcon, ClockIcon } from '../../../components/Icons';
import { radius, space } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { confirmationPresentation, orderConfirmationState } from '../orderConfirmation';
import { TONE_COLOR } from './confirmationTone';
import type { Order } from '../../../types/models';
import { makeStyles } from '../../../theme/makeStyles';

export function ConfirmationHero({
  order, onResend, resending, resendError,
}: {
  order: Order;
  onResend: () => void;
  resending: boolean;
  resendError: string | null;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const state = orderConfirmationState(order);
  const p = confirmationPresentation(state);
  const tone = TONE_COLOR[p.tone];

  return (
    <View
      style={styles.wrap}
      accessible
      // Polite, so a status change picked up by the silent refresh is announced
      // without interrupting whatever the user is reading.
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t(p.titleKey)}. ${t(p.bodyKey)}`}
    >
      <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.line }]}>
        {p.success ? <CheckCircleIcon size={40} color={tone.fg} />
          : p.tone === 'danger' ? <AlertIcon size={40} color={tone.fg} />
          : <ClockIcon size={40} color={tone.fg} />}
      </View>

      <Text variant="display" align="center" style={{ color: tone.fg }}>{t(p.titleKey)}</Text>
      <Text variant="body" tone="secondary" align="center">{t(p.bodyKey)}</Text>

      {p.canResend ? (
        <View style={styles.action}>
          <Button
            label={resending ? t('oc_resending') : t('oc_resend')}
            onPress={onResend}
            // The button's own loading state disables the press and shows the
            // spinner. The server is idempotent regardless, but a dimmed
            // control is the honest signal that work is already in flight.
            loading={resending}
            variant="primary"
          />
          {resendError ? (
            <Text variant="label" tone="danger" align="center" accessibilityLiveRegion="polite">
              {resendError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {order.refundState && order.refundState !== 'none' ? (
        <View style={[styles.refund, { backgroundColor: tone.bg, borderColor: tone.line }]}>
          <Text variant="label" tone="secondary">{t('oc_refund_status')}</Text>
          <Text variant="heading" style={{ color: tone.fg }}>
            {order.refundState === 'refunded' ? t('oc_refunded')
              : order.refundState === 'failed' ? t('oc_refund_failed')
              : t('oc_refund_pending')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { alignItems: 'center', paddingVertical: space.s5, gap: space.s2 },
  // A tinted disc rather than a bare glyph: on the cream ground a lone outline
  // icon reads as an afterthought, and this is the loudest thing on the screen.
  badge: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: space.s2,
  },
  action: { alignSelf: 'stretch', marginTop: space.s3, gap: space.s2 },
  refund: {
    alignSelf: 'stretch', marginTop: space.s3, padding: space.s3,
    borderWidth: 1, borderRadius: radius.md, borderCurve: 'continuous', gap: 2,
  },
}));
