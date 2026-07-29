/** Primary / secondary / ghost button with a loading + disabled state. */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, motion, radius, spacing, typography } from '../theme';
import { useThemeColors } from '../theme/ThemeProvider';
import { makeStyles } from '../theme/makeStyles';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, style, accessibilityLabel }: Props) {
  const colors = useThemeColors();
  const styles = useStyles();
  const isDisabled = disabled || loading;
  const bg =
    variant === 'primary' ? colors.purple
    : variant === 'danger' ? colors.red
    : variant === 'secondary' ? colors.white
    : 'transparent';
  const fg =
    variant === 'secondary' ? colors.accent
    : variant === 'ghost' ? colors.accent
    : colors.white;
  const borderColor = variant === 'secondary' ? colors.accent : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: isDisabled ? colors.disabled : bg, borderColor },
        variant === 'secondary' && styles.bordered,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading && <ActivityIndicator size="small" color={fg} style={{ marginEnd: spacing.sm }} />}
        <Text style={[styles.label, { color: isDisabled && variant !== 'primary' ? colors.muted : fg }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 0,
  },
  bordered: { borderWidth: 1.5 },
  pressed: { opacity: motion.pressedOpacity, transform: [{ scale: motion.pressedScale }] },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { ...typography.button },
}));
