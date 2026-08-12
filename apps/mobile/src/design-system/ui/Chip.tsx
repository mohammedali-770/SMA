/** Design-system Chip (mobile). */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '../generated/tokens';
import { useThemeColors } from '../../theme/ThemeProvider';
import { Text } from './Text';

export type ChipTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

interface SelectableProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLayout?: React.ComponentProps<typeof Pressable>['onLayout'];
  style?: StyleProp<ViewStyle>;
}

export function SelectableChip({ label, selected, onPress, onLayout, style }: SelectableProps) {
  const color = useThemeColors();
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
          backgroundColor: selected ? color.ember : color.appSurface,
          borderColor: selected ? color.ember : color.appLine,
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
  const color = useThemeColors();
  const t =
    tone === 'success' ? { bg: color.mintTint, fg: color.mint }
    : tone === 'danger' ? { bg: color.dangerTint, fg: color.danger }
    : tone === 'warning' ? { bg: color.warnTint, fg: color.amberInk }
    : tone === 'info' ? { bg: color.infoTint, fg: color.sky }
    : { bg: color.appSurface2, fg: color.appText2 };

  return (
    <View style={[styles.base, styles.status, { backgroundColor: t.bg, borderColor: 'transparent' }, style]}>
      <Text variant="caption" align="center" style={{ color: t.fg }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { paddingVertical: 4, paddingHorizontal: space.s3 },
});
