/**
 * Editable cart lines on Checkout.
 *
 * They are editable here so a customer told "below the delivery minimum" can
 * fix it without navigating back to the cart and losing their pin, coupon and
 * payment method. The stepper's `busy` guard is what makes that safe: while a
 * change settles, both controls stop firing and submission is blocked, so the
 * server can never be handed a cart the customer has not seen priced.
 *
 * TAPPING THE LINE OPENS THE ITEM, exactly as it already does on the Cart
 * screen (`CartLine`, which routes to `/product/[id]?cartItemId=…`). The two
 * screens showed the same rows but only one of them could reach the options:
 * on Checkout a customer who had picked the wrong size could change HOW MANY
 * they were getting but not WHICH one, and the only way out was to go back to
 * the cart — losing the pin, coupon and payment method this screen exists to
 * preserve. The stepper keeps its own hit area, so tapping the row edits and
 * tapping ± still counts.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Price } from '../../../components/Price';
import { QtyStepper } from '../../../components/QtyStepper';
import { color, radius, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import type { CartItem } from '../../../types/models';
import { makeStyles } from '../../../theme/makeStyles';
import { useThemeColors } from '../../../theme/ThemeProvider';

export function CheckoutLines({
  items,
  recalcLineId,
  nameOf,
  modifierSummaryOf,
  amountOf,
  onIncrement,
  onDecrement,
  onEdit,
  editLabel,
}: {
  items: CartItem[];
  recalcLineId: string | null;
  nameOf: (it: CartItem) => string;
  modifierSummaryOf: (it: CartItem) => string;
  amountOf: (it: CartItem) => number;
  onIncrement: (cartItemId: string) => void;
  onDecrement: (cartItemId: string) => void;
  onEdit: (it: CartItem) => void;
  editLabel: string;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { rtlRow } = useI18n();

  return (
    <View style={{ gap: space.s2 }}>
      {items.map((it) => {
        const name = nameOf(it);
        const mods = modifierSummaryOf(it);
        return (
          <View key={it.cartItemId} style={[styles.line, rtlRow]}>
            {/* The whole text block is the edit target — a row that is only
                tappable on a small chevron reads as decoration. Disabled while
                that line's change is still settling, for the same reason the
                stepper is: the edit screen must not open on a quantity the
                cart has not committed yet. */}
            <Pressable
              onPress={() => onEdit(it)}
              disabled={recalcLineId === it.cartItemId}
              accessibilityRole="button"
              accessibilityLabel={`${editLabel}: ${name}`}
              accessibilityHint={editLabel}
              style={({ pressed }) => [styles.body, pressed && styles.pressed]}
            >
              <Text variant="label" numberOfLines={2}>{name}</Text>
              {mods ? (
                <Text variant="caption" tone="secondary" numberOfLines={2}>{mods}</Text>
              ) : null}
              <Price
                amount={amountOf(it)}
                size={typeScale.body.size}
                color={colors.appText}
                weight="600"
              />
            </Pressable>
            <QtyStepper
              value={it.quantity}
              // 0, not the default 1: at one unit, minus means "remove this
              // item" and the screen confirms it, so the control stays live.
              min={0}
              small
              busy={recalcLineId === it.cartItemId}
              itemLabel={name}
              onIncrement={() => onIncrement(it.cartItemId)}
              onDecrement={() => onDecrement(it.cartItemId)}
            />
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  line: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    backgroundColor: colors.appSurface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.appLine,
    paddingHorizontal: space.s3, paddingVertical: space.s3,
  },
  body: { flex: 1, gap: 2, alignItems: 'flex-start' },
  pressed: { opacity: 0.8 },
}));
