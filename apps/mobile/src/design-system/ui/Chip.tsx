/** Design-system Chip (mobile). */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '../generated/tokens';
import { useThemeColors } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { makeStyles } from '../../theme/makeStyles';

export type ChipTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

interface SelectableProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLayout?: React.ComponentProps<typeof Pressable>['onLayout'];
  style?: StyleProp<ViewStyle>;
}

export function SelectableChip({ label, selected, onPress, onLayout, style }: SelectableProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.base,
        {
          backgroundColor: selected ? colors.ember : colors.appSurface,
          borderColor: selected ? colors.ember : colors.appLine,
        },
        style,
      ]}
    >
      <Text variant="label" tone={selected ? 'onEmber' : 'secondary'} align="center">{label}</Text>
    </Pressable>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
  style,
}: {
  label: string;
  tone?: ChipTone;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  const t =
    tone === 'success' ? { bg: colors.mintTint, fg: colors.mint }
    : tone === 'danger' ? { bg: colors.dangerTint, fg: colors.danger }
    : tone === 'warning' ? { bg: colors.warnTint, fg: colors.amberInk }
    : tone === 'info' ? { bg: colors.infoTint, fg: colors.sky }
    : { bg: colors.appSurface2, fg: colors.appText2 };

  return (
    <View style={[styles.base, styles.status, { backgroundColor: t.bg, borderColor: 'transparent' }, style]}>
      <Text variant="caption" align="center" style={{ color: t.fg }}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { paddingVertical: 4, paddingHorizontal: space.s3 },
}));
