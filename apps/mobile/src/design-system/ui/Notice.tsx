/**
 * Design-system Notice — "something is blocking you" / "something needs your
 * attention", in Ember on Cream.
 *
 * The hierarchy is the point, and it is the same one the legacy Notice
 * established: `title` says what happened, `action` says what to do about it,
 * and nothing else competes with them. On Checkout the legal-consent paragraph
 * used to be the largest block of text on screen while the reason the button
 * was dead read as a footnote; keeping title/action as separate, differently
 * weighted slots is what prevents that from coming back.
 *
 * A leading bar rather than a full border: it reads as severity without boxing
 * the message in and competing with the card edges around it. The bar uses
 * `borderStartWidth`, so it sits on the reading edge in Arabic too.
 *
 * The legacy `components/Notice.tsx` still backs the unmigrated order-type
 * selection screen and is deleted when that surface lands.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Price } from '../../components/Price';
import { useI18n } from '../../i18n/I18nProvider';
import { priceAccessibilityLabel } from '../generated/money';
import { color, radius, space, type as typeScale } from '../generated/tokens';
import { Text } from './Text';

export type NoticeTone = 'blocking' | 'warning' | 'info' | 'success';

const TONE: Record<NoticeTone, { bg: string; bar: string; title: string }> = {
  blocking: { bg: color.dangerTint, bar: color.danger, title: color.danger },
  warning: { bg: color.warnTint, bar: color.warn, title: color.amberInk },
  info: { bg: color.infoTint, bar: color.sky, title: color.sky },
  success: { bg: color.mintTint, bar: color.mint, title: color.mint },
};

interface Props {
  /** The problem or state, in the customer's words. Always required. */
  title: string;
  /** The single next step. Omit when the title is self-evident. */
  action?: string | null;
  /**
   * A money figure the message is ABOUT — e.g. how much is still needed to
   * reach the delivery minimum. It gets its own row so it can render through
   * `<Price>`: the visible currency mark is the official SAMA glyph, never the
   * letters "SAR", and a number interpolated into a sentence cannot be a
   * component. This replaced a `formatSAR(...)` call that printed "31.00 SAR"
   * inside the action text.
   */
  amount?: number | null;
  /** Names what `amount` is. Required whenever `amount` is given. */
  amountLabel?: string;
  tone?: NoticeTone;
  style?: StyleProp<ViewStyle>;
}

export function Notice({ title, action, amount, amountLabel, tone = 'blocking', style }: Props) {
  const { lang, rtlRow } = useI18n();
  const c = TONE[tone];
  const showAmount = amount != null && amountLabel;

  return (
    <View
      style={[styles.wrap, { backgroundColor: c.bg, borderStartColor: c.bar }, style]}
      accessibilityRole="alert"
      accessible
      // One announcement instead of three fragments, in reading order.
      //
      // The amount MUST go through priceAccessibilityLabel: this container is
      // `accessible`, which collapses the <Price> inside it and swallows the
      // label Price would otherwise have announced. Without this the user hears
      // "Still needed, 31.00" — a bare number with no currency at all.
      accessibilityLabel={[
        title,
        showAmount ? `${amountLabel}: ${priceAccessibilityLabel(amount, lang)}` : null,
        action,
      ].filter(Boolean).join('. ')}
      accessibilityLanguage={lang}
    >
      <Text variant="heading" style={{ color: c.title }}>{title}</Text>
      {showAmount ? (
        <View style={[styles.amountRow, rtlRow]}>
          <Text variant="body" tone="secondary">{amountLabel}</Text>
          <Price amount={amount} size={typeScale.body.size} color={c.title} weight="700" />
        </View>
      ) : null}
      {action ? <Text variant="body" tone="secondary">{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderStartWidth: 4,
    paddingVertical: space.s3,
    paddingHorizontal: space.s3,
    gap: 2,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginVertical: 2 },
});
