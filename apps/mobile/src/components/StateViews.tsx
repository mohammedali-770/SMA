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
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { presentState } from './stateHierarchy';
import { color, space } from '../design-system/generated/tokens';
import { Button } from '../design-system/ui/Button';
import { Text } from '../design-system/ui/Text';

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={color.ember} />
      {label ? <Text variant="body" tone="secondary" align="center">{label}</Text> : null}
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
  // Screens pass a localized fallback; the English default only applies to call
  // sites not yet migrated.
  const { heading, detail } = presentState({
    message,
    title,
    fallbackTitle: fallbackTitle ?? "That didn't load",
  });

  return (
    <View style={styles.center} accessibilityRole="alert">
      {icon ?? <Text variant="display" align="center">⚠️</Text>}
      <Text variant="heading" align="center">{heading}</Text>
      {onRetry ? (
        <Button label={retryLabel ?? 'Try Again'} onPress={onRetry} variant="secondary" style={{ marginTop: space.s5 }} />
      ) : null}
      {/* Step 3: quiet, still selectable and legible for support. */}
      {detail ? (
        <Text variant="caption" tone="tertiary" align="center" selectable style={{ marginTop: space.s3 }}>
          {detail}
        </Text>
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
      {icon ?? <Text variant="display" align="center">{emoji ?? '🛒'}</Text>}
      <Text variant="heading" align="center">{title}</Text>
      {/* Action before the explanation: the way out matters more than the why. */}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ marginTop: space.s3, alignSelf: 'stretch' }} />
      ) : null}
      {subtitle ? <Text variant="body" tone="secondary" align="center">{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s6,
    gap: space.s2,
  },
});
