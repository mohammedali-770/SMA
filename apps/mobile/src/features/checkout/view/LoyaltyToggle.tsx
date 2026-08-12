/**
 * Redeem loyalty points.
 *
 * The switch is drawn rather than using the platform Switch because the
 * platform control cannot be tinted consistently across iOS, Android and the
 * web export, and this is the only toggle in the customer app — one bespoke
 * control is cheaper than three platform variants of the brand colour.
 *
 * The whole row is the target, so the label is as tappable as the switch.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { makeStyles } from '../../../theme/makeStyles';

export function LoyaltyToggle({
  on,
  onToggle,
  label,
  pointsLabel,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  pointsLabel: string;
}) {
  const styles = useStyles();
  const { rtlRow } = useI18n();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, rtlRow, pressed && styles.pressed]}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
      <View style={styles.body}>
        <Text variant="label">{label}</Text>
        {/* Points are a structured number, so they read in the mono face
            alongside every other figure in the app. */}
        <Text variant="caption" tone="secondary">{pointsLabel}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    backgroundColor: colors.appSurface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.appLine, padding: space.s3,
    minHeight: 60,
  },
  pressed: { opacity: 0.85 },
  body: { flex: 1, gap: 2 },
  // Fixed direction: the knob travels to the "on" end, which is the same
  // physical gesture in both languages.
  track: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: colors.appLine, padding: 3, justifyContent: 'center',
  },
  trackOn: { backgroundColor: colors.ember },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.appSurface },
  knobOn: { alignSelf: 'flex-end' },
}));
