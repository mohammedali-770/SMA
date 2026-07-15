/** Consistent loading / error / empty states used across screens. */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { colors, font, spacing } from '../theme';

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.purple} />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

export function ErrorView({
  message, onRetry, retryLabel, icon,
}: {
  message: string; onRetry?: () => void; retryLabel?: string;
  /** Drawn icon (see components/Icons); falls back to the legacy emoji glyph. */
  icon?: React.ReactNode;
}) {
  return (
    <View style={styles.center}>
      {icon ?? <Text style={styles.emoji}>⚠️</Text>}
      <Text style={styles.title}>{message}</Text>
      {onRetry ? (
        <Button label={retryLabel ?? 'Try Again'} onPress={onRetry} variant="secondary" style={{ marginTop: spacing.lg }} />
      ) : null}
    </View>
  );
}

export function EmptyView({
  emoji, title, subtitle, actionLabel, onAction, icon,
}: {
  emoji?: string; title: string; subtitle?: string; actionLabel?: string; onAction?: () => void;
  /** Drawn icon (see components/Icons); falls back to the legacy emoji glyph. */
  icon?: React.ReactNode;
}) {
  return (
    <View style={styles.center}>
      {icon ?? <Text style={styles.emoji}>{emoji ?? '🛒'}</Text>}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.sm,
  },
  emoji: { fontSize: 44, marginBottom: spacing.sm },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
  muted: { fontSize: font.md, color: colors.muted, textAlign: 'center' },
});
