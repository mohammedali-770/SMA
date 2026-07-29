/**
 * Notice — the app's one shape for "something is blocking you" / "something
 * needs your attention".
 *
 * Screens previously rendered blocking problems as a single plain sentence in
 * the same size and weight as the legal consent paragraph next to it, so on
 * Checkout the paragraph "By placing this order, you agree to the Cancellation
 * & Refund Policy, Delivery & Pickup Policy, and Payment Policy." was the
 * largest block of text on screen while the reason the button was dead —
 * "Below the branch minimum for delivery. 25.00 SAR" — read as a footnote
 * underneath it.
 *
 * The hierarchy this enforces, top to bottom:
 *   1. `title`  — what happened. Largest, heaviest, highest contrast.
 *   2. `action` — what the customer must do next. Clearly readable.
 *   3. `detail` — supporting or legal information. Smaller and quieter, still
 *      fully legible and selectable; never removed, only de-emphasised.
 *
 * Legally required text keeps AA contrast (`colors.muted` on the tint) and is
 * never hidden behind a disclosure — section 5 asks for reduced prominence,
 * not reduced availability.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, font, radius, spacing } from '../theme';
import { useThemeColors } from '../theme/ThemeProvider';
import { makeStyles } from '../theme/makeStyles';

export type NoticeTone = 'blocking' | 'warning' | 'info' | 'success';

interface NoticeProps {
  /** The problem or state, in the customer's words. Always required. */
  title: string;
  /** The single next step. Omit when the title is self-evident. */
  action?: string | null;
  /** Supporting/legal detail, or rich content (policy links). */
  detail?: React.ReactNode;
  tone?: NoticeTone;
  /** RTL text alignment from the i18n provider. */
  rtlText?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}

const TONE = {
  blocking: { bg: colors.dangerBg, bar: colors.danger, title: colors.danger },
  warning: { bg: '#fdf3e3', bar: colors.warning, title: colors.warning },
  info: { bg: colors.purpleBg, bar: colors.accent, title: colors.accent },
  success: { bg: colors.successBg, bar: colors.success, title: colors.success },
} as const;

export function Notice({ title, action, detail, tone = 'blocking', rtlText, style }: NoticeProps) {
  const colors = useThemeColors();
  const styles = useStyles();
  const c = TONE[tone];
  return (
    <View
      style={[styles.wrap, { backgroundColor: c.bg, borderStartColor: c.bar }, style]}
      accessibilityRole="alert"
      accessible
      // One announcement instead of three fragments, in reading order.
      accessibilityLabel={[title, action].filter(Boolean).join('. ')}
    >
      <Text style={[styles.title, { color: c.title }, rtlText]}>{title}</Text>
      {action ? <Text style={[styles.action, rtlText]}>{action}</Text> : null}
      {detail ? <View style={styles.detail}>{detail}</View> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    borderRadius: radius.md,
    borderCurve: 'continuous',
    // A leading bar rather than a full border: it reads as severity without
    // boxing the message in and competing with the card borders around it.
    borderStartWidth: 4,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  // Step 1 — the problem. Deliberately larger and heavier than body text.
  title: { fontSize: font.lg, fontWeight: '800', lineHeight: 23 },
  // Step 2 — the fix. Normal weight so it supports rather than shouts.
  action: { fontSize: font.md, color: colors.text, lineHeight: 21, marginTop: 2 },
  // Step 3 — supporting/legal. Quieter, still legible.
  detail: { marginTop: spacing.xs },
}));

/**
 * Shared text style for secondary/legal copy rendered outside a Notice (for
 * example the checkout footer's policy consent line), so "quiet" means the same
 * thing everywhere.
 */
export const secondaryTextStyle = {
  fontSize: font.xs,
  color: colors.muted,
  lineHeight: 17,
} as const;
