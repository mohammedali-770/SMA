/**
 * The online-payment overlay — PRESENTATION ONLY.
 *
 * Every decision about what a payment state MEANS stays in CheckoutScreen: what
 * clears the persisted session, what may reuse a session id, what opens a fresh
 * one, and what the server's verify says. This component receives an already-
 * decided state plus already-decided handlers and draws them.
 *
 * That split is what makes the payment states reviewable at all. They are
 * driven by internal screen state, not by context, so before this extraction
 * there was no way to look at "declined", "expired" or "still pending" without
 * actually running a charge. The dev fixture now renders this component
 * directly, one scene per state.
 *
 * The action set per state is deliberately NOT uniform, and mirrors the rule in
 * CheckoutScreen exactly:
 *
 *   opening/verifying  in flight. Cancel only — dismissing keeps the session,
 *                      so a still-open charge is resolved by recovery.
 *   pending            the charge may still settle. Continue reopens the SAME
 *                      session (never a new charge); Check again re-verifies.
 *   error              transient; the session may still be alive → resume it.
 *   failed/cancelled/  terminal server-side → a FRESH session, never a reused
 *   expired            one.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { color, space } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { StatusPill } from '../../../design-system/ui/Chip';
import { Text } from '../../../design-system/ui/Text';
import { Dialog } from './Dialog';

/** Mirrors the PayState union in CheckoutScreen. */
export type PayState = 'opening' | 'verifying' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'error';

export interface PaymentStatusLabels {
  title: string;
  opening: string;
  verifying: string;
  cancel: string;
  close: string;
  continuePayment: string;
  verifyAgain: string;
  tryAgain: string;
  /** Short state word for the pill, e.g. "Pending" / "Declined". */
  statusPending: string;
  statusFailed: string;
  statusCancelled: string;
  statusExpired: string;
}

const IN_FLIGHT: PayState[] = ['opening', 'verifying'];

/** Terminal server-side: the session is dead and must never be reused. */
const TERMINAL: PayState[] = ['failed', 'cancelled', 'expired'];

export function PaymentStatusDialog({
  state,
  message,
  busy,
  labels,
  onContinue,
  onVerifyAgain,
  onResume,
  onRetryFresh,
  onClose,
}: {
  /** null closes the dialog. */
  state: PayState | null;
  message: string | null;
  busy: boolean;
  labels: PaymentStatusLabels;
  onContinue: () => void;
  onVerifyAgain: () => void;
  onResume: () => void;
  onRetryFresh: () => void;
  onClose: () => void;
}) {
  const inFlight = state != null && IN_FLIGHT.includes(state);

  return (
    <Dialog visible={state !== null} onRequestClose={onClose} title={labels.title}>
      {state == null ? null : inFlight ? (
        <View style={styles.progress}>
          <ActivityIndicator size="large" color={color.ember} />
          <Text variant="body" tone="secondary" align="center">
            {state === 'opening' ? labels.opening : labels.verifying}
          </Text>
          {/* Escape hatch if initiate/verify stalls. Dismissing KEEPS the
              session, so a still-open charge is resolved by recovery on the
              next entry — it never abandons money. */}
          <Button
            label={labels.cancel}
            onPress={onClose}
            variant="secondary"
            style={styles.stretch}
          />
        </View>
      ) : (
        <>
          <View style={styles.pillRow}>
            <StatusPill label={pillLabel(state, labels)} tone={pillTone(state)} />
          </View>
          <Text variant="body" align="center">{message ?? ''}</Text>
          <View style={styles.actions}>
            {state === 'pending' ? (
              <>
                <Button label={labels.continuePayment} onPress={onContinue} loading={busy} variant="primary" />
                <Button label={labels.verifyAgain} onPress={onVerifyAgain} loading={busy} variant="secondary" />
              </>
            ) : state === 'error' ? (
              <Button label={labels.tryAgain} onPress={onResume} loading={busy} variant="primary" />
            ) : (
              <Button label={labels.tryAgain} onPress={onRetryFresh} loading={busy} variant="primary" />
            )}
            {/* Ghost, not secondary: with three outlined buttons stacked, the
                dismissal read as loud as the retry. Close is the way out, not
                a third thing to consider. */}
            <Button label={labels.close} onPress={onClose} variant="ghost" />
          </View>
        </>
      )}
    </Dialog>
  );
}

function pillTone(state: PayState) {
  // 'pending' is a warning, not an error: the charge may still settle, and
  // colouring it red would tell the customer a payment failed when it has not.
  if (state === 'pending') return 'warning' as const;
  if (TERMINAL.includes(state)) return 'danger' as const;
  return 'neutral' as const;
}

function pillLabel(state: PayState, l: PaymentStatusLabels): string {
  switch (state) {
    case 'pending': return l.statusPending;
    case 'cancelled': return l.statusCancelled;
    case 'expired': return l.statusExpired;
    default: return l.statusFailed;
  }
}

const styles = StyleSheet.create({
  progress: { alignItems: 'center', gap: space.s4, paddingVertical: space.s5 },
  pillRow: { alignItems: 'center', marginBottom: space.s1 },
  actions: { gap: space.s2, marginTop: space.s3, alignSelf: 'stretch' },
  stretch: { alignSelf: 'stretch' },
});
