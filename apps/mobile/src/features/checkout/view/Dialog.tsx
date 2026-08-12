/**
 * The one modal shape Checkout uses: a centred card over a dimmed ground.
 *
 * Three different confirmations and the payment overlay all render through it,
 * so a decision the customer has to make always looks the same regardless of
 * how serious it is — the copy and the buttons carry the weight, not the
 * container.
 */
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Text } from '../../../design-system/ui/Text';
import { makeStyles } from '../../../theme/makeStyles';

export function Dialog({
  visible,
  onRequestClose,
  title,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text variant="title" align="center">{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Title + message + a destructive confirm and a cancel. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const styles = useStyles();
  return (
    <Dialog visible={visible} onRequestClose={onCancel} title={title}>
      {message ? <Text variant="body" tone="secondary" align="center">{message}</Text> : null}
      <View style={styles.actions}>
        <Button label={confirmLabel} variant="primary" onPress={onConfirm} />
        <Button label={cancelLabel} variant="secondary" onPress={onCancel} />
      </View>
    </Dialog>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s5,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.appSurface,
    borderRadius: radius.lg,
    padding: space.s5,
    gap: space.s2,
  },
  actions: { gap: space.s2, marginTop: space.s3, alignSelf: 'stretch' },
}));
