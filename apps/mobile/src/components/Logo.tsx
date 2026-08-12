/** Spicy Meal logo lockup: brand mark + wordmark, shown at the top of screens. */
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../design-system/generated/tokens';
import { Text } from '../design-system/ui/Text';
import { makeStyles } from '../theme/makeStyles';

// The official production mark — the same asset as the iOS/Android app icon.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MARK = require('../../assets/icon.png');

export function Logo({ compact = false }: { compact?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Image source={MARK} style={compact ? styles.markSm : styles.mark} contentFit="cover" />
      {!compact && (
        <View>
          <Text variant="title">Spicy Meal</Text>
          <Text variant="caption" tone="ember">سبايسي ميل</Text>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  mark: { width: 40, height: 40, borderRadius: radius.sm },
  markSm: { width: 30, height: 30, borderRadius: radius.sm },
}));
