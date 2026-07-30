/**
 * Design-system Chip (mobile) — one component for the two pill shapes this
 * product uses, because they are the same object at different jobs:
 *
 *   selectable  a category filter. Tappable, has a selected state.
 *   status      a read-only state pill (open/closed, order type). Not tappable.
 *
 * Selected chips fill with ember — the one interactive colour — rather than
 * tinting, so the active category is unmistakable at a glance in a scrolling
 * row. Status pills use the semantic tint tokens and never ember, so a state
 * can never be mistaken for something you can press.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius, space } from '../generated/tokens';
import { Text } from './Text';

export type ChipTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

const TONE: Record<ChipTone, { bg: string; fg: string }> = {
  neutral: { bg: color.appSurface2, fg: color.appText2 },
  success: { bg: color.mintTint, fg: color.mint },
  danger: { bg: color.dangerTint, fg: color.danger },
  warning: { bg: color.warnTint, fg: color.amberInk },
  info: { bg: color.infoTint, fg: color.sky },
};

interface SelectableProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLayout?: React.ComponentProps<typeof Pressable>['onLayout'];
  style?: StyleProp<ViewStyle>;
}

/** A tappable filter chip. Ember when selected. */
export function SelectableChip({ label, selected, onPress, onLayout, style }: SelectableProps) {
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
      <Text variant="label" tone={selected ? 'onEmber' : 'secondary'} align="center">
        {label}
      </Text>
    </Pressable>
  );
}

/** A read-only state pill. Never ember — a state is not a control. */
export function StatusPill({
  label,
  tone = 'neutral',
  style,
}: {
  label: string;
  tone?: ChipTone;
  style?: StyleProp<ViewStyle>;
}) {
  const t = TONE[tone];
  return (
    <View style={[styles.base, styles.status, { backgroundColor: t.bg, borderColor: 'transparent' }, style]}>
      <Text variant="caption" align="center" style={{ color: t.fg }}>
        {label}
      </Text>
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
