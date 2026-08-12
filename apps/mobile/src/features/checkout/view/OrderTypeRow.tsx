/**
 * Order type + branch, read-only.
 *
 * Both were chosen in the blocking selection flow and are never re-picked
 * inline — changing either can change the delivery fee, item availability and
 * the cart, so "Change" re-opens that flow behind a confirmation. This
 * component renders the decision and exposes the one affordance; the screen
 * owns what "Change" does.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { StatusPill } from '../../../design-system/ui/Chip';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { makeStyles } from '../../../theme/makeStyles';

export function OrderTypeRow({
  typeLabel,
  branchName,
  changeLabel,
  onChange,
}: {
  typeLabel: string;
  branchName: string | null;
  changeLabel: string;
  onChange: () => void;
}) {
  const styles = useStyles();
  const { rtlRow } = useI18n();
  return (
    <View style={[styles.row, rtlRow]}>
      <View style={styles.info}>
        {/* The order type is a state, not a control — a status pill, never
            ember, so it cannot be mistaken for the thing you press. */}
        {typeLabel ? <StatusPill label={typeLabel} tone="info" /> : null}
        {branchName ? (
          <Text variant="heading" numberOfLines={1}>{branchName}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={onChange}
        accessibilityRole="button"
        accessibilityLabel={changeLabel}
        hitSlop={8}
        style={({ pressed }) => [styles.change, pressed && styles.pressed]}
      >
        <Text variant="label" tone="ember">{changeLabel}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3,
    backgroundColor: colors.appSurface,
    borderWidth: 1,
    borderColor: colors.appLine,
    borderRadius: radius.lg,
    padding: space.s3,
  },
  info: { flex: 1, gap: space.s1, alignItems: 'flex-start' },
  change: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.s3,
    borderRadius: radius.pill,
    backgroundColor: colors.appSurface2,
  },
  pressed: { opacity: 0.7 },
}));
