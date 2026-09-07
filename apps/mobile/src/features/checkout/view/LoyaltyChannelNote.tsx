/**
 * Why the loyalty toggle is not here.
 *
 * Loyalty is a PICKUP incentive: `place_order` and `compute_order_snapshot`
 * both refuse to redeem on a delivery order while
 * `app_settings.loyalty_pickup_only` is on
 * (supabase/migrations/20260907120000_loyalty_pickup_only.sql).
 *
 * The alternative was to hide the toggle and show nothing. A customer who holds
 * a redeemable balance and is shown nothing reads it as the app having lost
 * their points, so this says both halves out loud: why the discount is not
 * offered, and that the balance is untouched.
 *
 * Deliberately NOT a disabled switch. A control that cannot be operated invites
 * the customer to keep tapping it; a sentence does not.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';
import { makeStyles } from '../../../theme/makeStyles';

export function LoyaltyChannelNote({
  title,
  balanceLine,
}: {
  /** Why points are not redeemable here. */
  title: string;
  /** The balance, and where it can be spent. */
  balanceLine: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.box}>
      <Text variant="label">{title}</Text>
      <Text variant="caption" tone="secondary">
        {balanceLine}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The same card shell as LoyaltyToggle, so the section keeps its shape
  // whichever of the two is showing and the page does not jump when the
  // customer switches order type.
  box: {
    backgroundColor: colors.appSurface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.appLine,
    padding: space.s3,
    gap: 2,
    minHeight: 60,
    justifyContent: 'center',
  },
}));
