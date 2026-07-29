/**
 * Consistent loading / error / empty states used across screens.
 *
 * These carry the app-wide information hierarchy for full-screen states, so
 * Home/menu, Cart, My Orders and Product details inherit it without each screen
 * restating the rule:
 *   1. what happened      — `title`/`message`, largest and heaviest;
 *   2. what to do next    — the action button, immediately below;
 *   3. supporting detail  — `subtitle`/`detail`, smaller and quieter.
 *
 * `ErrorView` previously rendered a raw provider/exception string as the
 * heading, so customers could be shown text like "Network request failed" or a
 * PostgREST message as the most prominent thing on the screen. It now leads
 * with a short human sentence and demotes any technical text to quiet detail
 * (kept, because support needs the customer to be able to read it back, but no
 * longer the headline).
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { presentState } from './stateHierarchy';
import { colors, font, spacing, typography } from '../theme';
import { useThemeColors } from '../theme/ThemeProvider';
import { makeStyles } from '../theme/makeStyles';

export function LoadingView({ label }: { label?: string }) {
  const colors = useThemeColors();
  const styles = useStyles();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.accent} />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

export function ErrorView({
  message, onRetry, retryLabel, icon, title, fallbackTitle,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Drawn icon (see components/Icons); falls back to the legacy emoji glyph. */
  icon?: React.ReactNode;
  /** Explicit customer-facing heading; overrides the technical-text heuristic. */
  title?: string;
  /** Localized generic heading used when `message` is technical. */
  fallbackTitle?: string;
}) {
  const styles = useStyles();
  // Screens pass a localized fallback; the English default only applies to call
  // sites not yet migrated.
  const { heading, detail } = presentState({
    message,
    title,
    fallbackTitle: fallbackTitle ?? "That didn't load",
  });

  return (
    <View style={styles.center} accessibilityRole="alert">
      {icon ?? <Text style={styles.emoji}>⚠️</Text>}
      <Text style={styles.title}>{heading}</Text>
      {onRetry ? (
        <Button label={retryLabel ?? 'Try Again'} onPress={onRetry} variant="secondary" style={{ marginTop: spacing.lg }} />
      ) : null}
      {/* Step 3: quiet, still selectable and legible for support. */}
      {detail ? <Text style={styles.detail} selectable>{detail}</Text> : null}
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
  const styles = useStyles();
  return (
    <View style={styles.center}>
      {icon ?? <Text style={styles.emoji}>{emoji ?? '🛒'}</Text>}
      <Text style={styles.title}>{title}</Text>
      {/* Action before the explanation: the way out matters more than the why. */}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ marginTop: spacing.md, alignSelf: 'stretch' }} />
      ) : null}
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.sm,
  },
  emoji: { fontSize: 44, marginBottom: spacing.sm },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  muted: { ...typography.body, color: colors.muted, textAlign: 'center' },
  // Technical/supporting detail: smallest and quietest, never removed.
  detail: {
    fontSize: font.xs, color: colors.muted, textAlign: 'center',
    marginTop: spacing.md, lineHeight: 17,
  },
}));
